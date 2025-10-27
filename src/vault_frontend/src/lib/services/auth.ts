import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { pnp, connectWithComprehensivePermissions } from './pnp';
import { TokenService } from './tokenService';
import { CONFIG, CANISTER_IDS, LOCAL_CANISTER_IDS } from '../config';
import { canisterIDLs } from './pnp';
import { permissionManager } from './PermissionManager';
import type { Principal } from '@dfinity/principal';

// Storage keys for persistence
const STORAGE_KEYS = {
  LAST_WALLET: "rumi_last_wallet",
  AUTO_CONNECT_ATTEMPTED: "rumi_auto_connect_attempted",
  WAS_CONNECTED: "rumi_was_connected"
} as const;

// Create initial stores
export const selectedWalletId = writable<string | null>(null);
export const connectionError = writable<string | null>(null);

// Type definition for auth state
interface AuthState {
  isConnected: boolean;
  account: {
    owner: Principal;
    balance: bigint;
    [key: string]: any;
  } | null;
  isInitialized: boolean;
}

function createAuthStore() {
  const store = writable<AuthState>({
    isConnected: false,
    account: null,
    isInitialized: false
  });

  const { subscribe, set } = store;

  // Storage helper with type safety
  const storage = {
    get: (key: keyof typeof STORAGE_KEYS): string | null => 
      browser ? localStorage.getItem(STORAGE_KEYS[key]) : null,
    set: (key: keyof typeof STORAGE_KEYS, value: string): void => {
      if (browser) localStorage.setItem(STORAGE_KEYS[key], value);
    },
    clear: (): void => {
      if (browser) {
        Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k));
        permissionManager.clearCache();
      }
    }
  };

  // Fetch wallet balance with better error handling
  const refreshWalletBalance = async (principal: Principal): Promise<bigint> => {
    try {
      const icpLedgerId = CONFIG.isLocal ? LOCAL_CANISTER_IDS.ICP_LEDGER : CANISTER_IDS.ICP_LEDGER;
      const balance = await TokenService.getTokenBalance(icpLedgerId, principal);
      console.log('Auth balance refresh:', balance.toString());
      return balance;
    } catch (error) {
      console.error('Auth balance refresh failed:', error);
      throw error;
    }
  };

  return {
    subscribe,
    pnp,
    refreshBalance: refreshWalletBalance,

    async initialize(): Promise<void> {
      if (!browser) return;
      
      const lastWallet = storage.get("LAST_WALLET");
      if (!lastWallet) return;

      const hasAttempted = sessionStorage.getItem(STORAGE_KEYS.AUTO_CONNECT_ATTEMPTED);
      const wasConnected = storage.get("WAS_CONNECTED");
      
      if (hasAttempted && !wasConnected) return;

      try {
        await this.connect(lastWallet);
      } catch (error) {
        console.warn("Auto-connect failed:", error);
        storage.clear();
        connectionError.set(error instanceof Error ? error.message : String(error));
      } finally {
        sessionStorage.setItem(STORAGE_KEYS.AUTO_CONNECT_ATTEMPTED, "true");
      }
    },

    async connect(walletId: string): Promise<{owner: Principal} | null> {
      try {
        connectionError.set(null);
        
        // Use custom connect function that ensures comprehensive permissions
        console.log('🔗 Connecting wallet with comprehensive permissions...');
        
        const result = await connectWithComprehensivePermissions(walletId);
        
        if (!result?.owner) {
          throw new Error("Invalid connection result");
        }

        // Get initial balance after connection
        const balance = await refreshWalletBalance(result.owner);
        console.log('Initial balance:', balance.toString());

        set({ 
          isConnected: true, 
          account: {
            ...result,
            balance
          }, 
          isInitialized: true 
        });

        // Update storage
        selectedWalletId.set(walletId);
        storage.set("LAST_WALLET", walletId);
        storage.set("WAS_CONNECTED", "true");

        console.log('🎉 Wallet connected with comprehensive permissions via PNP initialization');
        return result;
      } catch (error) {
        this.handleConnectionError(error);
        throw error;
      }
    },

    async disconnect(): Promise<void> {
      // Clear permission cache on disconnect
      permissionManager.clearCache();
      
      await pnp.disconnect();
      set({ 
        isConnected: false, 
        account: null, 
        isInitialized: true 
      });
      selectedWalletId.set(null);
      connectionError.set(null);
      storage.clear();
    },

    handleConnectionError(error: any): void {
      console.error("Connection error:", error);
      set({ 
        isConnected: false, 
        account: null, 
        isInitialized: true 
      });
      connectionError.set(error instanceof Error ? error.message : String(error));
      selectedWalletId.set(null);
      // Clear permissions on error
      permissionManager.clearCache();
    },

    async getActor<T>(canisterId: string, idl: any): Promise<T> {
      if (!pnp.isConnected()) {
        throw new Error('Wallet not connected');
      }

      // FIXED: Remove permission check that causes "Permission request was denied" errors
      // Permissions are handled by the wallet connection itself, not by explicit requests
      // The wallet will prompt for permissions only when actually needed for transactions

      return pnp.getActor(canisterId, idl);
    },

    async isWalletConnected(): Promise<boolean> {
      return pnp.isConnected();
    },
    
    // Check if wallet is authenticated and has permissions
    async isAuthenticated(): Promise<boolean> {
      const isConnected = await this.isWalletConnected();
      if (!isConnected) return false;
      
      return permissionManager.hasPermissions();
    },
    
    // Ensure both connection and permissions
    async ensureAuthenticated(): Promise<boolean> {
      const isConnected = await this.isWalletConnected();
      if (!isConnected) return false;
      
      return await permissionManager.ensurePermissions();
    },
    
    // Get the current principal
    getPrincipal(): Principal | null {
      const state = get(store);
      return state.account?.owner || null;
    }
  };
}

// Create singleton instance
export const auth = createAuthStore();

// Helper function with more descriptive error message
export function requireWalletConnection(): void {
  const isConnected = get(auth).isConnected;
  if (!isConnected) {
    throw new Error("Wallet connection required. Please connect your wallet first.");
  }
}
