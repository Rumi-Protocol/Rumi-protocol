import { writable, derived, get } from 'svelte/store';
import { createPNP, type PNP, type PNPWallet, walletsList as PNPWalletsList } from '@windoge98/plug-n-play';
const walletsList = PNPWalletsList as ExtendedPNPWallet[];
import type { Principal } from '@dfinity/principal';
import { CONFIG, CANISTER_IDS, LOCAL_CANISTER_IDS } from '../config';
import { pnp, canisterIDLs } from '../services/pnp';
import { ProtocolService } from '../services/protocol';
import { TokenService } from '../services/tokenService';
import { auth, WALLET_TYPES } from '../services/auth';
import { RequestDeduplicator } from '../services/RequestDeduplicator';
import { appDataStore } from './appDataStore';

interface WalletState {
  isConnected: boolean;
  principal: Principal | null;
  balance: bigint | null;
  error: string | null;
  loading: boolean;
  icon: string;
  tokenBalances: {
    ICP?: {
      raw: bigint;
      formatted: string;
      usdValue: number | null;
    };
    ICUSD?: {
      raw: bigint;
      formatted: string;
      usdValue: number | null;
    };
  };
}

// Add interface for wallet info with icon
interface ExtendedPNPWallet extends PNPWallet {
  icon?: string;
}

// Helper to extract the proper Principal value.
function getOwner(principal: any): Principal {
  return principal?.owner ? principal.owner : principal;
}

function createWalletStore() {
  const { subscribe, set, update } = writable<WalletState>({
    isConnected: false,
    principal: null,
    balance: null,
    error: null,
    loading: false,
    icon: String(),
    tokenBalances: {}
  });

  let authenticatedActor: any = null;

  // Add interval tracking
  let refreshInterval: ReturnType<typeof setInterval> | null = null;

  // Add approval tracking to prevent race conditions
  let lastApproval = {
    timestamp: 0,
    amount: 0n
  };

  // Add method to track approvals
  async function trackApproval(amount: bigint) {
    lastApproval = {
      timestamp: Date.now(),
      amount
    };
  }

  // Add method to check recent approvals
  function hasRecentApproval(amount: bigint): boolean {
    const now = Date.now();
    return (
      now - lastApproval.timestamp < 5000 && // Within last 5 seconds
      lastApproval.amount >= amount
    );
  }

  async function initializeAllPermissions(ownerPrincipal: Principal) {
    try {
      console.log('Permissions already granted during connection - skipping individual requests');
      
      const protocolId = CONFIG.isLocal ? LOCAL_CANISTER_IDS.PROTOCOL : CANISTER_IDS.PROTOCOL;
      const icpId = CONFIG.isLocal ? LOCAL_CANISTER_IDS.ICP_LEDGER : CANISTER_IDS.ICP_LEDGER;
      const icusdId = CONFIG.isLocal ? LOCAL_CANISTER_IDS.ICUSD_LEDGER : CANISTER_IDS.ICUSD_LEDGER;

      const [protocolActor, icpActor, icusdActor] = await Promise.all([
        pnp.getActor(protocolId, canisterIDLs.rumi_backend),
        pnp.getActor(icpId, canisterIDLs.icp_ledger),
        pnp.getActor(icusdId, canisterIDLs.icusd_ledger)
      ]);

      authenticatedActor = protocolActor;

      return [icpActor, icusdActor];
    } catch (err) {
      console.error('Failed to get actors (permissions should already be granted):', err);
      throw err;
    }
  }

  async function initializeWallet(principal: Principal) {
    try {
      console.log('Initializing wallet for:', principal.toText());
      
      const [icpBalance, icusdBalance] = await Promise.all([
        TokenService.getTokenBalance(CONFIG.currentIcpLedgerId, principal),
        TokenService.getTokenBalance(CONFIG.currentIcusdLedgerId, principal)
      ]);
      
      const icpPrice = await ProtocolService.getICPPrice();
      const icpPriceValue = typeof icpPrice === 'number' ? icpPrice : null;
      
      return {
        balance: icpBalance,
        tokenBalances: {
          ICP: {
            raw: icpBalance,
            formatted: TokenService.formatBalance(icpBalance),
            usdValue: icpPriceValue !== null ? Number(TokenService.formatBalance(icpBalance)) * icpPriceValue : null
          },
          ICUSD: {
            raw: icusdBalance,
            formatted: TokenService.formatBalance(icusdBalance),
            usdValue: Number(TokenService.formatBalance(icusdBalance))
          }
        }
      };
    } catch (error) {
      console.error('Wallet initialization failed:', error);
      throw error; // Propagate error to handle in UI
    }
  }

  async function refreshBalance() {
    try {
      const state = get(walletStore);
      if (!state.principal || !state.isConnected) {
        console.log('Wallet not ready for balance refresh');
        return;
      }

      const { icpBalance, icusdBalance } = await appDataStore.fetchBalances(state.principal, true);
      const protocolStatus = await appDataStore.fetchProtocolStatus();
      const icpPriceValue = protocolStatus?.lastIcpRate || 0;

      update(state => ({
        ...state,
        balance: icpBalance,
        tokenBalances: {
          ICP: {
            raw: icpBalance,
            formatted: TokenService.formatBalance(icpBalance),
            usdValue: icpPriceValue !== null ? Number(TokenService.formatBalance(icpBalance)) * icpPriceValue : null
          },
          ICUSD: {
            raw: icusdBalance,
            formatted: TokenService.formatBalance(icusdBalance),
            usdValue: Number(TokenService.formatBalance(icusdBalance))
          }
        },
        error: null
      }));
      
      return { icpBalance, icusdBalance };
    } catch (err) {
      console.error('Balance refresh failed:', err);
      update(state => ({
        ...state,
        error: err instanceof Error ? err.message : 'Failed to fetch balance'
      }));
      throw err;
    }
  }

  function startBalanceRefresh() {
    if (!refreshInterval) {
      refreshBalance();
      refreshInterval = setInterval(refreshBalance, 30000);
    }
  }

  function stopBalanceRefresh() {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
  }

  async function clearPendingOperations() {
    try {
      console.log('Clearing any pending wallet operations');
      
      if (typeof window !== 'undefined' && window.ic?.plug) {
        const abortController = new AbortController();
        const dummyPromise = window.ic.plug.requestBalance();
        abortController.abort();
        (dummyPromise as Promise<any>).catch(() => {});
      }
      
      await new Promise(resolve => setTimeout(resolve, 300));
      
      return true;
    } catch (err) {
      console.warn('Error clearing pending operations:', err);
      return false;
    }
  }

  async function cleanupPendingOperations() {
    try {
      console.log('Cleaning up any stale operations for newly connected wallet');

      if (typeof window !== 'undefined' && window.ic?.plug) {
        if (typeof window.ic.plug.agent.getPrincipal === 'function') {
          try {
            const dummyPromise = window.ic.plug.agent.getPrincipal() as Promise<unknown>;
            dummyPromise.catch(() => {});
          } catch (e) {
            console.warn('Error during getPrincipal call:', e);
          }
        } else if (typeof window.ic.plug.requestBalance === 'function') {
          try {
            const dummyPromise = window.ic.plug.requestBalance() as Promise<unknown>;
            dummyPromise.catch(() => {});
          } catch (e) {
            console.warn('Error during requestBalance call:', e);
          }
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      return true;
    } catch (err) {
      console.warn('Error cleaning up pending operations:', err);
      return false;
    }
  }

  async function refreshWallet() {
    console.log('Attempting to refresh wallet connection...');
    
    await clearPendingOperations();
    
    const currentState = get(walletStore);
    const currentWalletId = localStorage.getItem('rumi_last_wallet');
    
    if (!currentWalletId || !pnp) {
      console.warn('No wallet to refresh');
      return;
    }
  
    try {
      await pnp.disconnect();
      console.log('Disconnected from wallet');
    } catch (e) {
      console.warn('Disconnect failed:', e);
    }
  
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    try {
      update(s => ({ ...s, loading: true, error: null }));
      
      const connected = await pnp.connect(currentWalletId);
      if (!connected) {
        throw new Error('Wallet reconnect failed');
      }
      console.log('Successfully reconnected to wallet');
      
      if (!currentState.principal && connected.owner) {
        update(s => ({...s, principal: connected.owner, loading: false}));
      } else {
        update(s => ({...s, loading: false}));
      }
      
      await refreshBalance();
      
      return true;
    } catch (e) {
      update(s => ({...s, loading: false, error: e instanceof Error ? e.message : 'Unknown error'}));
      console.error('Wallet refresh failed:', e);
      throw e;
    }
  }

  function debugWalletState() {
    const state = get(walletStore);
    console.log('Current wallet state:', state);
    
    if (state.tokenBalances?.ICP) {
      console.log('ICP balance details:', {
        raw: state.tokenBalances.ICP.raw.toString(),
        formatted: state.tokenBalances.ICP.formatted,
        usdValue: state.tokenBalances.ICP.usdValue
      });
    }
    
    return state;
  }

  return {
    subscribe,
    pnp,  
    getAuthenticatedActor: () => authenticatedActor,

    async connect(walletId: string) {
      try {
        update(s => ({ ...s, loading: true, error: null }));
        
        await cleanupPendingOperations();
        
        const account = await auth.connect(walletId);
        
        if (!account) throw new Error('No account returned from wallet');
        
        const ownerPrincipal = getOwner(account);
        console.log('Connected principal:', ownerPrincipal.toText());

        appDataStore.setWalletState(true, ownerPrincipal);

        const { icpBalance, icusdBalance } = await appDataStore.fetchBalances(ownerPrincipal);
        const protocolStatus = await appDataStore.fetchProtocolStatus();
        
        const icpPriceValue = protocolStatus?.lastIcpRate || 0;

        update(s => ({
          ...s,
          isConnected: true,
          principal: ownerPrincipal,
          balance: icpBalance,
          tokenBalances: {
            ICP: {
              raw: icpBalance,
              formatted: TokenService.formatBalance(icpBalance),
              usdValue: icpPriceValue !== null ? Number(TokenService.formatBalance(icpBalance)) * icpPriceValue : null
            },
            ICUSD: {
              raw: icusdBalance,
              formatted: TokenService.formatBalance(icusdBalance),
              usdValue: Number(TokenService.formatBalance(icusdBalance))
            }
          },
          loading: false,
          icon: walletId === WALLET_TYPES.INTERNET_IDENTITY 
            ? 'https://internetcomputer.org/img/IC_logo_horizontal.svg'
            : walletsList.find(w => w.id === walletId)?.icon ?? ''
        }));

        startBalanceRefresh();
        
        debugWalletState();
        
        return true;
      } catch (err) {
        console.error('Connection failed:', err);
        authenticatedActor = null;
        appDataStore.setWalletState(false, null);
        update(s => ({
          ...s,
          error: err instanceof Error ? err.message : 'Failed to connect wallet',
          loading: false
        }));
        throw err;
      }
    },

    async disconnect() {
      try {
        // Use auth service for proper disconnect handling (Internet Identity + Plug)
        await auth.disconnect();
        
        authenticatedActor = null;
        
        stopBalanceRefresh();

        appDataStore.setWalletState(false, null);

        set({
          isConnected: false,
          principal: null,
          balance: null,
          error: null,
          loading: false,
          icon: String(),
          tokenBalances: {}
        });
      } catch (err) {
        console.error('Disconnection failed:', err);
        update(s => ({
          ...s,
          error: err instanceof Error ? err.message : 'Failed to disconnect wallet'
        }));
        throw err;
      }
    },

    refreshBalance, 
    refreshWallet,
    debugWalletState,

    async getActor(canisterId: string, idl: any) {
      try {
        return await pnp.getActor(canisterId, idl);
      } catch (err) {
        console.error('Failed to get actor:', err);
        throw err;
      }
    }
  };
}

export const walletStore = createWalletStore();
export const isConnected = derived(walletStore, $wallet => $wallet.isConnected);
export const principal = derived(walletStore, $wallet => $wallet.principal);
export const balance = derived(walletStore, $wallet => $wallet.balance);
export const icon = derived(walletStore, $wallet => $wallet.icon);