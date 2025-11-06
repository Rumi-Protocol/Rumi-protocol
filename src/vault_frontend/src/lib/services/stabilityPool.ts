import type { Principal } from '@dfinity/principal';
import type { ActorSubclass } from '@dfinity/agent';
import { createActor } from '../../../../declarations/stability_pool';
import type {
  _SERVICE as StabilityPoolService,
  StabilityPoolStatus,
  UserStabilityPosition,
  LiquidationResult,
  StabilityPoolError,
  LiquidatableVault,
  PoolLiquidationRecord,
  PoolAnalytics
} from '../../../../declarations/stability_pool/stability_pool.did';

import { walletStore } from '../stores/wallet';
import { get } from 'svelte/store';

class StabilityPoolManager {
  private actor: ActorSubclass<StabilityPoolService> | null = null;

  constructor() {
    this.initializeActor();
  }

  private async initializeActor() {
    try {
      // Get the agent from the wallet store
      const wallet = get(walletStore);
      if (wallet.agent) {
        this.actor = createActor(import.meta.env.VITE_CANISTER_ID_STABILITY_POOL!, {
          agent: wallet.agent
        });
      }
    } catch (error) {
      console.error('Failed to initialize Stability Pool actor:', error);
    }
  }

  private async ensureActor() {
    if (!this.actor) {
      await this.initializeActor();
    }
    if (!this.actor) {
      throw new Error('Failed to initialize Stability Pool actor');
    }
    return this.actor;
  }

  // Pool Status Operations
  async getPoolStatus(): Promise<StabilityPoolStatus> {
    const actor = await this.ensureActor();
    return await actor.get_pool_status();
  }

  async getUserPosition(user?: Principal): Promise<UserStabilityPosition | null> {
    const actor = await this.ensureActor();
    const result = await actor.get_user_position(user ? [user] : []);
    return result.length > 0 ? result[0] : null;
  }

  async getPoolAnalytics(): Promise<PoolAnalytics> {
    const actor = await this.ensureActor();
    return await actor.get_pool_analytics();
  }

  // Deposit and Withdrawal Operations
  async depositIcusd(amount: number): Promise<{ success: boolean; error?: string }> {
    try {
      const actor = await this.ensureActor();
      const amountE8s = Math.floor(amount * 100_000_000);
      await actor.deposit_icusd(BigInt(amountE8s));
      return { success: true };
    } catch (error) {
      console.error('Deposit failed:', error);
      return {
        success: false,
        error: this.extractErrorMessage(error)
      };
    }
  }

  async withdrawIcusd(amount: number): Promise<{ success: boolean; error?: string }> {
    try {
      const actor = await this.ensureActor();
      const amountE8s = Math.floor(amount * 100_000_000);
      await actor.withdraw_icusd(BigInt(amountE8s));
      return { success: true };
    } catch (error) {
      console.error('Withdrawal failed:', error);
      return {
        success: false,
        error: this.extractErrorMessage(error)
      };
    }
  }

  async claimCollateralGains(): Promise<{ success: boolean; amount?: number; error?: string }> {
    try {
      const actor = await this.ensureActor();
      const result = await actor.claim_collateral_gains();
      const claimedAmount = Number(result) / 100_000_000; // Convert from e8s to ICP
      return { success: true, amount: claimedAmount };
    } catch (error) {
      console.error('Claim gains failed:', error);
      return {
        success: false,
        error: this.extractErrorMessage(error)
      };
    }
  }

  // Liquidation Operations
  async executeLiquidation(vaultId: number): Promise<{ success: boolean; result?: LiquidationResult; error?: string }> {
    try {
      const actor = await this.ensureActor();
      const result = await actor.execute_liquidation(BigInt(vaultId));
      return { success: true, result };
    } catch (error) {
      console.error('Liquidation execution failed:', error);
      return {
        success: false,
        error: this.extractErrorMessage(error)
      };
    }
  }

  async scanAndLiquidate(): Promise<{ success: boolean; results?: LiquidationResult[]; error?: string }> {
    try {
      const actor = await this.ensureActor();
      const results = await actor.scan_and_liquidate();
      return { success: true, results };
    } catch (error) {
      console.error('Scan and liquidate failed:', error);
      return {
        success: false,
        error: this.extractErrorMessage(error)
      };
    }
  }

  async getLiquidatableVaults(): Promise<{ success: boolean; vaults?: LiquidatableVault[]; error?: string }> {
    try {
      const actor = await this.ensureActor();
      const vaults = await actor.get_liquidatable_vaults();
      return { success: true, vaults };
    } catch (error) {
      console.error('Get liquidatable vaults failed:', error);
      return {
        success: false,
        error: this.extractErrorMessage(error)
      };
    }
  }

  // History and Analytics
  async getLiquidationHistory(limit?: number): Promise<PoolLiquidationRecord[]> {
    const actor = await this.ensureActor();
    return await actor.get_liquidation_history(limit ? [BigInt(limit)] : []);
  }

  async checkPoolCapacity(requiredAmount: number): Promise<boolean> {
    const actor = await this.ensureActor();
    const amountE8s = Math.floor(requiredAmount * 100_000_000);
    return await actor.check_pool_capacity(BigInt(amountE8s));
  }

  // Test Operations
  async testProtocolConnection(): Promise<{ success: boolean; info?: string; error?: string }> {
    try {
      const actor = await this.ensureActor();
      const info = await actor.test_protocol_connection();
      return { success: true, info };
    } catch (error) {
      console.error('Protocol connection test failed:', error);
      return {
        success: false,
        error: this.extractErrorMessage(error)
      };
    }
  }

  // Utility Methods
  private extractErrorMessage(error: any): string {
    if (typeof error === 'string') {
      return error;
    }
    if (error?.message) {
      return error.message;
    }
    if (error && typeof error === 'object') {
      // Handle Candid variant errors
      if (error.TemporarilyUnavailable) {
        return error.TemporarilyUnavailable;
      }
      if (error.AmountTooLow) {
        return `Amount too low. Minimum: ${error.AmountTooLow.minimum_amount / 100_000_000} icUSD`;
      }
      if (error.InsufficientDeposit) {
        return `Insufficient balance. Required: ${error.InsufficientDeposit.required / 100_000_000}, Available: ${error.InsufficientDeposit.available / 100_000_000}`;
      }
      if (error.InsufficientPoolBalance) {
        return 'Pool has insufficient balance for this operation';
      }
      if (error.Unauthorized) {
        return 'Unauthorized to perform this operation';
      }
    }
    return `Unknown error: ${JSON.stringify(error)}`;
  }

  // Wallet connection management
  async updateAgent() {
    await this.initializeActor();
  }
}

// Export singleton instance
export const stabilityPoolService = new StabilityPoolManager();

// Subscribe to wallet changes to update the actor
walletStore.subscribe((wallet) => {
  if (wallet.agent) {
    stabilityPoolService.updateAgent();
  }
});