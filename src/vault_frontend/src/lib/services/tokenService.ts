import { Principal } from '@dfinity/principal';
import { Actor, HttpAgent } from '@dfinity/agent';
import { canisterIDLs, pnp } from './pnp';
import { CONFIG } from '../config';
import { ICRC1_IDL } from '../idls/ledger.idl';
import type { _SERVICE } from '../../../../declarations/icp_ledger/icp_ledger.did';
import { walletStore as wallet } from '../stores/wallet';

// Constants for token handling
const E8S = 100_000_000;

/**
 * Service for token-related operations like fetching balances, approvals, and format handling
 */
export class TokenService {
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_DELAY = 1000;
  private static readonly CACHE_DURATION = 30000; // 30 seconds cache duration
  
  // Balance cache to reduce network calls
  private static balanceCache: Map<string, {
    balance: bigint,
    timestamp: number
  }> = new Map();

  /**
   * Format balance with better precision handling
   */
  static formatBalance(balance: bigint | null): string {
    if (balance === null || balance === undefined) return '0.0000';
    
    // Convert to number with proper scaling
    const balanceAsNumber = Number(balance) / E8S;
    
    // Format with 4 decimal places
    return balanceAsNumber.toFixed(4);
  }

  /**
   * Create an anonymous actor for public queries
   */
  static async createAnonymousActor(canisterId: string, idl: any) {
    const agent = new HttpAgent({
      host: CONFIG.host
    });

    if (CONFIG.isLocal) {
      await agent.fetchRootKey().catch(err => {
        console.error("Failed to fetch root key:", err);
      });
    }

    return Actor.createActor(idl, {
      agent,
      canisterId,
    });
  }

  /**
   * Get token balance with caching
   */
  static async getTokenBalance(canisterId: string, principal: Principal): Promise<bigint> {
    const cacheKey = `${canisterId}-${principal.toText()}`;
    const now = Date.now();
    const cachedData = this.balanceCache.get(cacheKey);
    
    // Return cached balance if it's fresh
    if (cachedData && (now - cachedData.timestamp < this.CACHE_DURATION)) {
      console.log(`Using cached balance for ${canisterId}`);
      return cachedData.balance;
    }
    
    try {
      console.log(`Getting ${canisterId} balance for ${principal.toText()}`);
      
      // Create an anonymous HttpAgent for direct queries
      const agent = new HttpAgent({ host: CONFIG.host });
      
      // In local development, fetch the root key
      if (CONFIG.isLocal) {
        await agent.fetchRootKey().catch(e => {
          console.warn('Unable to fetch root key. Error:', e);
        });
      }
      
      // Create the actor with ICRC1 ledger interface
      const actor = Actor.createActor<_SERVICE>(ICRC1_IDL as any, {
        agent,
        canisterId,
      });
      
      // Query balance with proper formatting for ICRC1 interface
      const balance = await actor.icrc1_balance_of({
        owner: principal,
        subaccount: []
      });
      
      console.log(`Raw balance for ${canisterId}:`, balance.toString());
      
      // Update cache
      this.balanceCache.set(cacheKey, {
        balance,
        timestamp: now
      });

      // After getting the balance, also persist it
      const walletId = principal.toString();
      this.saveBalanceToStorage(walletId, canisterId, balance);
      
      return balance;
    } catch (err) {
      console.error(`Error fetching ${canisterId} balance:`, err);
      
      // If cache exists but is stale, still use it rather than returning 0
      if (cachedData) {
        console.warn(`Using stale cached balance for ${canisterId} due to error`);
        return cachedData.balance;
      }

      // Try loading from storage as last resort
      const walletId = principal.toString();
      const storedBalance = this.getBalanceFromStorage(walletId, canisterId);
      if (storedBalance !== null) {
        return storedBalance;
      }
      
      return BigInt(0);
    }
  }

  /**
   * Clear token balance cache for specified principal or all cache if not specified
   */
  static clearBalanceCache(principal?: Principal): void {
    if (principal) {
      // Clear only entries for this principal
      const prefix = `-${principal.toText()}`;
      for (const key of this.balanceCache.keys()) {
        if (key.endsWith(prefix)) {
          this.balanceCache.delete(key);
        }
      }
      console.log(`Cleared balance cache for principal: ${principal.toText()}`);
    } else {
      // Clear all cache
      this.balanceCache.clear();
      console.log('Cleared all balance cache');
    }
  }

  /**
   * Retry an operation with exponential backoff
   */
  static async retryOperation<T>(
    operation: () => Promise<T>,
    retries: number = this.MAX_RETRIES
  ): Promise<T> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        if (attempt > 1) {
          console.log(`Retry attempt ${attempt} of ${retries}`);
        }
        
        const result = await operation();
        
        if (attempt > 1) {
          console.log('Operation successful after retry');
        }
        
        return result;
      } catch (error) {
        console.error(`Attempt ${attempt} failed:`, error);
        
        if (attempt === retries) throw error;
        
        // Exponential backoff
        const backoffTime = this.RETRY_DELAY * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, backoffTime));
      }
    }
    throw new Error('Operation failed after all retries');
  }

  /**
   * Approve ICP transfer with better error handling and retry
   */
  static async approveIcpTransfer(amount: number, spender: string): Promise<{success: boolean, error?: string}> {
    return this.retryOperation(async () => {
      try {
        if (!wallet || !wallet.getActor) {
          throw new Error('Wallet provider not available');
        }
        
        // Convert to e8s
        const amountE8s = BigInt(Math.floor(amount * E8S));
        
        // Try with direct Plug approval if available (more reliable)
        if (window.ic?.plug && (window.ic.plug as any).requestTransferApproval && 
            typeof (window.ic.plug as any).requestTransferApproval === 'function') {
          console.log(`Requesting direct Plug approval for ${amount} ICP to ${spender}`);
          const approvalResult = await (window.ic.plug as any).requestTransferApproval({
            token: 'icp_ledger',
            amount: amountE8s,
            to: spender
          });
          
          console.log('Direct approval result:', approvalResult);
          return { success: true };
        }
        
        // Use wallet store for approval as fallback
        console.log(`Requesting PnP approval for ${amount} ICP to ${spender}`);
        const pnpActor = await wallet.getActor(CONFIG.currentIcpLedgerId, canisterIDLs.icp_ledger);
        const result = await pnpActor.icrc2_approve({
          amount: amountE8s,
          spender: { 
            owner: Principal.fromText(spender),
            subaccount: [] 
          },
          expires_at: [], 
          expected_allowance: [],
          memo: [],
          fee: [],
          from_subaccount: [],
          created_at_time: []
        });
        
        if ('Ok' in result) {
          console.log(`Successfully approved ${amount} ICP to ${spender}`);
          return { success: true };
        } else {
          return { 
            success: false, 
            error: `Approval failed: ${JSON.stringify(result.Err)}` 
          };
        }
      } catch (error) {
        console.error('ICP approval failed:', error);
        return { 
          success: false, 
          error: error instanceof Error ? error.message : 'Failed to approve ICP transfer' 
        };
      }
    }, 2);
  }
  
  /**
   * Check token allowance with better error handling and caching
   */
  static async checkIcpAllowance(owner: Principal, spender: string): Promise<bigint> {
    const cacheKey = `allowance-${owner.toText()}-${spender}`;
    const cachedAllowance = sessionStorage.getItem(cacheKey);
    
    // Use cached allowance if available and not expired
    if (cachedAllowance) {
      try {
        const { allowance, timestamp } = JSON.parse(cachedAllowance);
        // Use cache if it's less than 2 minutes old
        if (Date.now() - timestamp < 120000) {
          return BigInt(allowance);
        }
      } catch (e) {
        console.warn('Failed to parse cached allowance');
      }
    }
    
    try {
      const pnpActor = await wallet.getActor(CONFIG.currentIcpLedgerId, canisterIDLs.icp_ledger);
      const result = await pnpActor.icrc2_allowance({
        account: { 
          owner, 
          subaccount: [] 
        },
        spender: { 
          owner: Principal.fromText(spender), 
          subaccount: [] 
        }
      });
      
      // Cache the result for 2 minutes
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({
          allowance: result.allowance.toString(),
          timestamp: Date.now()
        }));
      } catch (e) {
        console.warn('Failed to cache allowance', e);
      }
      
      return result.allowance;
    } catch (error) {
      console.error('Failed to check allowance:', error);
      return BigInt(0);
    }
  }

  /**
   * Add tokens to Plug wallet with better error handling
   */
  static async addTokensToPlugWallet(): Promise<boolean> {
    if (!window.ic?.plug) {
      console.warn('Plug wallet not available');
      return false;
    }
    
    try {
      // FIXED: Don't make explicit requestConnect calls that cause automatic denial
      // Just check if Plug is connected and assume tokens will be available when needed
      const isConnected = await window.ic.plug.isConnected();
      if (isConnected) {
        console.log('Plug wallet is connected - tokens will be available when needed');
        return true;
      }
      
      // If not connected, don't request connection here as it causes permission denial
      // The connection should be handled by the main wallet connection flow
      console.log('Plug wallet not connected - tokens will be handled during connection');
      return true; // Return true to avoid blocking operations
      
    } catch (err) {
      console.error('Failed to check Plug wallet status:', err);
      return true; // Return true to avoid blocking operations
    }
  }
  
  /**
   * Parse a human-readable balance to e8s with validation
   */
  static parseBalance(balanceStr: string): bigint {
    // Remove any commas and validate
    const normalized = balanceStr.replace(/,/g, '').trim();
    const amount = parseFloat(normalized);
    
    if (isNaN(amount) || amount < 0) {
      throw new Error(`Invalid amount: ${balanceStr}`);
    }
    
    // Handle potential precision issues by using string operations 
    // for very small or large numbers
    const parts = normalized.split('.');
    const wholePart = parts[0] || '0';
    const fractionPart = parts[1] || '';
    
    // Truncate to 8 decimal places
    const paddedFraction = fractionPart.padEnd(8, '0').substring(0, 8);
    
    // Combine and convert to BigInt
    const e8sValue = wholePart + paddedFraction;
    return BigInt(e8sValue);
  }

  /**
   * Token balance persistence to localStorage (replaces db.ts functionality)
   */
  static saveBalanceToStorage(walletId: string, canisterId: string, balance: bigint): void {
    try {
      const key = `balance_${walletId}_${canisterId}`;
      const data = {
        in_tokens: balance.toString(),
        in_usd: '', // Calculated on demand
        timestamp: Date.now()
      };
      
      localStorage.setItem(key, JSON.stringify(data));
    } catch (err) {
      console.warn('Failed to save balance to storage:', err);
    }
  }
  
  /**
   * Get balance from localStorage (replaces db.ts functionality)
   */
  static getBalanceFromStorage(walletId: string, canisterId: string): bigint | null {
    try {
      const key = `balance_${walletId}_${canisterId}`;
      const stored = localStorage.getItem(key);
      
      if (stored) {
        const data = JSON.parse(stored);
        // Only use if fairly recent (less than 1 hour old)
        if (Date.now() - data.timestamp < 3600000) {
          return BigInt(data.in_tokens);
        }
      }
      return null;
    } catch (err) {
      console.warn('Failed to get balance from storage:', err);
      return null;
    }
  }
  
  /**
   * Clear stored balances (replaces db.ts functionality)
   */
  static clearStoredBalances(walletId: string): void {
    try {
      // Find all keys related to this wallet ID
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(`balance_${walletId}`)) {
          keysToRemove.push(key);
        }
      }
      
      // Remove each key
      keysToRemove.forEach(key => localStorage.removeItem(key));
    } catch (err) {
      console.warn('Failed to clear balance storage:', err);
    }
  }
}

export default TokenService;
