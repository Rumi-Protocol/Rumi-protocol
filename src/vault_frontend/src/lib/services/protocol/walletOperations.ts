import { Principal } from '@dfinity/principal';
import { Actor, HttpAgent } from "@dfinity/agent";
import { get } from 'svelte/store';
import { walletStore } from '../../stores/wallet';
import { CONFIG } from '../../config';
import { permissionManager } from '../PermissionManager';
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
 * Streamlined wallet operations with automatic permission handling
 */
export class walletOperations {
  /**
   * Reset wallet signer state after errors
   */
  static async resetWalletSignerState(): Promise<void> {
    try {
      const walletState = get(walletStore);
      if (walletState.isConnected) {
        console.log('Resetting wallet signer state');
        await walletStore.refreshWallet();
      }
    } catch (err) {
      console.error('Failed to reset wallet signer state:', err);
    }
  }

  /**
   * Approve ICP transfer - now streamlined with automatic permission handling
   */
  static async approveIcpTransfer(amount: bigint, spenderCanisterId: string): Promise<{success: boolean, error?: string}> {
    try {
      // FIXED: Remove permission check that causes "Permission request was denied" errors
      // The wallet will handle permissions automatically when the transaction is attempted
      
      console.log(`Approving ${amount.toString()} e8s ICP for ${spenderCanisterId}`);
      
      // Get the ICP ledger actor
      const icpActor = await walletStore.getActor(CONFIG.currentIcpLedgerId, CONFIG.icp_ledgerIDL);
      
      // Request approval
      const approvalResult = await icpActor.icrc2_approve({
        amount,
        spender: { 
          owner: Principal.fromText(spenderCanisterId),
          subaccount: [] 
        },
        expires_at: [], 
        expected_allowance: [], 
        memo: [],
        fee: [],
        from_subaccount: [],
        created_at_time: []
      });
      
      if ('Ok' in approvalResult) {
        console.log('ICP approval successful');
        return { success: true };
      } else {
        return { 
          success: false, 
          error: `ICP approval failed: ${JSON.stringify(approvalResult.Err)}` 
        };
      }
    } catch (error) {
      console.error('ICP approval failed:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to approve ICP transfer' 
      };
    }
  }

  /**
   * Check ICP allowance
   */
  static async checkIcpAllowance(spenderCanisterId: string): Promise<bigint> {
    try {
      const walletState = get(walletStore);
      if (!walletState.principal) {
        return BigInt(0);
      }
      
      const icpActor = await walletStore.getActor(CONFIG.currentIcpLedgerId, CONFIG.icp_ledgerIDL);
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
      console.error('Failed to check ICP allowance:', err);
      return BigInt(0);
    }
  }

  /**
   * Check if user has sufficient ICP balance
   */
  static async checkSufficientBalance(amount: number): Promise<boolean> {
    try {
      const walletState = get(walletStore);
      
      if (!walletState.isConnected || !walletState.principal) {
        return false;
      }
      
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
   * Check icUSD allowance
   */
  static async checkIcusdAllowance(spenderCanisterId: string): Promise<bigint> {
    try {
      const walletState = get(walletStore);
      if (!walletState.principal) {
        return BigInt(0);
      }
      
      const icusdActor = await walletStore.getActor(CONFIG.currentIcusdLedgerId, CONFIG.icusd_ledgerIDL);
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
   * Approve icUSD transfer - now streamlined
   */
  static async approveIcusdTransfer(amount: bigint, spenderCanisterId: string): Promise<{success: boolean, error?: string}> {
    try {
      // FIXED: Remove permission check that causes "Permission request was denied" errors
      // The wallet will handle permissions automatically when the transaction is attempted

      console.log(`Approving ${amount.toString()} e8s icUSD for ${spenderCanisterId}`);
      
      const icusdActor = await walletStore.getActor(CONFIG.currentIcusdLedgerId, CONFIG.icusd_ledgerIDL);
      
      const approvalResult = await icusdActor.icrc2_approve({
        amount,
        spender: { 
          owner: Principal.fromText(spenderCanisterId),
          subaccount: [] 
        },
        expires_at: [], 
        expected_allowance: [],
        memo: [],
        fee: [],
        from_subaccount: [],
        created_at_time: []
      });
      
      if ('Ok' in approvalResult) {
        console.log('icUSD approval successful');
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
   * Get current icUSD balance
   */
  static async getIcusdBalance(): Promise<number> {
    try {
      const walletState = get(walletStore);
      
      if (!walletState.isConnected || !walletState.principal) {
        return 0;
      }
      
      if (walletState.tokenBalances?.ICUSD?.raw) {
        return Number(walletState.tokenBalances.ICUSD.raw) / E8S;
      }
      
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
        return { icp: 0, icusd: 0 };
      }
      
      let icpBalance = walletState.tokenBalances?.ICP?.raw 
        ? Number(walletState.tokenBalances.ICP.raw) / E8S 
        : 0;
        
      let icusdBalance = walletState.tokenBalances?.ICUSD?.raw
        ? Number(walletState.tokenBalances.ICUSD.raw) / E8S
        : 0;
      
      // Fetch from ledger if not available in tokenBalances
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
        icusd: icusdBalance
      };
    } catch (err) {
      console.error('Error getting user balances:', err);
      return { icp: 0, icusd: 0 };
    }
  }
}