import { Principal } from '@dfinity/principal';
import { Actor, HttpAgent } from "@dfinity/agent";
import { get } from 'svelte/store';
import { walletStore } from '../../stores/wallet';
import { CONFIG } from '../../config';
import type { UserBalances } from '../types';

// Import types from declarations
import type {
  _SERVICE,
  Vault as CanisterVault,
  ProtocolStatus as CanisterProtocolStatus,
  LiquidityStatus as CanisterLiquidityStatus,
  Fees,
  SuccessWithFee,
  ProtocolError,
  OpenVaultSuccess,
} from '../../../../../declarations/rumi_protocol_backend/rumi_protocol_backend.did';

export const E8S = 100_000_000;

/**
 * Operations related to wallet interaction and token approvals
 */
export class walletOperations {
  /**
   * Reset wallet signer state after errors
   */
  static async resetWalletSignerState(): Promise<void> {
    try {
      // Attempt to reset any pending wallet operations
      const walletState = get(walletStore);
      if (walletState.isConnected) {
        console.log('Resetting wallet signer state');
        // Here we're just doing basic cleanup, but you might need
        // to add more specific reset operations for your wallet provider
        await walletStore.refreshWallet();
      }
    } catch (err) {
      console.error('Failed to reset wallet signer state:', err);
    }
  }

  /**
   * Approve ICP transfer to a specified canister
   */
  static async approveIcpTransfer(amount: bigint, spenderCanisterId: string): Promise<{success: boolean, error?: string}> {
    try {
      console.log(`Approving ${amount.toString()} e8s for ${spenderCanisterId}`);
      
      // Get the ICP ledger actor
      const icpActor = await walletStore.getActor(CONFIG.currentIcpLedgerId, CONFIG.icp_ledgerIDL);
      
      // Request approval with maximum timeframe and clear expected_allowance for better compatibility
      const approvalResult = await icpActor.icrc2_approve({
        amount: amount,
        spender: { 
          owner: Principal.fromText(spenderCanisterId),
          subaccount: [] 
        },
        expires_at: [], // No expiration
        expected_allowance: [], // Don't restrict by expected allowance 
        memo: [],
        fee: [],
        from_subaccount: [],
        created_at_time: []
      });
      
      console.log('Approval result:', approvalResult);
      
      if ('Ok' in approvalResult) {
        console.log('Approval successful!');
        
        // Verify the allowance was set properly
        try {
          const walletState = get(walletStore);
          const currentAllowance = await icpActor.icrc2_allowance({
            account: { 
              owner: walletState.principal!, 
              subaccount: [] 
            },
            spender: { 
              owner: Principal.fromText(spenderCanisterId), 
              subaccount: [] 
            }
          });
          
          console.log('Verified allowance after approval:', currentAllowance.allowance.toString());
          
          // If the allowance is less than requested, warn but don't fail
          if (currentAllowance.allowance < amount) {
            console.warn('Allowance is less than requested amount. Got:', 
                         currentAllowance.allowance.toString(), 
                         'Expected:', amount.toString());
          }
        } catch (verifyErr) {
          console.warn('Failed to verify allowance:', verifyErr);
        }
        
        return { success: true };
      } else {
        return { 
          success: false, 
          error: `Approval failed: ${JSON.stringify(approvalResult.Err)}` 
        };
      }
    } catch (error) {
      console.error('Approval failed with exception:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to approve ICP transfer' 
      };
    }
  }

  /**
   * Check current ckBTC allowance for the protocol canister
   */
  static async checkCkbtcAllowance(spenderCanisterId: string): Promise<bigint> {
    try {
      const walletState = get(walletStore);
      if (!walletState.principal) {
        throw new Error('Wallet not connected');
      }
      
      // Get ckBTC ledger actor
      const ckbtcActor = await walletStore.getActor(CONFIG.currentCkbtcLedgerId, CONFIG.ckbtc_ledgerIDL);
      
      // Make allowance query
      const result = await ckbtcActor.icrc2_allowance({
        account: { 
          owner: walletState.principal, 
          subaccount: [] 
        },
        spender: { 
          owner: Principal.fromText(spenderCanisterId), 
          subaccount: [] 
        }
      });
      
      return result.allowance;
    } catch (err) {
      console.error('Failed to check ckBTC allowance:', err);
      return BigInt(0);
    }
  }

  /**
   * Approve ckBTC transfer to a specified canister
   */
  static async approveCkbtcTransfer(amount: bigint, spenderCanisterId: string): Promise<{success: boolean, error?: string}> {
    try {
      const walletState = get(walletStore);
      if (!walletState.principal) {
        throw new Error('Wallet not connected');
      }
      
      // Get ckBTC ledger actor
      const ckbtcActor = await walletStore.getActor(CONFIG.currentCkbtcLedgerId, CONFIG.ckbtc_ledgerIDL);
      
      // Prepare approval args
      const approvalArgs = {
        spender: { 
          owner: Principal.fromText(spenderCanisterId), 
          subaccount: [] 
        },
        amount: amount,
        expires_at: [],
        fee: [],
        memo: [],
        from_subaccount: [],
        created_at_time: []
      };
      
      console.log(`Approving ${Number(amount) / E8S} ckBTC for spender: ${spenderCanisterId}`);
      
      const result = await ckbtcActor.icrc2_approve(approvalArgs);
      
      if ('Ok' in result) {
        console.log(`✓ ckBTC approval successful. Block index: ${result.Ok}`);
        return { success: true };
      } else {
        console.error('ckBTC approval failed:', result.Err);
        return { 
          success: false, 
          error: `ckBTC approval failed: ${JSON.stringify(result.Err)}` 
        };
      }
    } catch (err) {
      console.error('Error approving ckBTC transfer:', err);
      return { 
        success: false, 
        error: err instanceof Error ? err.message : 'Unknown error during ckBTC approval' 
      };
    }
  }

  /**
   * Check current ICP allowance for the protocol canister
   */
  static async checkIcpAllowance(spenderCanisterId: string): Promise<bigint> {
    try {
      const walletState = get(walletStore);
      if (!walletState.principal) {
        throw new Error('Wallet not connected');
      }
      
      // Get ICP ledger actor
      const icpActor = await walletStore.getActor(CONFIG.currentIcpLedgerId, CONFIG.icp_ledgerIDL);
      
      // Make allowance query
      const result = await icpActor.icrc2_allowance({
        account: { 
          owner: walletState.principal, 
          subaccount: [] 
        },
        spender: { 
          owner: Principal.fromText(spenderCanisterId), 
          subaccount: [] 
        }
      });
      
      return result.allowance;
    } catch (err) {
      console.error('Failed to check allowance:', err);
      return BigInt(0);
    }
  }

  /**
   * Check if user has sufficient ICP balance for an operation
   */
  static async checkSufficientBalance(amount: number): Promise<boolean> {
    try {
      const walletState = get(walletStore);
      
      if (!walletState.isConnected || !walletState.principal) {
        return false;
      }
      
      // Get balance from tokenBalances
      const balance = walletState.tokenBalances?.ICP?.raw 
        ? Number(walletState.tokenBalances.ICP.raw) / E8S 
        : 0;
      
      return balance >= amount;
    } catch (err) {
      console.error('Error checking balance:', err);
      return false;
    }
  }

  /**
   * Check current icUSD allowance for the protocol canister
   */
  static async checkIcusdAllowance(spenderCanisterId: string): Promise<bigint> {
    try {
      const walletState = get(walletStore);
      if (!walletState.principal) {
        throw new Error('Wallet not connected');
      }
      
      // Get icUSD ledger actor
      const icusdActor = await walletStore.getActor(CONFIG.currentIcusdLedgerId, CONFIG.icusd_ledgerIDL);
      
      // Make allowance query
      const result = await icusdActor.icrc2_allowance({
        account: { 
          owner: walletState.principal, 
          subaccount: [] 
        },
        spender: { 
          owner: Principal.fromText(spenderCanisterId), 
          subaccount: [] 
        }
      });
      
      return result.allowance;
    } catch (err) {
      console.error('Failed to check icUSD allowance:', err);
      return BigInt(0);
    }
  }
  
  /**
   * Approve icUSD transfer for the protocol canister
   */
  static async approveIcusdTransfer(amount: bigint, spenderCanisterId: string): Promise<{success: boolean, error?: string}> {
    try {
      // Get the icUSD ledger actor
      const icusdActor = await walletStore.getActor(CONFIG.currentIcusdLedgerId, CONFIG.icusd_ledgerIDL);
      
      // Request approval with maximum timeframe
      const approvalResult = await icusdActor.icrc2_approve({
        amount: amount,
        spender: { 
          owner: Principal.fromText(spenderCanisterId),
          subaccount: [] 
        },
        expires_at: [], // No expiration
        expected_allowance: [],
        memo: [],
        fee: [],
        from_subaccount: [],
        created_at_time: []
      });
      
      if ('Ok' in approvalResult) {
        return { success: true };
      } else {
        return { 
          success: false, 
          error: `icUSD approval failed: ${JSON.stringify(approvalResult.Err)}` 
        };
      }
    } catch (error) {
      console.error('icUSD approval failed:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to approve icUSD transfer' 
      };
    }
  }

  /**
   * Get current icUSD balance for the connected wallet
   */
  static async getIcusdBalance(): Promise<number> {
    try {
      const walletState = get(walletStore);
      
      if (!walletState.isConnected || !walletState.principal) {
        return 0;
      }
      
      // Get balance from tokenBalances if available
      if (walletState.tokenBalances?.ICUSD?.raw) {
        return Number(walletState.tokenBalances.ICUSD.raw) / E8S;
      }
      
      // Otherwise fetch from the ledger
      const icusdActor = await walletStore.getActor(CONFIG.currentIcusdLedgerId, CONFIG.icusd_ledgerIDL);
      const balance = await icusdActor.icrc1_balance_of({
        owner: walletState.principal,
        subaccount: []
      });
      
      return Number(balance) / E8S;
    } catch (err) {
      console.error('Error getting icUSD balance:', err);
      return 0;
    }
  }

  /**
   * Get both ICP and icUSD balances
   */
  static async getUserBalances(): Promise<UserBalances> {
    try {
      const walletState = get(walletStore);
      
      if (!walletState.isConnected || !walletState.principal) {
        return { icp: 0, ckbtc: 0, icusd: 0 };
      }
      
      // Start with values from tokenBalances if available
      let icpBalance = walletState.tokenBalances?.ICP?.raw 
        ? Number(walletState.tokenBalances.ICP.raw) / E8S 
        : 0;
      
      let ckbtcBalance = walletState.tokenBalances?.CKBTC?.raw
        ? Number(walletState.tokenBalances.CKBTC.raw) / E8S
        : 0;
        
      let icusdBalance = walletState.tokenBalances?.ICUSD?.raw
        ? Number(walletState.tokenBalances.ICUSD.raw) / E8S
        : 0;
      
      // If we don't have values from tokenBalances, fetch them
      if (icpBalance === 0) {
        try {
          const icpActor = await walletStore.getActor(CONFIG.currentIcpLedgerId, CONFIG.icp_ledgerIDL);
          const balance = await icpActor.icrc1_balance_of({
            owner: walletState.principal,
            subaccount: []
          });
          icpBalance = Number(balance) / E8S;
        } catch (err) {
          console.warn('Failed to fetch ICP balance:', err);
        }
      }
      
      if (ckbtcBalance === 0) {
        try {
          const ckbtcActor = await walletStore.getActor(CONFIG.currentCkbtcLedgerId, CONFIG.ckbtc_ledgerIDL);
          const balance = await ckbtcActor.icrc1_balance_of({
            owner: walletState.principal,
            subaccount: []
          });
          ckbtcBalance = Number(balance) / E8S;
        } catch (err) {
          console.warn('Failed to fetch ckBTC balance:', err);
        }
      }

      if (icusdBalance === 0) {
        try {
          const icusdActor = await walletStore.getActor(CONFIG.currentIcusdLedgerId, CONFIG.icusd_ledgerIDL);
          const balance = await icusdActor.icrc1_balance_of({
            owner: walletState.principal,
            subaccount: []
          });
          icusdBalance = Number(balance) / E8S;
        } catch (err) {
          console.warn('Failed to fetch icUSD balance:', err);
        }
      }
      
      return {
        icp: icpBalance,
        ckbtc: ckbtcBalance,
        icusd: icusdBalance
      };
    } catch (err) {
      console.error('Error getting user balances:', err);
      return { icp: 0, ckbtc: 0, icusd: 0 };
    }
  }
}