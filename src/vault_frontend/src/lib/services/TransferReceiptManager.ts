import { vaultStore } from '../stores/vaultStore';
import { walletStore } from '../stores/wallet';
import { ApiClient } from './protocol/apiClient';
import { BigIntUtils } from '../utils/bigintUtils';
import { get } from 'svelte/store';

export interface TransferReceipt {
  id: string;
  vaultId: number;
  amount: number;
  timestamp: number;
  owner: string;
  claimed: boolean;
  claimedAt?: number;
  transactionHash?: string;
  type: 'margin' | 'redemption' | 'collateral';
  retryCount?: number;
  lastRetry?: number;
}

/**
 * Manager for transfer receipts with improved storage, recovery and error handling
 */
export class TransferReceiptManager {
  private static readonly STORAGE_KEY = 'rumi_transfer_receipts';
  private static readonly PRINCIPAL_KEY_PREFIX = 'rumi_transfer_receipts_';
  private static readonly MAX_AGE_DAYS = 7; // Auto-clean receipts older than 7 days
  private static readonly MAX_RETRY_COUNT = 3;
  
  // Cache to avoid frequent localStorage reads
  private static receiptsCache: TransferReceipt[] | null = null;
  private static lastCacheTime = 0;
  private static readonly CACHE_DURATION = 30000; // 30 seconds

  /**
   * Save a transfer receipt with principal-specific storage
   */
  static saveReceipt(receipt: TransferReceipt): void {
    try {
      // Ensure the receipt has a valid ID
      if (!receipt.id) {
        receipt.id = this.generateReceiptId(receipt.vaultId);
      }
      
      // Get principal-specific key
      const storageKey = this.getPrincipalStorageKey();
      
      // Load current receipts
      const receipts = this.getAllReceipts();
      
      // Update cache
      this.receiptsCache = [...receipts, receipt];
      this.lastCacheTime = Date.now();
      
      // Check if this receipt already exists (by ID)
      const existingIndex = receipts.findIndex(r => r.id === receipt.id);
      if (existingIndex >= 0) {
        // Update existing receipt
        receipts[existingIndex] = receipt;
      } else {
        // Add new receipt
        receipts.push(receipt);
      }
      
      // Save back to storage
      localStorage.setItem(storageKey, BigIntUtils.stringify(receipts));
    } catch (err) {
      console.error('Failed to save transfer receipt:', err);
    }
  }
  
  /**
   * Get storage key for current principal
   */
  private static getPrincipalStorageKey(): string {
    const walletData = get(walletStore);
    const principalStr = walletData.principal?.toString();
    
    if (principalStr) {
      // Create a principal-specific key for better isolation
      return `${this.PRINCIPAL_KEY_PREFIX}${principalStr}`;
    }
    
    // Fallback to default key if no principal
    return this.STORAGE_KEY;
  }

  /**
   * Get all receipts for the current principal, with auto-cleanup of old receipts
   */
  static getAllReceipts(): TransferReceipt[] {
    try {
      // Check cache first
      const now = Date.now();
      if (this.receiptsCache && now - this.lastCacheTime < this.CACHE_DURATION) {
        return [...this.receiptsCache];
      }
      
      // Get from storage
      const storageKey = this.getPrincipalStorageKey();
      const savedData = localStorage.getItem(storageKey);
      if (!savedData) return [];
      
      const receipts = BigIntUtils.parse(savedData) as TransferReceipt[];
      
      // Filter out very old receipts (auto-cleanup)
      const maxAgeMs = this.MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
      const validReceipts = receipts.filter(r => {
        return (now - r.timestamp) < maxAgeMs;
      });
      
      // If we removed any old receipts, update storage
      if (validReceipts.length < receipts.length) {
        console.log(`Auto-removed ${receipts.length - validReceipts.length} old transfer receipts`);
        localStorage.setItem(storageKey, BigIntUtils.stringify(validReceipts));
      }
      
      // Update cache
      this.receiptsCache = validReceipts;
      this.lastCacheTime = now;
      
      return validReceipts;
    } catch (err) {
      console.error('Failed to load transfer receipts:', err);
      return [];
    }
  }
  
  /**
   * Get all unclaimed receipts that are eligible for claiming
   */
  static getUnclaimedReceipts(): TransferReceipt[] {
    const receipts = this.getAllReceipts();
    const now = Date.now();
    
    // Return unclaimed receipts that haven't been retried too many times
    // and for which the last retry was at least 1 minute ago
    return receipts.filter(r => !r.claimed && 
      (!r.retryCount || r.retryCount < this.MAX_RETRY_COUNT) && 
      (!r.lastRetry || now - r.lastRetry > 60000));
  }
  
  /**
   * Claim a transfer receipt with retry tracking and improved error handling
   */
  static async claimReceipt(receiptId: string): Promise<{success: boolean, error?: string}> {
    try {
      // Find the receipt
      const receipts = this.getAllReceipts();
      const receiptIndex = receipts.findIndex(r => r.id === receiptId);
      
      if (receiptIndex === -1) {
        return { success: false, error: 'Receipt not found' };
      }
      
      const receipt = receipts[receiptIndex];
      
      if (receipt.claimed) {
        return { success: false, error: 'Receipt already claimed' };
      }
      
      // Update retry count
      receipt.retryCount = (receipt.retryCount || 0) + 1;
      receipt.lastRetry = Date.now();
      
      // Update receipt in storage with retry information
      this.saveReceipt(receipt);
      
      // Call the API to claim the tokens
      console.log(`Attempting to claim receipt ${receiptId} (attempt ${receipt.retryCount})`);
      const result = await ApiClient.claimPendingTransfer(receipt.vaultId);
      
      if (result.success) {
        // Update the receipt
        receipt.claimed = true;
        receipt.claimedAt = Date.now();
        receipt.transactionHash = result.blockIndex?.toString() || undefined;
        
        // Save updated receipt
        this.saveReceipt(receipt);
        
        // Refresh balances
        await walletStore.refreshBalance();
        
        return { success: true };
      } else {
        // Check for specific errors that indicate the transfer might already be processed
        const errorMsg = result.error?.toLowerCase() || '';
        if (errorMsg.includes('not found') || 
            errorMsg.includes('already processed') ||
            errorMsg.includes('no pending') ||
            errorMsg.includes('already claimed')) {
              
          // Mark as claimed if the error suggests it's already been processed
          receipt.claimed = true;
          receipt.claimedAt = Date.now();
          receipt.transactionHash = 'auto-resolved';
          
          // Save updated receipt
          this.saveReceipt(receipt);
          
          return { success: true, error: 'Transfer already processed' };
        }
        
        return { success: false, error: result.error || 'Failed to claim tokens' };
      }
    } catch (err) {
      console.error('Error claiming receipt:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }
  
  /**
   * Auto-claim eligible receipts
   * Returns the number of successful claims
   */
  static async autoClaimReceipts(): Promise<number> {
    const unclaimedReceipts = this.getUnclaimedReceipts();
    let claimCount = 0;
    
    for (const receipt of unclaimedReceipts) {
      try {
        const result = await this.claimReceipt(receipt.id);
        if (result.success) {
          claimCount++;
        }
      } catch (err) {
        console.warn(`Auto-claim failed for receipt ${receipt.id}:`, err);
      }
      
      // Small delay between claims to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return claimCount;
  }
  
  /**
   * Generate a unique receipt ID
   */
  static generateReceiptId(vaultId: number): string {
    const walletData = get(walletStore);
    const principalStr = walletData.principal?.toString().substring(0, 8) || 'unknown';
    const timestamp = Date.now().toString(36);
    const random = Math.floor(Math.random() * 10000).toString(36);
    return `RUMI-${vaultId}-${principalStr}-${timestamp}-${random}`;
  }
  
  /**
   * Create a receipt from a vault
   */
  static createReceiptFromVault(vault: any, type: 'margin' | 'redemption' | 'collateral' = 'margin'): TransferReceipt {
    const walletData = get(walletStore);
    const receiptId = this.generateReceiptId(vault.vaultId);
    
    return {
      id: receiptId,
      vaultId: vault.vaultId,
      amount: vault.icpMargin,
      timestamp: Date.now(),
      owner: walletData.principal?.toString() || '',
      claimed: false,
      type,
      retryCount: 0
    };
  }
  
  /**
   * Clear all receipts for testing/debugging
   */
  static clearAllReceipts(): void {
    try {
      const storageKey = this.getPrincipalStorageKey();
      localStorage.removeItem(storageKey);
      this.receiptsCache = null;
      console.log('Cleared all transfer receipts');
    } catch (err) {
      console.error('Failed to clear receipts:', err);
    }
  }
  
  /**
   * Clear claimed receipts to free up storage space
   */
  static clearClaimedReceipts(): void {
    try {
      const receipts = this.getAllReceipts();
      const unclaimedReceipts = receipts.filter(r => !r.claimed);
      
      if (unclaimedReceipts.length < receipts.length) {
        const storageKey = this.getPrincipalStorageKey();
        localStorage.setItem(storageKey, BigIntUtils.stringify(unclaimedReceipts));
        this.receiptsCache = unclaimedReceipts;
        console.log(`Cleared ${receipts.length - unclaimedReceipts.length} claimed receipts`);
      }
    } catch (err) {
      console.error('Failed to clear claimed receipts:', err);
    }
  }
}

// Setup periodic auto-claim attempts if browser environment
if (typeof window !== 'undefined') {
  // Try auto-claiming receipts every 3 minutes
  setInterval(() => {
    TransferReceiptManager.autoClaimReceipts()
      .then(count => {
        if (count > 0) {
          console.log(`Auto-claimed ${count} pending transfers`);
        }
      })
      .catch(err => {
        console.warn('Auto-claim process failed:', err);
      });
  }, 180000); // 3 minutes
}
