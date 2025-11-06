import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { pnp } from './pnp';
import { internetIdentity } from './internetIdentity';
import { TokenService } from './tokenService';
import { CONFIG, CANISTER_IDS, LOCAL_CANISTER_IDS } from '../config';
import { canisterIDLs } from './pnp';
import type { Principal } from '@dfinity/principal';

export type WalletType = 'plug' | 'internet-identity' | null;

export const WALLET_TYPES = {
  PLUG: 'plug' as const,
  INTERNET_IDENTITY: 'internet-identity' as const
};

// Storage keys for persistence
const STORAGE_KEYS = {
  LAST_WALLET: "rumi_last_wallet",
  WALLET_TYPE: "rumi_wallet_type", 
  AUTO_CONNECT_ATTEMPTED: "rumi_auto_connect_attempted",
  WAS_CONNECTED: "rumi_was_connected"
} as const;

// Create initial stores
export const selectedWalletId = writable<string | null>(null);
export const selectedWalletType = writable<WalletType>(null); 
export const connectionError = writable<string | null>(null);

// Type definition for auth state
interface AuthState {
  isConnected: boolean;
  walletType: WalletType; 
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
    walletType: null,
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
    internetIdentity, 
    refreshBalance: refreshWalletBalance,

    async initialize(): Promise<void> {
      if (!browser) return;
      
      const lastWallet = storage.get("LAST_WALLET");
      const walletType = storage.get("WALLET_TYPE") as WalletType; 
      
      if (!lastWallet || !walletType) return;

      const hasAttempted = sessionStorage.getItem(STORAGE_KEYS.AUTO_CONNECT_ATTEMPTED);
      const wasConnected = storage.get("WAS_CONNECTED");
      
      if (hasAttempted && !wasConnected) return;

      try {
        // Check wallet type and connect accordingly
        if (walletType === 'internet-identity') {
          await this.connectInternetIdentity();
        } else {
          await this.connect(lastWallet);
        }
      } catch (error) {
        console.warn("Auto-connect failed:", error);
        storage.clear();
        connectionError.set(error instanceof Error ? error.message : String(error));
      } finally {
        sessionStorage.setItem(STORAGE_KEYS.AUTO_CONNECT_ATTEMPTED, "true");
      }
    },

    /**
     * Connect with Plug wallet (existing method - UPDATED)
     */
    async connect(walletId: string): Promise<{owner: Principal} | null> {
      try {
        connectionError.set(null);
        const result = await pnp.connect(walletId);
        
        if (!result?.owner) {
          throw new Error("Invalid connection result");
        }

        // Get initial balance after connection
        const balance = await refreshWalletBalance(result.owner);
        console.log('Initial balance:', balance.toString());

        set({ 
          isConnected: true,
          walletType: 'plug', 
          account: {
            ...result,
            balance
          }, 
          isInitialized: true 
        });

        // Update storage
        selectedWalletId.set(walletId);
        selectedWalletType.set('plug'); 
        storage.set("LAST_WALLET", walletId);
        storage.set("WALLET_TYPE", 'plug');
        storage.set("WAS_CONNECTED", "true");

        return result;
      } catch (error) {
        this.handleConnectionError(error);
        throw error;
      }
    },

    /**
     * Connect with Internet Identity 
     */
    async connectInternetIdentity(): Promise<{owner: Principal} | null> {
      try {
        connectionError.set(null);
        
        // Initialize and login with Internet Identity
        await internetIdentity.init();
        const result = await internetIdentity.login();
        
        if (!result?.owner) {
          throw new Error("Internet Identity login failed");
        }

        // Get initial balance
        const balance = await refreshWalletBalance(result.owner);
        console.log('II Initial balance:', balance.toString());

        set({ 
          isConnected: true,
          walletType: 'internet-identity',
          account: {
            ...result,
            balance
          }, 
          isInitialized: true 
        });

        // Update storage
        selectedWalletId.set('internet-identity');
        selectedWalletType.set('internet-identity');
        storage.set("LAST_WALLET", 'internet-identity');
        storage.set("WALLET_TYPE", 'internet-identity');
        storage.set("WAS_CONNECTED", "true");

        return result;
      } catch (error) {
        this.handleConnectionError(error);
        throw error;
      }
    },

    async disconnect(): Promise<void> {
      const state = get(store);
      
      // Disconnect based on wallet type
      if (state.walletType === 'internet-identity') {
        await internetIdentity.logout();
      } else {
        await pnp.disconnect();
      }
      
      set({ 
        isConnected: false,
        walletType: null, 
        account: null, 
        isInitialized: true 
      });
      selectedWalletId.set(null);
      selectedWalletType.set(null); 
      connectionError.set(null);
      storage.clear();
    },

    handleConnectionError(error: any): void {
      console.error("Connection error:", error);
      set({ 
        isConnected: false,
        walletType: null, 
        account: null, 
        isInitialized: true 
      });
      connectionError.set(error instanceof Error ? error.message : String(error));
      selectedWalletId.set(null);
      selectedWalletType.set(null); 
    },

    async getActor<T>(canisterId: string, idl: any): Promise<T> {
      const state = get(store);
      
      if (!state.isConnected) {
        throw new Error('Wallet not connected');
      }

      //  Route to appropriate wallet service
      if (state.walletType === 'internet-identity') {
        return internetIdentity.getActor<T>(canisterId, idl);
      } else {
        return pnp.getActor(canisterId, idl);
      }
    },

    async isWalletConnected(): Promise<boolean> {
      const state = get(store);
      
      if (state.walletType === 'internet-identity') {
        return internetIdentity.checkAuthentication();
      } else {
        return pnp.isConnected();
      }
    },
    
    // Get the current principal
    getPrincipal(): Principal | null {
      const state = get(store);
      return state.account?.owner || null;
    },

    getWalletType(): WalletType {
      const state = get(store);
      return state.walletType;
    }
  };
}

// Create singleton instance
export const auth = createAuthStore();

// Helper function with more descriptive error message
export function requireWalletConnection(): void {
  if (!auth.isWalletConnected()) {
    throw new Error("Wallet connection required. Please connect your wallet first.");
  }
}