import { writable, derived, get } from 'svelte/store';
import { createPNP, type PNP, type PNPWallet, walletsList as PNPWalletsList } from '@windoge98/plug-n-play';
const walletsList = PNPWalletsList as ExtendedPNPWallet[];
import type { Principal } from '@dfinity/principal';
import { CONFIG, CANISTER_IDS, LOCAL_CANISTER_IDS } from '../config';
import { pnp, canisterIDLs, initializePermissions } from '../services/pnp';
import { ProtocolService } from '../services/protocol';
import { TokenService } from '../services/tokenService';
import { auth } from '../services/auth';


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
      // Get appropriate canister IDs based on environment
      const protocolId = CONFIG.isLocal ? LOCAL_CANISTER_IDS.PROTOCOL : CANISTER_IDS.PROTOCOL;
      const icpId = CONFIG.isLocal ? LOCAL_CANISTER_IDS.ICP_LEDGER : CANISTER_IDS.ICP_LEDGER;
      const icusdId = CONFIG.isLocal ? LOCAL_CANISTER_IDS.ICUSD_LEDGER : CANISTER_IDS.ICUSD_LEDGER;

      // Get all actors at once
      const [protocolActor, icpActor, icusdActor] = await Promise.all([
        pnp.getActor(protocolId, canisterIDLs.rumi_backend),
        pnp.getActor(icpId, canisterIDLs.icp_ledger),
        pnp.getActor(icusdId, canisterIDLs.icusd_ledger)
      ]);

      // Store protocol actor for reuse
      authenticatedActor = protocolActor;

      // Request all permissions in one batch
      await Promise.all([
        // Protocol permissions - use minimal set to reduce prompts
        protocolActor.get_protocol_status(),
        // Ledger basic permissions
        icpActor.icrc1_balance_of({ owner: ownerPrincipal, subaccount: [] })
      ]).catch(() => {}); // Ignore errors, we just want to trigger permissions

      return [icpActor, icusdActor];
    } catch (err) {
      console.error('Failed to initialize permissions:', err);
      throw err;
    }
  }

  async function initializeWallet(principal: Principal) {
    try {
      console.log('Initializing wallet for:', principal.toText());
      
      // Initialize all permissions first
      const permissionsGranted = await initializePermissions();
      if (!permissionsGranted) {
        throw new Error('Failed to get required permissions');
      }

      // Get both balances in parallel after permissions are granted
      const [icpBalance, icusdBalance] = await Promise.all([
        TokenService.getTokenBalance(CONFIG.currentIcpLedgerId, principal),
        TokenService.getTokenBalance(CONFIG.currentIcusdLedgerId, principal)
      ]);
      
      // Get ICP price
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

      const [icpBalance, icusdBalance] = await Promise.all([
        TokenService.getTokenBalance(CONFIG.currentIcpLedgerId, state.principal),
        TokenService.getTokenBalance(CONFIG.currentIcusdLedgerId, state.principal)
      ]);
      const icpPrice = await ProtocolService.getICPPrice();
      const icpPriceValue = typeof icpPrice === 'number' ? icpPrice : null;

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

  // Start auto-refresh when connected
  function startBalanceRefresh() {
    if (!refreshInterval) {
      refreshBalance(); // Initial refresh
      refreshInterval = setInterval(refreshBalance, 30000); // Refresh every 30s (adjusted from 10000000)
    }
  }

  // Stop auto-refresh when disconnected
  function stopBalanceRefresh() {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
  }

  // Add a method to clear pending operations
  async function clearPendingOperations() {
    try {
      console.log('Clearing any pending wallet operations');
      
      // If using Plug, create a quick balance request that we can abort
      // This helps flush any pending state in the wallet
      if (window.ic?.plug) {
        const abortController = new AbortController();
        const dummyPromise = window.ic.plug.requestBalance();
        
        // Immediately abort
        abortController.abort();
        
        // Catch and ignore the resulting error
        (dummyPromise as Promise<any>).catch(() => {});
      }
      
      // Short delay to ensure wallet can recover
      await new Promise(resolve => setTimeout(resolve, 300));
      
      return true;
    } catch (err) {
      console.warn('Error clearing pending operations:', err);
      return false;
    }
  }

  // Add a method to clean up any stale operations
  async function cleanupPendingOperations() {
    try {
      console.log('Cleaning up any stale operations for newly connected wallet');

      // Clear any ongoing wallet operations
      if (window.ic?.plug) {
        // Check which API method is available
        if (typeof window.ic.plug.agent.getPrincipal === 'function') {
          try {
            // Just use getPrincipal as a safe method to check agent connectivity
            const dummyPromise = window.ic.plug.agent.getPrincipal() as Promise<unknown>;
            dummyPromise.catch(() => {});
          } catch (e) {
            console.warn('Error during getPrincipal call:', e);
          }
        } 
        // Only call requestBalance if it exists
        else if (typeof window.ic.plug.requestBalance === 'function') {
          try {
            const dummyPromise = window.ic.plug.requestBalance() as Promise<unknown>;
            dummyPromise.catch(() => {});
          } catch (e) {
            console.warn('Error during requestBalance call:', e);
          }
        }
      }
      
      // Add a short delay to ensure operations have time to abort
      await new Promise(resolve => setTimeout(resolve, 500));
      
      return true;
    } catch (err) {
      console.warn('Error cleaning up pending operations:', err);
      return false;
    }
  }

  async function refreshWallet() {
    console.log('Attempting to refresh wallet connection...');
    
    // First clear any pending operations
    await clearPendingOperations();
    
    // First get current wallet info
    const currentState = get(walletStore);
    const currentWalletId = localStorage.getItem('rumi_last_wallet');
    
    if (!currentWalletId || !pnp) {
      console.warn('No wallet to refresh');
      return;
    }
  
    // Try disconnecting first
    try {
      await pnp.disconnect();
      console.log('Disconnected from wallet');
    } catch (e) {
      console.warn('Disconnect failed:', e);
    }
  
    // Short delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Try reconnecting
    try {
      update(s => ({ ...s, loading: true, error: null }));
      
      const connected = await pnp.connect(currentWalletId);
      if (!connected) {
        throw new Error('Wallet reconnect failed');
      }
      console.log('Successfully reconnected to wallet');
      
      // Update the principal if needed
      if (!currentState.principal && connected.owner) {
        update(s => ({...s, principal: connected.owner, loading: false}));
      } else {
        update(s => ({...s, loading: false}));
      }
      
      // Refresh balance immediately after reconnecting
      await refreshBalance();
      
      return true;
    } catch (e) {
      update(s => ({...s, loading: false, error: e instanceof Error ? e.message : 'Unknown error'}));
      console.error('Wallet refresh failed:', e);
      throw e;
    }
  }

  // Add debug function for reporting wallet state
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
        
        // First, clean up any lingering operations from previous connections
        await cleanupPendingOperations();
        
        // Use auth service for connection
        const account = await auth.connect(walletId);
        
        if (!account) throw new Error('No account returned from wallet');
        
        const ownerPrincipal = getOwner(account);
        console.log('Connected principal:', ownerPrincipal.toText());

        // Initialize wallet and get initial balance
        const { balance, tokenBalances } = await initializeWallet(ownerPrincipal);

        // Update store with all information
        update(s => ({
          ...s,
          isConnected: true,
          principal: ownerPrincipal,
          balance,
          tokenBalances,
          loading: false,
          icon: walletsList.find(w => w.id === walletId)?.icon ?? ''
        }));

        // Start auto-refresh
        startBalanceRefresh();
        
        // Debug logging
        debugWalletState();
        
        return true;
      } catch (err) {
        console.error('Connection failed:', err);
        authenticatedActor = null;
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
        await pnp.disconnect();
        authenticatedActor = null;
        
        // Stop balance refresh on disconnect
        stopBalanceRefresh();

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