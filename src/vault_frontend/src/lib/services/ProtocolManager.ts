import type { Principal } from '@dfinity/principal';
import { ApiClient } from './protocol/apiClient';
import { walletOperations } from './protocol/walletOperations';
import { QueryOperations } from './protocol/queryOperations';
import type { VaultOperationResult } from './types';
import { processingStore, ProcessingStage } from '$lib/stores/processingStore';
import { walletStore } from '$lib/stores/wallet';
import { get } from 'svelte/store';
import { CONFIG } from '../config';
import { vaultStore } from '../stores/vaultStore';

/**
 * ProtocolManager provides operation queueing, error handling, and retries for API operations.
 * It enhances the ApiClient with additional processing logic and state management.
 */
export class ProtocolManager {
  private static instance: ProtocolManager;
  private operationQueue: Map<string, Promise<any>> = new Map();
  private processingOperation: string | null = null;
  private abortControllers: Map<string, AbortController> = new Map(); // Track abort controllers
  private operationStartTimes: Map<string, number> = new Map(); // Track when operations started

  private constructor() {}

  static getInstance(): ProtocolManager {
    if (!this.instance) {
      this.instance = new ProtocolManager();
    }
    return this.instance;
  }

  /**
   * Validates if the protocol is in a state where an operation can be executed
   */
  private async validateOperation(operation: string): Promise<void> {
    const status = await QueryOperations.getProtocolStatus();
    
    if (status.mode === 'AlreadyProcessing') {
      const timestamp = Number(status.lastIcpTimestamp) / 1_000_000;
      const age = Date.now() - timestamp;
      
      if (age > 90000) { // > 90 seconds
        await this.clearStaleProcessingState();
        return;
      }
      throw new Error('System is currently processing another operation');
    }
  }

  /**
   * Clear a stale processing state on the backend
   */
  private async clearStaleProcessingState(): Promise<void> {
    try {
      console.log('Attempting to clear stale processing state');
      // Simplified approach that uses the ApiClient directly
      await ApiClient.triggerPendingTransfers();
    } catch (err) {
      console.error('Failed to clear stale processing state:', err);
      throw new Error('Failed to clear stale processing state');
    }
  }

  /**
   * Core method to execute protocol operations with consistent error handling, 
   * queueing, and retries.
   */
  async executeOperation<T>(
    operation: string,
    executor: () => Promise<T>,
    preChecks?: () => Promise<void>
  ): Promise<T> {
    // Check if operation is already in progress
    if (this.operationQueue.has(operation)) {
      // Check if the operation is stale (running for too long)
      const startTime = this.operationStartTimes.get(operation) || 0;
      const operationAge = Date.now() - startTime;
      
      // If operation has been running for more than 2 minutes, consider it stale
      if (operationAge > 120000) { // 2 minutes
        console.warn(`Found stale operation "${operation}" running for ${operationAge}ms, force aborting`);
        
        // Abort the previous operation
        this.abortPreviousOperation(operation);
        
        // Clean up resources for the stale operation
        this.operationQueue.delete(operation);
        this.operationStartTimes.delete(operation);
      } else {
        // Operation is still recent, don't allow a duplicate
        console.warn(`Operation "${operation}" already in progress (for ${operationAge}ms), rejecting duplicate request`);
        throw new Error('Operation already in progress. Please wait.');
      }
    }

    // Create a new abort controller for this operation
    const abortController = new AbortController();
    this.abortControllers.set(operation, abortController);
    
    // Record start time
    this.operationStartTimes.set(operation, Date.now());

    try {
      // Add to queue
      const promise = (async () => {
        processingStore.setStage(ProcessingStage.CHECKING);
        
        // Run pre-checks if provided
        if (preChecks) await preChecks();
        
        // Validate system state
        await this.validateOperation(operation);
        
        processingStore.setStage(ProcessingStage.CREATING);
        
        // Check if operation has been aborted
        if (abortController.signal.aborted) {
          throw new Error('Operation was aborted');
        }
        
        // Add a timeout to prevent operations from hanging indefinitely
        const operationWithTimeout = Promise.race([
          executor(),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`Operation "${operation}" timed out after 5 minutes`)), 300000); // 5 min timeout
          })
        ]);
        
        // Execute operation with retry for 'AlreadyProcessing' errors
        let retryCount = 0;
        const maxRetries = 2;
        
        while (true) {
          try {
            return await operationWithTimeout;
          } catch (err) {
            if (retryCount >= maxRetries || 
                !ApiClient.isAlreadyProcessingError(err)) {
              throw err;
            }
            
            // If we get an AlreadyProcessing error, wait and retry
            console.log(`Retrying operation ${operation} after AlreadyProcessing error (retry ${retryCount + 1}/${maxRetries})`);
            retryCount++;
            
            // Wait for progressively longer periods between retries
            const waitMs = 5000 * retryCount; 
            await new Promise(resolve => setTimeout(resolve, waitMs));
          }
        }
      })();

      this.operationQueue.set(operation, promise);
      this.processingOperation = operation;

      const result = await promise;
      processingStore.setStage(ProcessingStage.DONE);
      return result;
    } catch (error) {
      // Handle specific error types
      if (error instanceof Error) {
        const errMsg = error.message.toLowerCase();
        
        // Handle allowance errors
        if (errMsg.includes('insufficientallowance') || 
            errMsg.includes('insufficient allowance')) {
          processingStore.setStage(ProcessingStage.APPROVING);
          console.warn('Insufficient allowance error, attempting to handle...');
          
          try {
            // Try again after a short delay
            await new Promise(resolve => setTimeout(resolve, 1000));
            return await executor();
          } catch (retryErr) {
            console.error('Approval retry failed:', retryErr);
            processingStore.setStage(ProcessingStage.FAILED, 2); // 2 = approval error code
            throw retryErr;
          }
        }
        
        // Handle "already processing" errors
        else if (ApiClient.isAlreadyProcessingError(error)) {
          console.warn('Operation already in progress, handling...');
          processingStore.setStage(ProcessingStage.FAILED, 4); // 4 = already processing error code
        }
        
        // Handle "invalid signer" or "invalid response from signer" errors specially
        else if (
          errMsg.includes('invalid response from signer') || 
          errMsg.includes('failed to sign') ||
          errMsg.includes('received invalid response from signer')
        ) {
          console.warn('Cleaning up after signer error:', error.message);
          
          // Reset wallet state for future operations
          await this.resetWalletState();
          
          // Try operation one more time, but catch any further errors
          try {
            processingStore.setStage(ProcessingStage.CREATING);
            return await executor();
          } catch (retryErr) {
            console.error('Retry after signer error failed:', retryErr);
            processingStore.setStage(ProcessingStage.FAILED, 3); // 3 = signer error code
            throw new Error(`Operation failed after retry: ${retryErr instanceof Error ? retryErr.message : 'Unknown error'}`);
          }
        } 
        else {
          // Generic error handling
          processingStore.setStage(ProcessingStage.FAILED, 1);
        }
      } else {
        processingStore.setStage(ProcessingStage.FAILED, 0);
      }
      
      throw error;
    } finally {
      // Clean up resources
      this.operationQueue.delete(operation);
      this.abortControllers.delete(operation);
      this.operationStartTimes.delete(operation);
      
      if (this.processingOperation === operation) {
        this.processingOperation = null;
      }
    }
  }

  // Abort a previous operation by name
  private abortPreviousOperation(operation: string): void {
    const controller = this.abortControllers.get(operation);
    if (controller && !controller.signal.aborted) {
      console.log(`Aborting previous operation: ${operation}`);
      controller.abort();
    }
  }

  // More robust wallet state reset
  private async resetWalletState(): Promise<void> {
    try {
      console.log('Performing complete wallet reset after signer error');
      
      // Clear all ongoing operations
      for (const [op, controller] of this.abortControllers.entries()) {
        if (!controller.signal.aborted) {
          console.log(`Aborting operation ${op} during wallet reset`);
          controller.abort();
        }
        this.operationQueue.delete(op);
      }
      this.abortControllers.clear();
      
      // Reset processing state
      processingStore.reset();
      
      // Complete wallet refresh with auto-reconnect
      try {
        // First disconnect
        await walletStore.disconnect().catch(() => {});
        
        // Short delay to ensure clean state
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Reconnect with last used wallet
        const lastWallet = localStorage.getItem('rumi_last_wallet');
        if (lastWallet) {
          console.log(`Attempting to reconnect to wallet ${lastWallet}`);
          await walletStore.connect(lastWallet);
        }
      } catch (err) {
        console.warn('Failed to refresh wallet:', err);
      }
    } catch (err) {
      console.error('Error resetting wallet state:', err);
    }
  }

  // Clean stale operations - call this periodically
  public cleanStaleOperations(): void {
    const now = Date.now();
    
    for (const [operation, startTime] of this.operationStartTimes.entries()) {
      const operationAge = now - startTime;
      
      // If operation has been running for more than 5 minutes, abort it
      if (operationAge > 300000) { // 5 minutes
        console.warn(`Cleaning up stale operation "${operation}" running for ${operationAge}ms`);
        
        // Abort the operation
        this.abortPreviousOperation(operation);
        
        // Clean up resources
        this.operationQueue.delete(operation);
        this.abortControllers.delete(operation);
        this.operationStartTimes.delete(operation);
        
        if (this.processingOperation === operation) {
          this.processingOperation = null;
        }
      }
    }
  }

  // VAULT OPERATIONS WITH ENHANCED PRE-CHECKS AND ERROR HANDLING
  // These operations use executeOperation to provide consistent processing

  /**
   * Create a new vault with ICP collateral
   */
  async createVault(collateralAmount: number): Promise<VaultOperationResult> {
    return this.executeOperation(
      'createVault',
      () => ApiClient.openVault(collateralAmount),
      async () => {
        try {
          // Pre-checks
          await walletOperations.checkSufficientBalance(collateralAmount);
          
          // Add additional wallet check before proceeding
          const walletState = get(walletStore);
          if (!walletState.isConnected) {
            throw new Error('Wallet disconnected. Please reconnect and try again.');
          }
          
          // Try to refresh the wallet connection to avoid stale sessions
          try {
            await walletStore.refreshWallet();
            
            // CRITICAL: Pre-check allowance before continuing
            const amountE8s = BigInt(Math.floor(collateralAmount * 100_000_000));
            const spenderCanisterId = CONFIG.currentCanisterId;
            const currentAllowance = await walletOperations.checkIcpAllowance(spenderCanisterId);
            
            console.log(`Pre-check: Current allowance: ${Number(currentAllowance) / 100_000_000} ICP`);
            console.log(`Pre-check: Required allowance: ${collateralAmount} ICP`);
            
            if (currentAllowance < amountE8s) {
              processingStore.setStage(ProcessingStage.APPROVING);
              console.log("Setting approval stage - insufficient allowance detected");
            }
          } catch (refreshErr) {
            console.warn('Wallet refresh failed, continuing with current connection', refreshErr);
          }
        } catch (err) {
          console.error('Vault pre-check error:', err);
          throw err;
        }
      }
    );
  }

  /**
   * Borrow icUSD from an existing vault
   */
  async borrowFromVault(vaultId: number, icusdAmount: number): Promise<VaultOperationResult> {
    return this.executeOperation(
      `borrowFromVault:${vaultId}`,
      () => ApiClient.borrowFromVault(vaultId, icusdAmount)
    );
  }

  /**
   * Add ICP margin to an existing vault
   */
  async addMarginToVault(vaultId: number, icpAmount: number): Promise<VaultOperationResult> {
    return this.executeOperation(
      `addMarginToVault:${vaultId}`,
      () => ApiClient.addMarginToVault(vaultId, icpAmount),
      async () => {
        // Check if the user has sufficient balance
        await walletOperations.checkSufficientBalance(icpAmount);
      }
    );
  }

  /**
   * Repay icUSD to a vault
   */
  async repayToVault(vaultId: number, icusdAmount: number): Promise<VaultOperationResult> {
    return this.executeOperation(
      `repayToVault:${vaultId}`,
      async () => {
        try {
          // Check and set allowance for icUSD before repaying
          const amountE8s = BigInt(Math.floor(icusdAmount * 100_000_000));
          const spenderCanisterId = CONFIG.currentCanisterId;
          
          // Check current allowance
          const currentAllowance = await walletOperations.checkIcusdAllowance(spenderCanisterId);
          console.log(`Current icUSD allowance: ${Number(currentAllowance) / 100_000_000}`);
          
          // If allowance is insufficient, request approval first
          if (currentAllowance < amountE8s) {
            console.log(`Setting icUSD approval for ${icusdAmount}`);
            processingStore.setStage(ProcessingStage.APPROVING);
            
            // Request approval with a buffer (10% more) to handle any fees
            const approvalAmount = amountE8s * BigInt(110) / BigInt(100);
            const approvalResult = await walletOperations.approveIcusdTransfer(
              approvalAmount, 
              spenderCanisterId
            );
            
            if (!approvalResult.success) {
              return {
                success: false,
                error: approvalResult.error || "Failed to approve icUSD transfer"
              };
            }
            
            console.log(`Successfully approved ${Number(approvalAmount) / 100_000_000} icUSD`);
            
            // Short pause to ensure approval transaction is processed
            await new Promise(resolve => setTimeout(resolve, 1000));
            processingStore.setStage(ProcessingStage.CREATING);
          }
          
          // Now proceed with the repayment
          return await ApiClient.repayToVault(vaultId, icusdAmount);
        } catch (error) {
          console.error('Error during repayment flow:', error);
          
          if (error instanceof Error) {
            const errorMsg = error.message.toLowerCase();
            
            if (errorMsg.includes('insufficientallowance') || 
                errorMsg.includes('insufficient allowance')) {
              return {
                success: false,
                error: "Insufficient icUSD allowance. Please try the operation again."
              };
            }
          }
          
          throw error;
        }
      },
      async () => {
        // Pre-check to verify the user has sufficient icUSD balance
        const walletState = get(walletStore);
        if (!walletState.isConnected) {
          throw new Error('Wallet disconnected. Please reconnect and try again.');
        }
        
        // Check if the user has the required icUSD balance
        try {
          const icusdBalance = await walletOperations.getIcusdBalance();
          if (icusdBalance < icusdAmount) {
            throw new Error(`Insufficient icUSD balance. You have ${icusdBalance} icUSD but trying to repay ${icusdAmount} icUSD.`);
          }
          
          // Pre-check allowance to set the right UI state early
          const amountE8s = BigInt(Math.floor(icusdAmount * 100_000_000));
          const spenderCanisterId = CONFIG.currentCanisterId;
          const currentAllowance = await walletOperations.checkIcusdAllowance(spenderCanisterId);
          
          console.log(`Pre-check: Current icUSD allowance: ${Number(currentAllowance) / 100_000_000}`);
          console.log(`Pre-check: Required icUSD allowance: ${icusdAmount}`);
          
          if (currentAllowance < amountE8s) {
            processingStore.setStage(ProcessingStage.APPROVING);
            console.log("Setting approval stage - insufficient icUSD allowance detected");
          }
        } catch (err) {
          console.warn('Balance or allowance check error:', err);
          // Continue with operation even if balance check fails
        }
      }
    );
  }

  /**
   * Close an existing vault
   */
  async closeVault(vaultId: number): Promise<VaultOperationResult> {
    return this.executeOperation(
      `closeVault:${vaultId}`,
      async () => {
        try {
          // Extra checks before closing the vault
          const currentVault = await this.getVaultDetails(vaultId);
          
          if (!currentVault) {
            return {
              success: false,
              error: 'Vault not found'
            };
          }
          
          // Add safety mechanism to ensure clean signer state before closing
          try {
            console.log("Performing preliminary wallet refresh to ensure clean state");
            await walletStore.refreshWallet().catch(() => {});
          } catch (refreshErr) {
            console.warn("Preliminary refresh failed, continuing anyway:", refreshErr);
          }
          
          if (currentVault.borrowedIcusd > 0) {
            return {
              success: false,
              error: 'Cannot close vault with outstanding debt. Repay all debt first.'
            };
          }
          
          if (currentVault.icpMargin > 0) {
            return {
              success: false,
              error: 'Cannot close vault with remaining collateral. Withdraw collateral first.'
            };
          }
          
          // Add retry mechanism specific to close operation
          const maxRetries = 2;
          let lastError = null;
          
          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
              if (attempt > 0) {
                console.log(`Retry attempt ${attempt}/${maxRetries} for closeVault`);
                await walletStore.refreshWallet().catch(() => {});
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
              
              // Close the vault
              const result = await ApiClient.closeVault(vaultId);
              
              // Update local state if successful
              if (result.success) {
                try {
                  vaultStore.removeVault(vaultId);
                  vaultStore.loadVaults(true); // Refresh vaults list
                } catch (e) {
                  console.warn('Could not refresh vault store', e);
                }
              }
              
              return result;
            } catch (error) {
              lastError = error;
              
              // Only retry on signer-related errors
              if (error instanceof Error && 
                  (error.message.toLowerCase().includes('signer') || 
                   error.message.toLowerCase().includes('response'))) {
                console.warn(`Signer error on attempt ${attempt}:`, error.message);
                // Continue to next retry
              } else {
                // For non-signer errors, throw immediately
                throw error;
              }
            }
          }
          
          // If we've exhausted retries, throw the last error
          throw lastError;
        } catch (error) {
          console.error('Error closing vault:', error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error closing vault'
          };
        }
      },
      async () => {
        // Pre-operation checks
        const walletState = get(walletStore);
        
        if (!walletState.isConnected) {
          throw new Error('Wallet disconnected. Please reconnect and try again.');
        }
        
        // Ensure we're starting with a clean wallet state
        await walletStore.refreshWallet().catch(() => {});
      }
    );
  }

  /**
   * Get details about a specific vault
   */
  async getVaultDetails(vaultId: number): Promise<any> {
    // This is a pass-through to the API client
    return ApiClient.getVaultById(vaultId);
  }

  /**
   * Redeem ICP by providing icUSD
   */
  async redeemIcp(icusdAmount: number): Promise<VaultOperationResult> {
    return this.executeOperation(
      'redeemIcp',
      () => ApiClient.redeemIcp(icusdAmount)
    );
  }

  /**
   * Provide liquidity to the protocol
   */
  async provideLiquidity(icpAmount: number): Promise<VaultOperationResult> {
    return this.executeOperation(
      'provideLiquidity',
      () => ApiClient.provideLiquidity(icpAmount),
      async () => {
        // Check if the user has sufficient balance
        await walletOperations.checkSufficientBalance(icpAmount);
      }
    );
  }

  /**
   * Withdraw liquidity from the protocol
   */
  async withdrawLiquidity(icpAmount: number): Promise<VaultOperationResult> {
    return this.executeOperation(
      'withdrawLiquidity',
      () => ApiClient.withdrawLiquidity(icpAmount)
    );
  }

  /**
   * Claim liquidity returns
   */
  async claimLiquidityReturns(): Promise<VaultOperationResult> {
    return this.executeOperation(
      'claimLiquidityReturns',
      () => ApiClient.claimLiquidityReturns()
    );
  }

  /**
   * Withdraw collateral from a vault
   */
  async withdrawCollateral(vaultId: number): Promise<VaultOperationResult> {
    return this.executeOperation(
      `withdrawCollateral:${vaultId}`,
      async () => {
        try {
          console.log(`ProtocolManager: Withdrawing collateral from vault #${vaultId}`);
          
          // Get the vault data first to have information about the amount of collateral
          const vault = await ApiClient.getVaultById(vaultId);
          
          if (!vault) {
            return {
              success: false,
              error: 'Vault not found'
            };
          }
          
          // Direct call with appropriate wallet refresh and error handling
          const result = await ApiClient.withdrawCollateral(vaultId);
          
          // Update vault store with zero collateral if successful
          if (result.success && vaultStore) {
            try {
              vaultStore.updateVault(vaultId, { icpMargin: 0 });
            } catch (e) {
              console.warn('Could not update vault store', e);
            }
          }
          
          return result;
        } catch (error) {
          console.error('Error withdrawing collateral:', error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error withdrawing collateral'
          };
        }
      }
    );
  }

  /**
   * Combined operation: Withdraw collateral and close vault
   */
  async withdrawCollateralAndCloseVault(vaultId: number): Promise<VaultOperationResult> {
    return this.executeOperation(
      `withdrawAndClose:${vaultId}`,
      () => ApiClient.withdrawCollateralAndCloseVault(vaultId)
    );
  }
}

export const protocolManager = ProtocolManager.getInstance();

// Set up a periodic cleanup task (every 2 minutes)
if (typeof window !== 'undefined') {
  setInterval(() => {
    protocolManager.cleanStaleOperations();
  }, 120000); // 2 minutes
}
