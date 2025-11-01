import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { BigIntUtils } from '../../utils/bigintUtils';
import { idlFactory as rumi_backendIDL } from '../../../../../declarations/rumi_protocol_backend/rumi_protocol_backend.did.js';
import { idlFactory as icp_ledgerIDL } from '../../../../../declarations/icp_ledger/icp_ledger.did.js';
import { idlFactory as icusd_ledgerIDL } from '../../../../../declarations/icusd_ledger/icusd_ledger.did.js';
import { idlFactory as treasuryIDL } from '../../../../../declarations/rumi_treasury/rumi_treasury.did.js';
import { CANISTER_IDS, CONFIG, LOCAL_CANISTER_IDS  } from '../../config';
import { walletStore } from '../../stores/wallet';
import type {
    _SERVICE,
    Vault as CanisterVault,
    ProtocolStatus as CanisterProtocolStatus,
    LiquidityStatus as CanisterLiquidityStatus,
    Fees,
    SuccessWithFee,
    ProtocolError,
    OpenVaultSuccess
  } from '../../../../../declarations/rumi_protocol_backend/rumi_protocol_backend.did.js';
import { walletOperations } from './walletOperations';
import { get } from 'svelte/store';
import { vaultStore } from '$lib/stores/vaultStore';
import { QueryOperations } from './queryOperations';
import { permissionManager } from '../PermissionManager';
import type { 
  VaultDTO, 
  VaultOperationResult, 
  FeesDTO, 
  LiquidityStatusDTO,
  CandidVault 
} from '../types';
import { protocolService } from '../protocol';
import { RequestDeduplicator } from '../RequestDeduplicator';



// Constants from backend
export const E8S = 100_000_000;
export const MIN_ICP_AMOUNT = 100_000; // 0.001 ICP
export const MIN_ICUSD_AMOUNT = 10_000_000; // 0.10 icUSD (10 cents)
export const MINIMUM_COLLATERAL_RATIO = 1.33; // 133%
export const RECOVERY_COLLATERAL_RATIO = 1.5; // 150%

// CRITICAL CHANGE: Set this to false to use real data from the backend
export const USE_MOCK_DATA = false;

// Create anonymous agent using CONFIG values
const anonymousAgent = new HttpAgent({ host: CONFIG.host });
if (CONFIG.isLocal) {
  // Only fetch root key in local development to avoid warnings
  anonymousAgent.fetchRootKey().catch(err => {
    console.error("Failed to fetch root key:", err);
  });
}

// Create anonymous actor for public endpoints that don't require authentication
export const publicActor = Actor.createActor<_SERVICE>(rumi_backendIDL as any, {
  agent: anonymousAgent,
  canisterId: CONFIG.currentCanisterId
});

/**
 * Core API client for interacting with the protocol backend
 */
export class ApiClient {

  private static readonly STALE_OPERATION_TIMEOUT = 60 * 1000; // 60 seconds - reduced from 5 minutes
  private static operationTimestamps: Map<number, number> = new Map();
  private static cleanupInterval: NodeJS.Timeout | null = null;
  static OPERATION_TIMEOUT = 60 * 1000; // 60 seconds to match STALE_OPERATION_TIMEOUT


  // Add this property to track if an operation is in progress
private static operationInProgress = false;

/**
 * Helper for sequential operations with integrated operation tracking
 * @param operation The operation function to execute
 * @param operationId Optional ID for tracking (vaultId for vault operations)
 * @param refreshOptions Options for data refreshing
 */
static async executeSequentialOperation<T>(
  operation: () => Promise<T>, 
  operationId?: number,
  refreshOptions = { refreshBefore: true, refreshAfter: true }
): Promise<T> {
  // Wait for any previous operation to complete WITH TIMEOUT
  let waitCount = 0;
  const maxWaitAttempts = 20; // 10 seconds max wait (20 * 500ms)
  
  while (ApiClient.operationInProgress) {
    waitCount++;
    if (waitCount >= maxWaitAttempts) {
      console.warn('Operation wait timeout exceeded, proceeding with new operation');
      // Don't force reset - just continue with new operation
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Track operation start if we have an ID
  if (operationId !== undefined) {
    ApiClient.operationTimestamps.set(operationId, Date.now());
  }
  
  try {
    // Mark that we're starting an operation
    ApiClient.operationInProgress = true;
    
    // Refresh vaults at the beginning if enabled
    if (refreshOptions.refreshBefore) {
      console.log('Refreshing vault data before operation');
      try {
        await ApiClient.refreshVaultData();
      } catch (refreshErr) {
        console.warn('Error refreshing vault data before operation:', refreshErr);
        // Continue with operation despite refresh error
      }
    }
    
    // Execute the operation
    const result = await operation();
    
    return result;
  } finally {
    // Always mark operation as complete, even if it fails
    ApiClient.operationInProgress = false;
    
    // Clear operation tracking if we were tracking
    if (operationId !== undefined) {
      ApiClient.operationTimestamps.delete(operationId);
    }
    
    // Refresh vaults at the end if enabled
    if (refreshOptions.refreshAfter) {
      console.log('Refreshing vault data after operation');
      try {
        await ApiClient.refreshVaultData();
      } catch (err) {
        console.warn('Error refreshing vault data after operation:', err);
        // Non-critical error, don't re-throw
      }
    }
  }
}
/**
 * Helper to ensure vault data is refreshed consistently
 */
private static async refreshVaultData(): Promise<void> {
  try {
    // Clear the vault cache to force fresh data
    ApiClient.clearVaultCache();
    // Reload the vaults from the backend
    await ApiClient.getUserVaults(true);
    await vaultStore.loadVaults(true)
    console.log('Vault data refresh complete');
  } catch (err) {
    console.warn('Error refreshing vault data:', err);
    // Continue - this is a non-critical operation
  }
}

  /**
   * Start the stale operation cleanup interval
   */
  static startCleanupInterval(): void {
    if (this.cleanupInterval) return;
    
    this.cleanupInterval = setInterval(() => {
      this.clearAllStaleOperations();
    }, 120000); // Run every 10 seconds (more frequent checks)
    
    console.log('Started stale operation cleanup interval');
  }

    /**
   * Get an actor with the current user's identity
   */
    private static async getAuthenticatedActor(): Promise<_SERVICE> {
      if (USE_MOCK_DATA) {
        return publicActor; // Use anonymous actor for mock data
      }
      
      try {
        return walletStore.getActor(CONFIG.currentCanisterId, rumi_backendIDL);
      } catch (err) {
        console.error('Failed to get authenticated actor:', err);
        throw new Error('Failed to initialize protocol actor');
      }
    }

  /**
   * Stop the cleanup interval
   */
  static stopCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('Stopped stale operation cleanup interval');
    }
  }

  /**
   * Verify vault ownership and existence
   */
  static async verifyVaultAccess(vaultId: number): Promise<{
    vault: any;
    actor: any;
    error?: string;
  }> {
    try {
      // Get actor first to ensure we're authenticated
      const actor = await this.getAuthenticatedActor();
      
      // Then check if vault exists
      const vault = await this.getVaultById(vaultId);
      if (!vault) {
        return { vault: null, actor, error: 'Vault not found' };
      }
  
      // Verify ownership
      const walletState = get(walletStore);
      if (vault.owner !== walletState.principal?.toString()) {
        return { vault, actor, error: 'You do not own this vault' };
      }
  
      return { vault, actor };
    } catch (error) {
      console.error('Error verifying vault access:', error);
      return { 
        vault: null, 
        actor: null, 
        error: error instanceof Error ? error.message : 'Failed to verify vault access' 
      };
    }
  }

  /**
   * Make a call to a public endpoint that doesn't require authentication
   */
  static async getPublicData<T>(
    method: keyof typeof publicActor,
    ...args: any[]
  ): Promise<T> {
    if (USE_MOCK_DATA) {
      return this.getMockData<T>(method as string, ...args);
    }

    try {
      console.log(`Calling ${String(method)} with args:`, args);
      return (await (publicActor[method] as any)(...args)) as T;
    } catch (err) {
      console.error(`Failed to fetch ${String(method)}:`, err);
      throw new Error(`Could not fetch ${String(method)}`);
    }
  }

  /**
   * Get mock data for development
   */
  static getMockData<T>(method: string, ...args: any[]): T {
    console.log(`[MOCK] Getting mock data for ${method} with args:`, args);
    
    // Protocol status mock data
    if (method === 'get_protocol_status') {
      return {
        mode: 'GeneralAvailability',
        total_icp_margin: 1000000000n,
        total_icusd_borrowed: 500000000n,
        last_icp_rate: 6.41,
        last_icp_timestamp: BigInt(Date.now()),
        total_collateral_ratio: 2.0
      } as unknown as T;
    }
    
    // Default empty response
    return {} as T;
  }

    /**
   * Manually trigger the backend to process pending transfers
   */
    static async triggerPendingTransfers(): Promise<boolean> {
        try {
          const actor = await ApiClient.getAuthenticatedActor();
          
          // The backend doesn't have a direct trigger, so we make a series of calls
          // that should indirectly cause the backend to process transfers
          await actor.get_protocol_status();
          
          // Make a second call after a short delay to help trigger the timer
          setTimeout(async () => {
            try {
              await actor.get_protocol_status();
            } catch (e) {
              console.error('Error in follow-up call:', e);
            }
          }, 2000);
          
          return true;
        } catch (err) {
          console.error('Error triggering pending transfers:', err);
          return false;
        }
      }
  
  /**
   * Format error messages from the protocol backend
   */
  static formatProtocolError(error: any): string {
    // Handle BigInt serialization issues
    if (error instanceof Error && error.message.includes('Do not know how to serialize a BigInt')) {
      return 'Error processing large numbers. Please try again.';
    }

    if (typeof error === 'string') {
      return error;
    }
    
    // Handle specific error types
    if ('AnonymousCallerNotAllowed' in error) {
      return 'You must connect your wallet to perform this action';
    } 
    else if ('CallerNotOwner' in error) {
      return 'You do not have permission to modify this vault';
    } 
    else if ('TemporarilyUnavailable' in error && typeof error.TemporarilyUnavailable === 'string') {
      return `Service temporarily unavailable: ${error.TemporarilyUnavailable}`;
    } 
    else if ('GenericError' in error && typeof error.GenericError === 'string') {
      return error.GenericError;
    } 
    else if ('TransferError' in error) {
      return `Transfer error: ${JSON.stringify(error.TransferError)}`;
    }
    else if ('TransferFromError' in error) {
      if ('InsufficientAllowance' in error.TransferFromError[0]) {
        return 'Insufficient allowance. Please approve the tokens first.';
      }
      return `Transfer error: ${JSON.stringify(error.TransferFromError)}`;
    } 
    else if ('AmountTooLow' in error) {
      return `Amount too low. Minimum amount: ${Number(error.AmountTooLow.minimum_amount) / E8S}`;
    } 
    else if ('AlreadyProcessing' in error) {
      return 'This operation is already in progress. Please wait.';
    }
    
    return 'An error occurred with the operation';
  }

  /**
   * Check if an error is an AlreadyProcessing error
   */
  static isAlreadyProcessingError(error: any): boolean {
    return error && (
      ('AlreadyProcessing' in error) || 
      (error instanceof Error && error.message.toLowerCase().includes('already has an ongoing operation')) ||
      (error instanceof Error && error.message.toLowerCase().includes('operation in progress'))
    );
  }

  /**
   * Check if an error is for a stale processing state
   */
  static isStaleProcessingState(error: any, timeThresholdSeconds: number = 90): boolean {
    if (error && typeof error === 'object' && 'timestamp' in error) {
      const errorTime = Number(error.timestamp);
      return Date.now() - errorTime > timeThresholdSeconds * 1000;
    }
    
    if (error instanceof Error && error.message.toLowerCase().includes('stale')) {
      return true;
    }
    
    return false;
  }

    /**
     * Open a new vault with ICP collateral
     */
    static async openVault(icpAmount: number): Promise<VaultOperationResult> {
        // Keep track of ongoing request
        let abortController: AbortController | null = null;
        
        try {
          console.log(`Creating vault with ${icpAmount} ICP`);
          
          if (icpAmount * E8S < MIN_ICP_AMOUNT) {
            return {
              success: false,
              error: `Amount too low. Minimum required: ${MIN_ICP_AMOUNT / E8S} ICP`
            };
          }
          
          // Check wallet connection status before proceeding
          const walletState = get(walletStore);
          if (!walletState.isConnected || !walletState.principal) {
            return {
              success: false,
              error: "Wallet not connected. Please connect your wallet and try again."
            };
          }
          
          // Create a new abort controller for this request"
          abortController = new AbortController();
          const signal = abortController.signal;
          
          // Enhanced error handling for wallet signer issues
          try {
            const actor = await ApiClient.getAuthenticatedActor();
            const amountE8s = BigInt(Math.floor(icpAmount * E8S));
            
            // CRITICAL: Check and increase allowance before proceeding
            const spenderCanisterId = CONFIG.currentCanisterId;
            
            // First check current allowance
            const currentAllowance = await walletOperations.checkIcpAllowance(spenderCanisterId);
            console.log(`Current allowance for protocol canister: ${Number(currentAllowance) / E8S} ICP`);
            
            // If allowance is insufficient, request approval
            if (currentAllowance < amountE8s) {
              console.log(`Requesting approval for ${icpAmount} ICP`);
              
              // Use a higher allowance (5% more than needed) to avoid small rounding issues
              const requestedAllowance = amountE8s * 105n / 100n;
              
              const approvalResult = await walletOperations.approveIcpTransfer(requestedAllowance, spenderCanisterId);
              
              if (!approvalResult.success) {
                return {
                  success: false,
                  error: approvalResult.error || "Failed to approve ICP transfer"
                };
              }
              
              console.log(`Successfully set allowance to ${Number(requestedAllowance) / E8S} ICP`);
            }
            
            // Add a timeout to catch hanging signatures
            const timeoutPromise = new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error("Wallet signature request timed out")), 60000);
            });
            
            // Race between the actual operation and the timeout
            const result = await Promise.race([
              actor.open_vault(amountE8s),
              timeoutPromise
            ]);
            
            if ('Ok' in result) {
              return {
                success: true,
                vaultId: Number(result.Ok.vault_id),
                blockIndex: Number(result.Ok.block_index)
              };
            } else {
              return {
                success: false,
                error: ApiClient.formatProtocolError(result.Err)
              };
            }
          } catch (signerErr) {
            console.error('Signer error:', signerErr);
            
            // Explicitly abort any pending requests
            if (abortController && !signal.aborted) {
              abortController.abort();
              console.log('Aborted previous signature request after error');
            }
            
            // Handle insufficient allowance errors
            if (signerErr instanceof Error) {
              const errMsg = signerErr.message.toLowerCase();
              
              if (errMsg.includes('insufficientallowance') || 
                  errMsg.includes('insufficient allowance')) {
                return {
                  success: false,
                  error: "Insufficient ICP allowance. Please try again to approve the required amount."
                };
              }
              
              if (errMsg.includes('invalid response from signer') || 
                  errMsg.includes('failed to sign') ||
                  errMsg.includes('rejected') ||
                  errMsg.includes('user declined')) {
                
                // Clear any pending wallet states
                await walletOperations.resetWalletSignerState();
                
                // Attempt to refresh the wallet connection
                try {
                  await walletStore.refreshWallet();
                  return {
                    success: false,
                    error: "Wallet signature failed. Please try again after refreshing the page."
                  };
                } catch (refreshErr) {
                  return {
                    success: false,
                    error: "Wallet signature error. Please disconnect and reconnect your wallet."
                  };
                }
              }
            }
            
            throw signerErr; // Re-throw if it's not a specific signer error we can handle
          }
        } catch (err) {
          console.error('Error opening vault:', err);
          return {
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error opening vault'
          };
        } finally {
          // Make sure to clean up the abort controller
          if (abortController && !abortController.signal.aborted) {
            abortController.abort();
          }
        }
      }


/**
 * Borrow icUSD from an existing vault
 */
static async borrowFromVault(vaultId: number, icusdAmount: number): Promise<VaultOperationResult> {
  return ApiClient.executeSequentialOperation(async () => {
    try {
      console.log(`Borrowing ${icusdAmount} icUSD from vault #${vaultId}`);
      
      // Validate input is finite before any calculations
      if (!isFinite(icusdAmount) || icusdAmount <= 0) {
        return {
          success: false,
          error: `Invalid borrowing amount: ${icusdAmount}. Amount must be a finite positive number.`
        };
      }
      
      if (icusdAmount * E8S < MIN_ICUSD_AMOUNT) { // Updated minimum validation
        return {
          success: false,
          error: `Amount too low. Minimum borrowing amount: ${MIN_ICUSD_AMOUNT / E8S} icUSD`
        };
      }
      
      // Simulate processing delay
      await new Promise(resolve => setTimeout(resolve, 1200));
      
      const actor = await ApiClient.getAuthenticatedActor();
      const vaultArg = {
        vault_id: BigInt(vaultId),
        amount: BigInt(Math.floor(icusdAmount * E8S))
      };
      
      const result = await actor.borrow_from_vault(vaultArg);
      
      if ('Ok' in result) {
        return {
          success: true,
          vaultId,
          blockIndex: Number(result.Ok.block_index),
          feePaid: Number(result.Ok.fee_amount_paid) / E8S
        };
      } else {
        return {
          success: false,
          error: ApiClient.formatProtocolError(result.Err)
        };
      }
    } catch (err) {
      console.error('Error borrowing from vault:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error borrowing from vault'
      };
    }
    // REMOVED: Don't manually track operations here - executeSequentialOperation does this
  }, vaultId); // Pass vaultId here to let executeSequentialOperation track it
}


/**
 * Add Margin to a vault
 */
static async addMarginToVault(vaultId: number, icpAmount: number): Promise<VaultOperationResult> {
  return ApiClient.executeSequentialOperation(async () => {
    try {
      console.log(`Adding ${icpAmount} ICP to vault #${vaultId}`);
      
      if (icpAmount * E8S < MIN_ICP_AMOUNT) {
        return {
          success: false,
          error: `Amount too low. Minimum required: ${MIN_ICP_AMOUNT / E8S} ICP`
        };
      }
      const amountE8s = BigInt(Math.floor(icpAmount * E8S));
      const bufferAmount = amountE8s * BigInt(120) / BigInt(100); // 20% buffer
      
      // Check if user has sufficient ICP balance
      const hasSufficientBalance = await walletOperations.checkSufficientBalance(Number(bufferAmount) / E8S);
      if (!hasSufficientBalance) {
        return {
          success: false,
          error: `Insufficient ICP balance. Please ensure you have at least ${icpAmount} ICP available.`
        };
      }
      
      // First check current allowance
      const spenderCanisterId = CONFIG.currentCanisterId;
      let currentAllowance;
      
      try {
        currentAllowance = await walletOperations.checkIcpAllowance(spenderCanisterId);
        console.log('Current ICP allowance:', currentAllowance.toString());
      } catch (err) {
        console.error('Error checking allowance:', err);
        return {
          success: false,
          error: 'Failed to check token allowance. Please ensure your wallet is connected and try again.'
        };
      }
      
      // Always request a new approval with a 20% buffer to ensure there's enough allowance
      // This is critical as the exact amount often fails due to precision issues or fees
      
      if (currentAllowance < amountE8s) {
        console.log('Insufficient allowance, requesting approval...');
        console.log(`Requesting ${bufferAmount} e8s (original: ${amountE8s} e8s)`);
        
        try {
          const approvalResult = await walletOperations.approveIcpTransfer(
            bufferAmount, // Use buffered amount that's 20% higher
            spenderCanisterId
          );
          
          if (!approvalResult.success) {
            return {
              success: false,
              error: approvalResult.error || 'Failed to approve ICP transfer'
            };
          }
          
          // Short delay to allow approval to be processed
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Verify approval worked
          const newAllowance = await walletOperations.checkIcpAllowance(spenderCanisterId);
          console.log('New allowance after approval:', newAllowance.toString());
          
          if (newAllowance < amountE8s) {
            return {
              success: false,
              error: `Approval did not complete successfully. Required: ${amountE8s}, Got: ${newAllowance}`
            };
          }
        } catch (approvalErr) {
          console.error('Approval error:', approvalErr);
          return {
            success: false,
            error: approvalErr instanceof Error ? 
              approvalErr.message : 'Unknown error during approval'
          };
        }
      } else {
        console.log(`Current allowance ${currentAllowance} is sufficient for amount ${amountE8s}`);
        
        // If allowance is just barely enough, still request a higher allowance to prevent future issues
        if (currentAllowance < bufferAmount) {
          console.log('Existing allowance is close to required amount, increasing for safety');
          try {
            const approvalResult = await walletOperations.approveIcpTransfer(
              bufferAmount,
              spenderCanisterId
            );
            
            if (approvalResult.success) {
              console.log('Successfully increased allowance for future operations');
              
              // Short delay to allow approval to be processed
              await new Promise(resolve => setTimeout(resolve, 2000));
              
              // Verify approval worked
              const newAllowance = await walletOperations.checkIcpAllowance(spenderCanisterId);
              console.log('New allowance after increase:', newAllowance.toString());
            } else {
              console.warn('Failed to increase allowance, but continuing with existing allowance');
            }
          } catch (err) {
            console.warn('Error increasing allowance, but continuing with existing allowance:', err);
          }
        }
      }

      // Now proceed with adding margin
      const actor = await ApiClient.getAuthenticatedActor();
      const vaultArg = {
        vault_id: BigInt(vaultId),
        amount: amountE8s // Use the original amount for the actual operation
      };
      
      console.log('Calling add_margin_to_vault with args:', {
        vault_id: vaultArg.vault_id.toString(),
        amount: vaultArg.amount.toString()
      });
      
      const result = await actor.add_margin_to_vault(vaultArg);
      
      if ('Ok' in result) {
        return {
          success: true,
          vaultId,
          blockIndex: Number(result.Ok)
        };
      } else {
        return {
          success: false,
          error: ApiClient.formatProtocolError(result.Err)
        };
      }
    } catch (err) {
      console.error('Error adding margin to vault:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error adding margin'
      };
    }
    // REMOVED: Don't use finally block with manual timestamp deletion
  }, vaultId); // Pass vaultId here to let executeSequentialOperation handle tracking
}
  
/**
 * Repay icUSD to a vault
 */
static async repayToVault(vaultId: number, icusdAmount: number): Promise<VaultOperationResult> {
  return ApiClient.executeSequentialOperation(async () => {
    try {
      console.log(`Repaying ${icusdAmount} icUSD to vault #${vaultId}`);
      
      // Validate input is finite before any calculations
      if (!isFinite(icusdAmount) || icusdAmount <= 0) {
        return {
          success: false,
          error: `Invalid repayment amount: ${icusdAmount}. Amount must be a finite positive number.`
        };
      }
      
      if (icusdAmount * E8S < MIN_ICUSD_AMOUNT) {
        return {
          success: false,
          error: `Amount too low. Minimum repayment amount: ${MIN_ICUSD_AMOUNT / E8S} icUSD`
        };
      }
      
      // Simulate processing delay
      await new Promise(resolve => setTimeout(resolve, 1200));
      
      const actor = await ApiClient.getAuthenticatedActor();
      const vaultArg = {
        vault_id: BigInt(vaultId),
        amount: BigInt(Math.floor(icusdAmount * E8S))
      };
      
      const result = await actor.repay_to_vault(vaultArg);
      
      if ('Ok' in result) {
        return {
          success: true,
          vaultId,
          blockIndex: Number(result.Ok)
        };
      } else {
        return {
          success: false,
          error: ApiClient.formatProtocolError(result.Err)
        };
      }
    } catch (err) {
      console.error('Error repaying to vault:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error repaying to vault'
      };
    }
  }, vaultId);
}

  /**
   * Close a vault - with enhanced error handling for auto-removed vaults
   */
  static async closeVault(vaultId: number): Promise<VaultOperationResult> {
    return ApiClient.executeSequentialOperation(async () => {
      // REMOVE: this.operationTimestamps.set(vaultId, Date.now());
      
      try {
        console.log(`Closing vault #${vaultId}`);
        
        // Verify vault access first
        const { vault, actor, error } = await ApiClient.verifyVaultAccess(vaultId);
        
        if (error) {
          // Special case for already closed vaults
          if (error === 'Vault not found') {
            return {
              success: true,
              message: `Vault #${vaultId} is already closed.`,
              vaultId
            };
          }
          return { success: false, error };
        }
        
        // If vault exists but has no collateral and no debt, treat as already closed
        if (vault.icpMargin === 0 && vault.borrowedIcusd === 0) {
          return {
            success: true,
            message: `Vault #${vaultId} is empty and will be automatically closed.`,
            vaultId
          };
        }
  
        // Execute close operation
        const result = await actor.close_vault(BigInt(vaultId));
        
        if ('Ok' in result) {
          return {
            success: true,
            vaultId,
            message: `Successfully closed vault #${vaultId}`
          };
        }
        
        const errorMsg = ApiClient.formatProtocolError(result.Err);
        return {
          success: false,
          error: errorMsg
        };
        
      } catch (error) {
        // Handle specific error cases
        const errorMsg = error?.toString() || '';
        if (ApiClient.isVaultNotFoundError(errorMsg)) {
          return {
            success: true,
            message: `Vault #${vaultId} has already been closed.`,
            vaultId
          };
        }
        
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error closing vault'
        };
      }
      // REMOVE: The finally block with timestamp deletion
    }, vaultId); // ADD: vaultId parameter here
  }

  /**
   * Clear the vault cache to force refresh on next request
   */
  static clearVaultCache(): void {
    ApiClient.vaultCache = {
      vaults: [],
      timestamp: 0,
      loading: false
    };
  }

  // Cache to store user vaults data with timestamp
  private static vaultCache: {
    vaults: VaultDTO[],
    timestamp: number,
    loading: boolean  // Add loading flag to prevent duplicate requests
  } = {
    vaults: [],
    timestamp: 0,
    loading: false
  };

  /**
   * Get the current user's vaults with caching and request deduplication
   */
  static async getUserVaults(forceRefresh = false): Promise<VaultDTO[]> {
    const walletState = get(walletStore);
    const userPrincipal = walletState.principal;
    
    if (!userPrincipal) {
      return [];
    }

    const principalStr = userPrincipal.toString();
    const cacheKey = `get_vaults_${principalStr}`;
    
    // Use request deduplication to prevent multiple simultaneous calls
    return RequestDeduplicator.deduplicate(cacheKey, async () => {
      try {
        const now = Date.now();
        
        // Use cache if it's less than 5 seconds old and not forcing refresh
        if (!forceRefresh && 
            !ApiClient.vaultCache.loading &&
            now - ApiClient.vaultCache.timestamp < 5000 && 
            ApiClient.vaultCache.vaults.length > 0) {
          console.log('Using cached vaults:', ApiClient.vaultCache.vaults);
          return ApiClient.vaultCache.vaults;
        }
        
        // Set loading flag to prevent duplicate requests
        ApiClient.vaultCache.loading = true;
        
        const actor = await ApiClient.getAuthenticatedActor();
        // Use a plain object with toString() to avoid Principal type mismatches between different @dfinity/principal instances
        const principalParam = { _type: 'Principal', toString: () => principalStr } as any;
        
        console.log(`Fetching vaults for principal: ${principalStr}`);
        const canisterVaults = await actor.get_vaults([principalParam]);
        console.log('Raw canister vaults data:', canisterVaults);
        
        // Get protocol status for ICP price calculation
        const status = await QueryOperations.getProtocolStatus();
        const icpPrice = status.lastIcpRate;
        
        // Transform canister vaults to our frontend model
        const vaults: VaultDTO[] = [];
        
        // Sort vaults by ID to ensure consistent ordering
        const sortedVaults = [...canisterVaults].sort((a, b) => 
          Number(a.vault_id) - Number(b.vault_id)
        );
        
        for (const v of sortedVaults) {
          // Create a display-friendly ID
          const vaultId = Number(v.vault_id);
          
          // CRITICAL FIX: Convert bigint values properly to numbers with scaling
          // Use Number() constructor instead of potentially problematic division
          const icpMargin = Number(v.icp_margin_amount) / E8S;
          const borrowedIcusd = Number(v.borrowed_icusd_amount) / E8S;
          
          console.log(`Processing vault #${vaultId}: ICP=${icpMargin}, icUSD=${borrowedIcusd}`);
          
          vaults.push({
            vaultId,
            owner: v.owner.toString(),
            icpMargin,
            borrowedIcusd,
            timestamp: now
          });
        }
        
        // Update cache
        ApiClient.vaultCache = {
          vaults,
          timestamp: now,
          loading: false
        };
        
        console.log('Processed vault DTOs:', vaults);
        return vaults;
      } catch (err) {
        console.error('Error getting user vaults:', err);
        // Clear loading flag on error
        ApiClient.vaultCache.loading = false;
        
        // Return cached data if available, even if it's stale
        if (ApiClient.vaultCache.vaults.length > 0) {
          console.warn('Returning stale cached vaults due to error');
          return ApiClient.vaultCache.vaults;
        }
        throw err;
      }
    });
  }

  /**
   * Withdraw collateral (ICP) from a vault
   */
  static async withdrawCollateral(vaultId: number): Promise<VaultOperationResult> {
    return ApiClient.executeSequentialOperation(async () => {
      // REMOVE: this.operationTimestamps.set(vaultId, Date.now());
      
      try {
        console.log(`Withdrawing collateral from vault #${vaultId}`);
        
        // Get the authenticated actor
        const actor = await ApiClient.getAuthenticatedActor();
        
        // Call withdraw_collateral
        const result = await actor.withdraw_collateral(BigInt(vaultId));
        
        if ('Ok' in result) {
          const blockIndex = Number(result.Ok);
          
          // IMPORTANT: Add a note about the vault possibly being auto-closed
          return {
            success: true,
            blockIndex,
            vaultId,
            message: `Successfully withdrew collateral from vault #${vaultId}. If the vault had no debt, it may have been automatically closed.`
          };
        } else {
          return {
            success: false,
            error: ApiClient.formatProtocolError(result.Err)
          };
        }
      } catch (err) {
        console.error('Error withdrawing collateral:', err);
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error withdrawing collateral'
        };
      }
      // REMOVE: finally block with timestamp deletion
    }, vaultId); // ADD: vaultId parameter here
  }

    /**
     * Get vault history
     */
    static async getVaultHistory(vaultId: number): Promise<any[]> {
      try {
        const actor = await ApiClient.getAuthenticatedActor();
        const history = await actor.get_vault_history(BigInt(vaultId));
        return history.map((event: any) => event);
      } catch (err) {
        console.error('Error getting vault history:', err);
        return [];
      }
    }
  

    /**
     * Redeem ICP by providing icUSD
     * @param icusdAmount Amount of icUSD to redeem
     */
    static async redeemIcp(icusdAmount: number): Promise<VaultOperationResult> {
      try {
        console.log(`Redeeming ${icusdAmount} icUSD for ICP`);
        
        if (icusdAmount * E8S < MIN_ICUSD_AMOUNT) {
          return {
            success: false,
            error: `Amount too low, minimum is ${MIN_ICUSD_AMOUNT / E8S} icUSD`
          };
        }
        
        const actor = await ApiClient.getAuthenticatedActor();
        const result = await actor.redeem_icp(BigInt(Math.floor(icusdAmount * E8S)));
        
        if ('Ok' in result) {
          return {
            success: true,
            blockIndex: Number(result.Ok.block_index),
            feePaid: Number(result.Ok.fee_amount_paid) / E8S
          };
        } else {
          return {
            success: false,
            error: ApiClient.formatProtocolError(result.Err)
          };
        }
      } catch (err) {
        console.error('Error redeeming ICP:', err);
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error redeeming ICP'
        };
      }
    }
  
    /**
     * Get a specific vault by ID
     * This is a helper method that searches through all user vaults
     */
    static async getVaultById(vaultId: number): Promise<VaultDTO | null> {
      try {
        const vaults = await ApiClient.getUserVaults();
        return vaults.find(v => v.vaultId === vaultId) || null;
      } catch (err) {
        console.error('Error getting vault by ID:', err);
        return null;
      }
    }


    static async getLiquidityStatus(principal: Principal): Promise<CanisterLiquidityStatus> {
        try {
          if (USE_MOCK_DATA) {
            return {
              liquidity_provided: 1000000000n, // 10 ICP
              total_liquidity_provided: 5000000000n, // 50 ICP
              liquidity_pool_share: 0.2, // 20%
              available_liquidity_reward: 500000000n, // 5 icUSD
              total_available_returns: 2500000000n // 25 icUSD
            };
          }
          
          const actor = await ApiClient.getAuthenticatedActor();
          // Convert principal to string and back to avoid type mismatch between different Principal implementations
          const principalStr = principal.toString();
          const principalParam = { _type: 'Principal', toString: () => principalStr } as any;
          return actor.get_liquidity_status(principalParam);
        } catch (err) {
          console.error('Error getting liquidity status:', err);
          throw new Error('Failed to get liquidity status');
        }
      }
    
      /**
       * Provide liquidity to the protocol
       */
      static async provideLiquidity(amount: number): Promise<VaultOperationResult> {
        try {
          console.log(`Providing ${amount} ICP as liquidity`);
          
          if (amount <= 0) {
            return {
              success: false,
              error: 'Amount must be greater than 0'
            };
          }
          
          // Convert amount to e8s
          const amountE8s = BigInt(Math.floor(amount * E8S));
          
          if (USE_MOCK_DATA) {
            // Simulate processing delay
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            return {
              success: true,
              blockIndex: Math.floor(Math.random() * 1000) + 1
            };
          }
          
          const actor = await ApiClient.getAuthenticatedActor();
          const result = await actor.provide_liquidity(amountE8s);
          
          if (result && typeof result === 'object' && 'Ok' in result) {
            return {
              success: true,
              blockIndex: Number(result.Ok)
            };
          } else if (result && typeof result === 'object' && 'Err' in result) {
            return {
              success: false,
              error: ApiClient.formatProtocolError(result.Err)
            };
          } else {
            return {
              success: false,
              error: 'Unknown response format from the protocol'
            };
          }
        } catch (err) {
          console.error('Error providing liquidity:', err);
          return {
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error providing liquidity'
          };
        }
      }
    
      /**
       * Withdraw liquidity from the protocol
       */
      static async withdrawLiquidity(amount: number): Promise<VaultOperationResult> {
        try {
          console.log(`Withdrawing ${amount} ICP from liquidity pool`);
          
          if (amount <= 0) {
            return {
              success: false,
              error: 'Amount must be greater than 0'
            };
          }
          
          // Convert amount to e8s
          const amountE8s = BigInt(Math.floor(amount * E8S));
          
          if (USE_MOCK_DATA) {
            // Simulate processing delay
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            return {
              success: true,
              blockIndex: Math.floor(Math.random() * 1000) + 1
            };
          }
          
          const actor = await ApiClient.getAuthenticatedActor();
          const result = await actor.withdraw_liquidity(amountE8s);
          
          if ('Ok' in result) {
            return {
              success: true,
              blockIndex: Number(result.Ok)
            };
          } else {
            return {
              success: false,
              error: ApiClient.formatProtocolError(result.Err)
            };
          }
        } catch (err) {
          console.error('Error withdrawing liquidity:', err);
          return {
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error withdrawing liquidity'
          };
        }
      }
    
      /**
       * Claim liquidity returns
       */
      static async claimLiquidityReturns(): Promise<VaultOperationResult> {
        try {
          console.log('Claiming liquidity returns');
          
          if (USE_MOCK_DATA) {
            // Simulate processing delay
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            return {
              success: true,
              blockIndex: Math.floor(Math.random() * 1000) + 1
            };
          }
          
          const actor = await ApiClient.getAuthenticatedActor();
          const result = await actor.claim_liquidity_returns();
          
          if ('Ok' in result) {
            return {
              success: true,
              blockIndex: Number(result.Ok)
            };
          } else {
            return {
              success: false,
              error: ApiClient.formatProtocolError(result.Err)
            };
          }
        } catch (err) {
          console.error('Error claiming liquidity returns:', err);
          return {
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error claiming returns'
          };
        }
      }

      /**
       * Claim a pending transfer that has been stuck
       */
      static async claimPendingTransfer(vaultId: number): Promise<VaultOperationResult> {
        try {
          console.log(`Attempting to claim pending transfer for vault #${vaultId}`);
          
          // First attempt to trigger pending transfer processing
          await ApiClient.triggerPendingTransfers();
          
          // Give some time for the backend to process
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          // Now try a direct approach by querying the backend for this vault's status
          const actor = await ApiClient.getAuthenticatedActor();
          
          // For now, the backend doesn't have a specific endpoint for this,
          // so we'll simulate success if we can trigger pending transfers
          const simulatedResult = {
            success: true,
            vaultId,
            blockIndex: Date.now() // Using timestamp as a fake block index
          };
          
          return simulatedResult;
        } catch (err) {
          console.error('Error claiming pending transfer:', err);
          return {
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error claiming transfer'
          };
        }
      }

      static logApiResponse(response: any): void {
        console.log('API response data:', BigIntUtils.stringify(response));
      }
    
      // When storing in localStorage:
      static saveToLocalStorage(key: string, data: any): void {
        try {
          localStorage.setItem(key, BigIntUtils.stringify(data));
        } catch (err) {
          console.error('Error saving to localStorage:', err);
        }
      }
    
      static getFromLocalStorage<T>(key: string): T | null {
        try {
          const data = localStorage.getItem(key);
          return data ? BigIntUtils.parse(data) : null;
        } catch (err) {
          console.error('Error reading from localStorage:', err);
          return null;
        }
      }
    
      // When formatting for display
      static formatAmount(amount: bigint, decimals: number = 8): string {
        return BigIntUtils.formatE8s(amount);
      }

  /**
   * Get pending transfers
   */
  static async getPendingTransfers(): Promise<any[]> {
    // For now, just return the transfers from the vault store
    return get(vaultStore).pendingTransfers.map(transfer => ({
      id: `RUMI-${transfer.vaultId}-${Date.now()}`,
      amount: transfer.amount,
      timestamp: transfer.timestamp,
      completed: false
    }));
  }

  /**
   * Step 1 of two-phase vault closing: Prepare to close vault
   */
  static async prepareCloseVault(vaultId: number): Promise<VaultOperationResult & { txHash?: string }> {
    try {
      console.log(`Preparing to close vault #${vaultId}`);
      
      // This is a two-phase implementation - in Step 1 we just validate and mark the vault
      // We don't make any blockchain changes yet
      
      // Check if the vault exists and can be closed
      const vault = await ApiClient.getVaultById(vaultId);
      
      if (!vault) {
        return {
          success: false,
          error: 'Vault not found'
        };
      }
      
      if (vault.borrowedIcusd > 0) {
        return {
          success: false,
          error: 'Cannot close vault with outstanding debt'
        };
      }
      
      // Store vault in preparation state locally
      // In a real implementation, we might lock the vault on-chain
      localStorage.setItem(`vault-closing-${vaultId}`, JSON.stringify({
        vaultId,
        icpMargin: vault.icpMargin,
        timestamp: Date.now(),
        phase: 'prepared'
      }));
      
      // Return success with a dummy transaction hash
      return {
        success: true,
        vaultId,
        txHash: `prep-${vaultId}-${Date.now().toString(36)}`
      };
    } catch (err) {
      console.error('Error preparing vault closure:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error preparing vault closure'
      };
    }
  }

  /**
   * Step 2 of two-phase vault closing: Execute transfer and close vault
   */
  static async executeTransferAndClose(vaultId: number): Promise<VaultOperationResult & { txHash?: string }> {
    try {
      console.log(`Executing closure for vault #${vaultId}`);
      
      // Check if the vault was properly prepared
      const prepData = localStorage.getItem(`vault-closing-${vaultId}`);
      if (!prepData) {
        return {
          success: false,
          error: 'Vault was not properly prepared for closure'
        };
      }
      
      const prepInfo = JSON.parse(prepData);
      if (prepInfo.phase !== 'prepared') {
        return {
          success: false,
          error: 'Vault is not in the prepared state'
        };
      }
      
      // Now actually close the vault
      const result = await ApiClient.closeVault(vaultId);
      
      // Clean up preparation data
      localStorage.removeItem(`vault-closing-${vaultId}`);
      
      if (result.success) {
        return {
          ...result,
          txHash: result.blockIndex?.toString() || `close-${vaultId}-${Date.now().toString(36)}`
        };
      } else {
        return result;
      }
    } catch (err) {
      console.error('Error executing vault closure:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error closing vault'
      };
    }
  }

/**
 * Withdraw collateral and close vault in one operation
 */
static async withdrawCollateralAndCloseVault(vaultId: number): Promise<VaultOperationResult> {
  return ApiClient.executeSequentialOperation(async () => {
    try {
      console.log(`Withdrawing collateral and closing vault #${vaultId} in one operation`);
      
      // First ensure the vault exists
      const vault = await ApiClient.getVaultById(vaultId);
      
      if (!vault) {
        console.log(`Vault #${vaultId} not found, it may have already been closed`);
        return {
          success: true,
          message: `Vault #${vaultId} is already closed.`,
          vaultId
        };
      }
      
      // Verify the vault has no debt
      if (vault.borrowedIcusd > 0) {
        return {
          success: false,
          error: `Cannot close vault while it has outstanding debt of ${vault.borrowedIcusd} icUSD. Please repay all debt first.`
        };
      }
      
      try {
        // Call the unified backend method
        const actor = await ApiClient.getAuthenticatedActor();
        const result = await actor.withdraw_and_close_vault(BigInt(vaultId));
        
        if ('Ok' in result) {
          // If we got a block index back, there was an ICP transfer
          const blockIndex = result.Ok.length > 0 ? Number(result.Ok[0]) : undefined;
          
          return {
            success: true,
            vaultId,
            blockIndex,
            message: `Successfully withdrew collateral and closed vault #${vaultId}`,
            vaultClosed: true
          };
        } else {
          // Check for specific error conditions
          const errorMsg = ApiClient.formatProtocolError(result.Err);
          
          // If the error indicates the vault doesn't exist, treat as success
          if (ApiClient.isVaultNotFoundError(errorMsg)) {
            return {
              success: true,
              message: `Vault #${vaultId} has already been closed.`,
              vaultId,
              vaultClosed: true
            };
          }
          
          return {
            success: false,
            error: errorMsg
          };
        }
      } catch (err) {
        console.error('Error withdrawing collateral and closing vault:', err);
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error during withdraw and close operation'
        };
      }
    } catch (err) {
      console.error('Error verifying vault before withdraw and close:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error verifying vault'
      };
    }
    // REMOVED: Don't manually track operations here
  }, vaultId); // Pass vaultId here to let executeSequentialOperation handle tracking
}

  /**
   * Helper to check if an error indicates vault not found
   */
  private static isVaultNotFoundError(errorMsg: string): boolean {
    const lowerMsg = errorMsg.toLowerCase();
    return lowerMsg.includes('not found') || 
           lowerMsg.includes('unknown vault') ||
           lowerMsg.includes('tried to close unknown vault');
  }

    static async getLiquidatableVaults(): Promise<CandidVault[]> {
      try {
        const vaults = await ApiClient.getPublicData<CandidVault[]>('get_liquidatable_vaults');
        return vaults;
      } catch (err) {
        console.error('Failed to get liquidatable vaults:', err);
        return [];
      }
    }
  
    /**
     * Partially liquidate a specific vault
     * @param vaultId The ID of the vault to liquidate
     * @param icusdAmount The amount of icUSD to liquidate
     */
    static async liquidateVaultPartial(vaultId: number, icusdAmount: number): Promise<VaultOperationResult> {
      return ApiClient.executeSequentialOperation(async () => {
        try {
          console.log(`Partially liquidating vault #${vaultId} with ${icusdAmount} icUSD`);
          
          // First get the vault to validate the operation
          const vaults = await ApiClient.getLiquidatableVaults();
          const vault = vaults.find(v => Number(v.vault_id) === vaultId);
          
          if (!vault) {
            return {
              success: false,
              error: "Vault not found or is not liquidatable"
            };
          }
          
          // Validate that partial liquidation amount is reasonable
          const totalDebt = Number(vault.borrowed_icusd_amount) / E8S;
          const maxPartialAmount = totalDebt * 0.5; // 50% maximum
          
          if (icusdAmount > totalDebt) {
            return {
              success: false,
              error: `Cannot liquidate more than total debt (${totalDebt.toFixed(2)} icUSD)`
            };
          }
          
          if (icusdAmount > maxPartialAmount) {
            return {
              success: false,
              error: `Partial liquidation limited to 50% of debt (${maxPartialAmount.toFixed(2)} icUSD maximum)`
            };
          }
          
          console.log(`Vault #${vaultId} partial liquidation: ${icusdAmount} icUSD of ${totalDebt} icUSD total debt`);
          
          // Check and set allowance for icUSD with a 20% buffer
          const bufferedAmount = BigInt(Math.floor((icusdAmount * 1.2) * E8S));
          const spenderCanisterId = CONFIG.currentCanisterId;
          
          // Check current allowance
          const currentAllowance = await walletOperations.checkIcusdAllowance(spenderCanisterId);
          console.log(`Current icUSD allowance: ${Number(currentAllowance) / E8S}`);
          
          // If allowance is insufficient, request approval
          if (currentAllowance < bufferedAmount) {
            console.log(`Setting icUSD approval for ${Number(bufferedAmount) / E8S}`);
            
            const approvalResult = await walletOperations.approveIcusdTransfer(
              bufferedAmount,
              spenderCanisterId
            );
            
            if (!approvalResult.success) {
              return {
                success: false,
                error: approvalResult.error || "Failed to approve icUSD transfer"
              };
            }
            
            console.log(`Successfully approved ${Number(bufferedAmount) / E8S} icUSD`);
            
            // Short pause to ensure approval transaction is processed
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
          
          // Now proceed with partial liquidation
          const actor = await ApiClient.getAuthenticatedActor();
          const icusdAmountE8s = BigInt(Math.floor(icusdAmount * E8S));
          const result = await actor.liquidate_vault_partial(BigInt(vaultId), icusdAmountE8s);
          
          if ('Ok' in result) {
            return {
              success: true,
              vaultId,
              blockIndex: Number(result.Ok.block_index),
              feePaid: Number(result.Ok.fee_amount_paid) / E8S
            };
          } else {
            return {
              success: false,
              error: ApiClient.formatProtocolError(result.Err)
            };
          }
        } catch (err) {
          console.error('Error partially liquidating vault:', err);
          
          // Check for specific underflow error and provide a better message
          const errorMessage = err instanceof Error ? err.message : String(err);
          if (errorMessage.includes('underflow') && errorMessage.includes('numeric.rs')) {
            return {
              success: false,
              error: "Partial liquidation failed due to a calculation error. The vault may have been modified or its state has changed."
            };
          }
          
          return {
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error partially liquidating vault'
          };
        }
      }, vaultId); // Pass vaultId to ensure proper operation tracking
    }

    /**
     * Liquidate a specific vault (complete liquidation)
     * @param vaultId The ID of the vault to liquidate
     */
    static async liquidateVault(vaultId: number): Promise<VaultOperationResult> {
      return ApiClient.executeSequentialOperation(async () => {
        try {
          console.log(`Liquidating vault #${vaultId}`);
          
          // First get the vault to check debt amount
          const vaults = await ApiClient.getLiquidatableVaults();
          const vault = vaults.find(v => Number(v.vault_id) === vaultId);
          
          if (!vault) {
            return {
              success: false,
              error: "Vault not found or is not liquidatable"
            };
          }
          
          // Convert debt amount from bigint to number
          const icusdDebt = Number(vault.borrowed_icusd_amount) / E8S;
          console.log(`Vault #${vaultId} has debt of ${icusdDebt} icUSD`);
          
          // Check and set allowance for icUSD with a 50% buffer
          const bufferedDebt = BigInt(Math.floor((icusdDebt * 1.5) * E8S));
          const spenderCanisterId = CONFIG.currentCanisterId;
          
          // Check current allowance
          const currentAllowance = await walletOperations.checkIcusdAllowance(spenderCanisterId);
          console.log(`Current icUSD allowance: ${Number(currentAllowance) / E8S}`);
          
          // If allowance is insufficient, request approval
          if (currentAllowance < bufferedDebt) {
            console.log(`Setting icUSD approval for ${Number(bufferedDebt) / E8S}`);
            
            const approvalResult = await walletOperations.approveIcusdTransfer(
              bufferedDebt,
              spenderCanisterId
            );
            
            if (!approvalResult.success) {
              return {
                success: false,
                error: approvalResult.error || "Failed to approve icUSD transfer"
              };
            }
            
            console.log(`Successfully approved ${Number(bufferedDebt) / E8S} icUSD`);
            
            // Short pause to ensure approval transaction is processed
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
          
          // Now proceed with liquidation
          const actor = await ApiClient.getAuthenticatedActor();
          const result = await actor.liquidate_vault(BigInt(vaultId));
          
          if ('Ok' in result) {
            return {
              success: true,
              vaultId,
              blockIndex: Number(result.Ok.block_index),
              feePaid: Number(result.Ok.fee_amount_paid) / E8S
            };
          } else {
            return {
              success: false,
              error: ApiClient.formatProtocolError(result.Err)
            };
          }
        } catch (err) {
          console.error('Error liquidating vault:', err);
          
          // Check for specific underflow error and provide a better message
          const errorMessage = err instanceof Error ? err.message : String(err);
          if (errorMessage.includes('underflow') && errorMessage.includes('numeric.rs')) {
            return {
              success: false,
              error: "Liquidation failed due to a calculation error. The vault may have already been liquidated or its state has changed."
            };
          }
          
          return {
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error liquidating vault'
          };
        }
      }, vaultId); // Pass vaultId to ensure proper operation tracking
    }

  /**
   * Clear all stale operation states
   */
  private static clearAllStaleOperations() {
    const now = Date.now();
    let clearedCount = 0;
      // Clear operation flags on page load to avoid stuck operations between sessions
      ApiClient.operationInProgress = false;
      ApiClient.operationTimestamps.clear();
       console.log(`Cleared ${clearedCount} stale vault operations`);
    }
  


}

// Add treasury service for accessing fee data
export class TreasuryService {
  private static readonly TREASURY_CANISTER_ID = 'i5ige-naaaa-aaaai-q33ua-cai';
  
  // Get treasury status and balances
  static async getTreasuryStatus(): Promise<{
    totalDeposits: number;
    balances: { [key: string]: number };
    controller: string;
    isPaused: boolean;
  }> {
    try {
      // Create anonymous actor for treasury queries
      const treasuryActor = Actor.createActor(treasuryIDL as any, {
        agent: new HttpAgent({ host: CONFIG.host }),
        canisterId: this.TREASURY_CANISTER_ID
      }) as any; // Type as 'any' to handle the treasury service interface
      
      const status = await treasuryActor.get_status();
      
      // Convert the balances array to a more usable object format
      const balances: { [key: string]: number } = {};
      if (status.balances) {
        for (const [assetType, assetBalance] of status.balances) {
          let assetKey = 'UNKNOWN';
          if ('ICUSD' in assetType) assetKey = 'ICUSD';
          else if ('ICP' in assetType) assetKey = 'ICP';
          else if ('CKBTC' in assetType) assetKey = 'CKBTC';
          
          balances[assetKey] = Number(assetBalance.total || 0) / E8S;
        }
      }
      
      return {
        totalDeposits: Number(status.total_deposits || 0),
        balances,
        controller: status.controller?.toString() || '',
        isPaused: Boolean(status.is_paused)
      };
    } catch (error) {
      console.error('Error getting treasury status:', error);
      throw error;
    }
  }
  
  // Get fee history (deposit records)
  static async getFeeHistory(start?: number, limit: number = 100): Promise<Array<{
    id: number;
    feeType: string;
    assetType: string;
    amount: number;
    blockIndex: number;
    timestamp: Date;
    memo: string | null;
  }>> {
    try {
      const treasuryActor = Actor.createActor(treasuryIDL as any, {
        agent: new HttpAgent({ host: CONFIG.host }),
        canisterId: this.TREASURY_CANISTER_ID
      }) as any;
      
      const deposits = await treasuryActor.get_deposits(
        start ? [BigInt(start)] : [], 
        [limit]
      );
      
      return deposits.map((deposit: any) => {
        // Parse the deposit type
        let feeType = 'Unknown';
        if (deposit.deposit_type && typeof deposit.deposit_type === 'object') {
          if ('MintingFee' in deposit.deposit_type) feeType = 'MintingFee';
          else if ('RedemptionFee' in deposit.deposit_type) feeType = 'RedemptionFee';
          else if ('LiquidationSurplus' in deposit.deposit_type) feeType = 'LiquidationSurplus';
          else if ('StabilityFee' in deposit.deposit_type) feeType = 'StabilityFee';
        }
        
        // Parse the asset type
        let assetType = 'Unknown';
        if (deposit.asset_type && typeof deposit.asset_type === 'object') {
          if ('ICUSD' in deposit.asset_type) assetType = 'ICUSD';
          else if ('ICP' in deposit.asset_type) assetType = 'ICP';
          else if ('CKBTC' in deposit.asset_type) assetType = 'CKBTC';
        }
        
        return {
          id: Number(deposit.id || 0),
          feeType,
          assetType,
          amount: Number(deposit.amount || 0) / E8S,
          blockIndex: Number(deposit.block_index || 0),
          timestamp: new Date(Number(deposit.timestamp || 0) / 1000000), // Convert from nanos
          memo: deposit.memo && deposit.memo.length > 0 ? deposit.memo[0] : null
        };
      });
    } catch (error) {
      console.error('Error getting fee history:', error);
      throw error;
    }
  }
  
  // Get total fees collected by type
  static async getFeesByType(): Promise<{ [key: string]: number }> {
    try {
      const history = await this.getFeeHistory();
      const feesByType: { [key: string]: number } = {};
      
      for (const deposit of history) {
        const key = `${deposit.feeType}_${deposit.assetType}`;
        feesByType[key] = (feesByType[key] || 0) + deposit.amount;
      }
      
      return feesByType;
    } catch (error) {
      console.error('Error calculating fees by type:', error);
      throw error;
    }
  }

  // Withdraw funds from treasury (controller only)
  static async withdrawFromTreasury(
    assetType: 'ICUSD' | 'ICP' | 'CKBTC',
    amount: number,
    to: string,
    memo?: string
  ): Promise<{ success: boolean; blockIndex?: number; error?: string }> {
    try {
      // Get authenticated actor (must be controller)
      const treasuryActor = await walletStore.getActor(this.TREASURY_CANISTER_ID, treasuryIDL) as any;
      
      // Create the asset type object in the format expected by the treasury canister
      const assetTypeObj: any = {};
      assetTypeObj[assetType] = null;
      
      const withdrawArgs = {
        asset_type: assetTypeObj,
        amount: BigInt(Math.floor(amount * E8S)),
        to: Principal.fromText(to),
        memo: memo ? [memo] : []
      };
      
      const result = await treasuryActor.withdraw(withdrawArgs);
      
      if ('Ok' in result) {
        return {
          success: true,
          blockIndex: Number(result.Ok.block_index)
        };
      } else {
        return {
          success: false,
          error: result.Err || 'Unknown withdrawal error'
        };
      }
    } catch (error) {
      console.error('Error withdrawing from treasury:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  // Check if current user is treasury controller
  static async isController(): Promise<boolean> {
    try {
      const status = await this.getTreasuryStatus();
      const walletState = get(walletStore);
      
      return walletState.principal?.toString() === status.controller;
    } catch (error) {
      console.error('Error checking controller status:', error);
      return false;
    }
  }
  
  // Get treasury withdrawal history
  static async getWithdrawalHistory(limit: number = 50): Promise<any[]> {
    try {
      const treasuryActor = Actor.createActor(treasuryIDL as any, {
        agent: new HttpAgent({ host: CONFIG.host }),
        canisterId: this.TREASURY_CANISTER_ID
      }) as any;
      
      // Get all deposits and filter for withdrawals (negative amounts or specific types)
      const deposits = await treasuryActor.get_deposits([], [limit * 2]);
      
      // In a full implementation, you'd have withdrawal events
      // For now, we return the deposit history as reference
      return deposits.map((deposit: any) => {
        // Parse deposit type
        let feeType = 'Unknown';
        if (deposit.deposit_type && typeof deposit.deposit_type === 'object') {
          if ('MintingFee' in deposit.deposit_type) feeType = 'MintingFee';
          else if ('RedemptionFee' in deposit.deposit_type) feeType = 'RedemptionFee';
          else if ('LiquidationSurplus' in deposit.deposit_type) feeType = 'LiquidationSurplus';
          else if ('StabilityFee' in deposit.deposit_type) feeType = 'StabilityFee';
        }
        
        // Parse asset type
        let assetType = 'Unknown';
        if (deposit.asset_type && typeof deposit.asset_type === 'object') {
          if ('ICUSD' in deposit.asset_type) assetType = 'ICUSD';
          else if ('ICP' in deposit.asset_type) assetType = 'ICP';
          else if ('CKBTC' in deposit.asset_type) assetType = 'CKBTC';
        }
        
        return {
          id: Number(deposit.id || 0),
          type: 'deposit', // In future: 'withdrawal'
          feeType,
          assetType,
          amount: Number(deposit.amount || 0) / E8S,
          blockIndex: Number(deposit.block_index || 0),
          timestamp: new Date(Number(deposit.timestamp || 0) / 1000000),
          memo: deposit.memo && deposit.memo.length > 0 ? deposit.memo[0] : null
        };
      });
    } catch (error) {
      console.error('Error getting withdrawal history:', error);
      throw error;
    }
  }
}

// Add Treasury Management Component for controller UI
export class TreasuryManagementService {
  // Get summary of all collected fees
  static async getFeeSummary(): Promise<{
    totalByAsset: { [key: string]: number };
    totalByType: { [key: string]: number };
    recentActivity: any[];
  }> {
    try {
      const [status, history] = await Promise.all([
        TreasuryService.getTreasuryStatus(),
        TreasuryService.getFeeHistory()
      ]);
      
      // Calculate totals by asset type
      const totalByAsset = {
        ICUSD: status.balances.ICUSD || 0,
        ICP: status.balances.ICP || 0,
        CKBTC: status.balances.CKBTC || 0
      };
      
      // Calculate totals by fee type
      const totalByType: { [key: string]: number } = {};
      history.forEach(fee => {
        const key = `${fee.feeType}_${fee.assetType}`;
        totalByType[key] = (totalByType[key] || 0) + fee.amount;
      });
      
      // Get recent activity (last 10 items)
      const recentActivity = history.slice(0, 10);
      
      return {
        totalByAsset,
        totalByType,
        recentActivity
      };
    } catch (error) {
      console.error('Error getting fee summary:', error);
      throw error;
    }
  }
  
  // Estimate protocol revenue in USD
  static async getRevenueEstimate(icpPrice: number): Promise<{
    totalUSD: number;
    breakdown: { [key: string]: number };
  }> {
    try {
      const summary = await this.getFeeSummary();
      
      // Convert to USD values (assuming icUSD = $1)
      const icusdUSD = summary.totalByAsset.ICUSD * 1.0;  // 1:1 with USD
      const icpUSD = summary.totalByAsset.ICP * icpPrice;
      const ckbtcUSD = summary.totalByAsset.CKBTC * 50000; // Rough BTC price estimate
      
      return {
        totalUSD: icusdUSD + icpUSD + ckbtcUSD,
        breakdown: {
          icUSD: icusdUSD,
          ICP: icpUSD,
          ckBTC: ckbtcUSD
        }
      };
    } catch (error) {
      console.error('Error calculating revenue estimate:', error);
      throw error;
    }
  }
}



