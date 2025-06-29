import { CONFIG, CANISTER_IDS } from '../config';
import { walletStore as wallet } from '../stores/wallet';
import { browser } from '$app/environment';
import { get } from 'svelte/store';
import { selectedWalletId } from '../services/auth';

// Add types to improve type safety
interface WalletState {
  isConnected: boolean;
  principal: any;
}

export class PermissionManager {
  private permissionsGranted = false;
  private walletTypeCache: string | null = null;
  private permissionsRequestTime = 0;
  private permissionsExpiryTime = 24 * 60 * 60 * 1000; // 24 hours
  
  constructor() {
    // Monitor selectedWalletId changes
    if (browser) {
      selectedWalletId.subscribe(id => {
        if (id !== this.walletTypeCache) {
          // Reset permissions state when wallet changes
          this.permissionsGranted = false;
          this.walletTypeCache = id;
          this.permissionsRequestTime = 0;
          console.log('PermissionManager detected wallet change:', id);
        }
      });
    }
  }

  // Set up all required canister permissions
  async requestAllPermissions(): Promise<boolean> {
    if (!browser) {
      return false;
    }

    try {
      // Check if permissions are still valid
      if (this.permissionsGranted && 
          Date.now() - this.permissionsRequestTime < this.permissionsExpiryTime) {
        console.log('PermissionManager: permissions already granted and not expired');
        return true;
      }
      
      const walletState = this.getWalletState();
      if (!walletState.isConnected) {
        return false;
      }

      // Get the actual wallet ID that was used for connection
      const currentWalletId = get(selectedWalletId);
      console.log('PermissionManager: requesting permissions for wallet:', currentWalletId);
      
      // Request permissions based on wallet type
      if (currentWalletId === 'plug') {
        if (!window.ic?.plug) {
          throw new Error('Plug wallet not available');
        }

        // Determine the correct ledger IDs based on network environment
        const icpLedgerId = CONFIG.isLocal ? CONFIG.currentIcpLedgerId : CANISTER_IDS.ICP_LEDGER;
        const icusdLedgerId = CONFIG.isLocal ? CONFIG.currentIcusdLedgerId : CANISTER_IDS.ICUSD_LEDGER;
        
        console.log('PermissionManager: requesting Plug permissions for canisters:');
        console.log('Protocol:', CONFIG.currentCanisterId);
        console.log('ICP Ledger:', icpLedgerId);
        console.log('icUSD Ledger:', icusdLedgerId);

        const canistersToRequest = [
          CONFIG.currentCanisterId,
          icpLedgerId,
          icusdLedgerId
        ];

        await window.ic.plug.requestConnect({
          whitelist: canistersToRequest,
          host: CONFIG.host
        });

        const result = await window.ic.plug.isConnected();
        if (result) {
          this.permissionsGranted = true;
          this.permissionsRequestTime = Date.now();
        }
        return result;
      }
      
      // Internet Identity or other wallets don't need explicit permission requests
      else {
        console.log('PermissionManager: No explicit permissions needed for wallet:', currentWalletId);
        this.permissionsGranted = true;
        this.permissionsRequestTime = Date.now();
        return true;
      }
    } catch (error) {
      console.error('PermissionManager: Error requesting permissions:', error);
      return false;
    }
  }

  // Check if all permissions are granted with expiration
  async checkPermissions(): Promise<boolean> {
    if (!browser) {
      return false;
    }

    try {
      // First check our cached state
      if (this.permissionsGranted && 
          Date.now() - this.permissionsRequestTime < this.permissionsExpiryTime) {
        return true;
      }

      // Otherwise check with wallet
      const walletState = this.getWalletState();
      
      if (!walletState.isConnected) {
        return false;
      }

      const currentWalletId = get(selectedWalletId);
      
      if (currentWalletId === 'plug') {
        if (!window.ic?.plug) {
          return false;
        }

        const isConnected = await window.ic.plug.isConnected();
        if (isConnected) {
          this.permissionsGranted = true;
          this.permissionsRequestTime = Date.now();
        }
        return isConnected;
      } else {
        // For Internet Identity and others, assume permissions are granted
        this.permissionsGranted = true;
        this.permissionsRequestTime = Date.now();
        return true;
      }
    } catch (error) {
      console.error('Error checking permissions:', error);
      return false;
    }
  }

  // Reset permissions state
  resetPermissions(): void {
    this.permissionsGranted = false;
    this.permissionsRequestTime = 0;
  }

  // Helper to get current wallet state
  private getWalletState(): WalletState {
    const walletState = get(wallet);
    return {
      isConnected: walletState.isConnected,
      principal: walletState.principal
    };
  }
  
  // New helper method to ensure permissions are granted
  async ensurePermissions(): Promise<boolean> {
    const hasPermissions = await this.checkPermissions();
    if (!hasPermissions) {
      return await this.requestAllPermissions();
    }
    return true;
  }
}

// Export a singleton instance
export const permissionManager = new PermissionManager();
