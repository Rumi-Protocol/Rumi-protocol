import type { ActorSubclass } from '@dfinity/agent';
import { pnp, canisterIDLs } from './pnp';
import { walletStore } from '../stores/wallet';
import { get } from 'svelte/store';
import { CONFIG, CANISTER_IDS, LOCAL_CANISTER_IDS } from '../config';

export interface PoolInfo {
  total_deposited: bigint;
  total_depositors: bigint;
  total_icp_rewards: bigint;
  total_liquidations: bigint;
}

export interface UserDeposit {
  depositor: string;
  amount: bigint;
  icp_rewards: bigint;
  deposit_time: bigint;
}

export interface LiquidationRecord {
  vault_id: bigint;
  icusd_amount: bigint;
  icp_amount: bigint;
  timestamp: bigint;
  liquidation_bonus: bigint;
}

// Add stability pool canister ID to config
const STABILITY_POOL_CANISTER_ID = "jgwkf-3yaaa-aaaai-q34na-cai";

class StabilityPoolService {
  private async getActor() {
    try {
      // Use PNP to get the actor with proper authentication
      return await pnp.getActor(STABILITY_POOL_CANISTER_ID, canisterIDLs.stability_pool);
    } catch (error) {
      console.error('Failed to get stability pool actor:', error);
      throw new Error('Failed to connect to stability pool');
    }
  }

  async getPoolInfo(): Promise<PoolInfo> {
    try {
      const actor = await this.getActor();
      const result = await actor.get_total_pool_info();
      return result;
    } catch (error) {
      console.error('Failed to get pool info:', error);
      throw new Error('Failed to load pool information');
    }
  }

  async getUserDeposit(): Promise<UserDeposit | null> {
    try {
      const wallet = get(walletStore);
      if (!wallet.isConnected || !wallet.principal) {
        return null;
      }

      const actor = await this.getActor();
      const result = await actor.get_user_deposit(wallet.principal);
      
      // Handle optional return (user might not have a deposit)
      if ('Ok' in result) {
        return result.Ok;
      } else if ('Err' in result && result.Err === 'UserNotFound') {
        return null;
      } else {
        throw new Error('Failed to get user deposit');
      }
    } catch (error) {
      console.error('Failed to get user deposit:', error);
      throw new Error('Failed to load user deposit information');
    }
  }

  async deposit(amount: bigint): Promise<boolean> {
    try {
      const wallet = get(walletStore);
      if (!wallet.isConnected) {
        throw new Error('Wallet not connected');
      }

      const actor = await this.getActor();
      const result = await actor.deposit(amount);
      
      if ('Ok' in result) {
        return true;
      } else {
        console.error('Deposit failed:', result.Err);
        throw new Error(`Deposit failed: ${result.Err}`);
      }
    } catch (error) {
      console.error('Failed to deposit:', error);
      throw error;
    }
  }

  async withdraw(amount: bigint): Promise<boolean> {
    try {
      const wallet = get(walletStore);
      if (!wallet.isConnected) {
        throw new Error('Wallet not connected');
      }

      const actor = await this.getActor();
      const result = await actor.withdraw(amount);
      
      if ('Ok' in result) {
        return true;
      } else {
        console.error('Withdrawal failed:', result.Err);
        throw new Error(`Withdrawal failed: ${result.Err}`);
      }
    } catch (error) {
      console.error('Failed to withdraw:', error);
      throw error;
    }
  }

  async claimRewards(): Promise<boolean> {
    try {
      const wallet = get(walletStore);
      if (!wallet.isConnected) {
        throw new Error('Wallet not connected');
      }

      const actor = await this.getActor();
      const result = await actor.claim_rewards();
      
      if ('Ok' in result) {
        return true;
      } else {
        console.error('Claim rewards failed:', result.Err);
        throw new Error(`Claim rewards failed: ${result.Err}`);
      }
    } catch (error) {
      console.error('Failed to claim rewards:', error);
      throw error;
    }
  }

  async getLiquidationHistory(): Promise<LiquidationRecord[]> {
    try {
      const actor = await this.getActor();
      const result = await actor.get_liquidation_history();
      return result;
    } catch (error) {
      console.error('Failed to get liquidation history:', error);
      throw new Error('Failed to load liquidation history');
    }
  }

  async getLiquidatableVaults(): Promise<any[]> {
    try {
      const actor = await this.getActor();
      const result = await actor.get_liquidatable_vaults();
      return result;
    } catch (error) {
      console.error('Failed to get liquidatable vaults:', error);
      throw new Error('Failed to load liquidatable vaults');
    }
  }

  async manualLiquidationCheck(): Promise<any> {
    try {
      const actor = await this.getActor();
      const result = await actor.manual_liquidation_check();
      return result;
    } catch (error) {
      console.error('Failed to perform manual liquidation check:', error);
      throw new Error('Failed to perform liquidation check');
    }
  }

  // Utility functions
  formatIcusd(amount: bigint): string {
    // Convert from smallest unit (assuming 8 decimals) to display format
    const value = Number(amount) / 100_000_000;
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  formatIcp(amount: bigint): string {
    // Convert from e8s to ICP (8 decimals)
    const value = Number(amount) / 100_000_000;
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4
    });
  }

  parseIcusdAmount(amount: string): bigint {
    // Convert from display format to smallest unit
    const value = parseFloat(amount);
    if (isNaN(value) || value < 0) {
      throw new Error('Invalid amount');
    }
    return BigInt(Math.floor(value * 100_000_000));
  }
}

export const stabilityPoolService = new StabilityPoolService();