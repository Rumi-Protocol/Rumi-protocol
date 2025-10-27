import { writable, derived, get } from 'svelte/store';
import type { Principal } from '@dfinity/principal';
import type { ProtocolStatusDTO, VaultDTO } from '../services/types';

/**
 * CENTRALIZED DATA STORE
 * This single store manages ALL application data to eliminate redundant backend calls
 * NO component should call backend directly - everything goes through this store
 */

interface AppDataState {
  // Protocol data
  protocolStatus: ProtocolStatusDTO | null;
  protocolStatusLoading: boolean;
  protocolStatusError: string | null;
  protocolStatusLastFetch: number;

  // User vaults data  
  userVaults: VaultDTO[];
  userVaultsLoading: boolean;
  userVaultsError: string | null;
  userVaultsLastFetch: number;

  // Wallet data
  walletConnected: boolean;
  walletPrincipal: Principal | null;
  icpBalance: bigint | null;
  icusdBalance: bigint | null;
  balancesLoading: boolean;
  balancesError: string | null;
  balancesLastFetch: number;

  // Request tracking to prevent duplicates
  activeRequests: Set<string>;
}

const INITIAL_STATE: AppDataState = {
  protocolStatus: null,
  protocolStatusLoading: false,
  protocolStatusError: null,
  protocolStatusLastFetch: 0,

  userVaults: [],
  userVaultsLoading: false,
  userVaultsError: null,
  userVaultsLastFetch: 0,

  walletConnected: false,
  walletPrincipal: null,
  icpBalance: null,
  icusdBalance: null,
  balancesLoading: false,
  balancesError: null,
  balancesLastFetch: 0,

  activeRequests: new Set(),
};

// Cache duration in milliseconds
const CACHE_DURATION = 5000; // 5 seconds

function createAppDataStore() {
  const { subscribe, set, update } = writable<AppDataState>(INITIAL_STATE);

  return {
    subscribe,

    /**
     * PROTOCOL STATUS - Single source of truth
     */
    async fetchProtocolStatus(forceRefresh = false): Promise<ProtocolStatusDTO | null> {
      return new Promise((resolve, reject) => {
        const requestKey = 'protocol_status'; // Move requestKey outside update callback
        
        update(state => {
          const now = Date.now();
          
          // If request already active, wait for it
          if (state.activeRequests.has(requestKey)) {
            console.log('🔄 Protocol status request already in progress...');
            // Wait for the active request to complete
            const checkCompletion = () => {
              const currentState = get(appDataStore);
              if (!currentState.activeRequests.has(requestKey)) {
                resolve(currentState.protocolStatus);
              } else {
                setTimeout(checkCompletion, 100);
              }
            };
            checkCompletion();
            return state;
          }

          // Use cache if valid and not forcing refresh
          if (!forceRefresh && 
              state.protocolStatus && 
              (now - state.protocolStatusLastFetch) < CACHE_DURATION) {
            console.log('📦 Using cached protocol status');
            resolve(state.protocolStatus);
            return state;
          }

          // Start new request
          console.log('🆕 Fetching fresh protocol status...');
          state.activeRequests.add(requestKey);
          
          return {
            ...state,
            protocolStatusLoading: true,
            protocolStatusError: null,
          };
        });

        // Make the actual API call
        this._fetchProtocolStatusFromAPI()
          .then(protocolStatus => {
            update(state => {
              state.activeRequests.delete(requestKey);
              resolve(protocolStatus);
              return {
                ...state,
                protocolStatus,
                protocolStatusLoading: false,
                protocolStatusError: null,
                protocolStatusLastFetch: Date.now(),
              };
            });
          })
          .catch(error => {
            update(state => {
              state.activeRequests.delete(requestKey); // Now requestKey is accessible
              const errorMsg = error.message || 'Failed to fetch protocol status';
              reject(new Error(errorMsg));
              return {
                ...state,
                protocolStatusLoading: false,
                protocolStatusError: errorMsg,
              };
            });
          });
      });
    },

    /**
     * USER VAULTS - Single source of truth
     */
    async fetchUserVaults(principal: Principal, forceRefresh = false): Promise<VaultDTO[]> {
      return new Promise((resolve, reject) => {
        const requestKey = `user_vaults_${principal.toString()}`; // Move requestKey outside
        
        update(state => {
          const now = Date.now();
          
          // If request already active, wait for it
          if (state.activeRequests.has(requestKey)) {
            console.log('🔄 User vaults request already in progress...');
            const checkCompletion = () => {
              const currentState = get(appDataStore);
              if (!currentState.activeRequests.has(requestKey)) {
                resolve(currentState.userVaults);
              } else {
                setTimeout(checkCompletion, 100);
              }
            };
            checkCompletion();
            return state;
          }

          // Use cache if valid and not forcing refresh
          if (!forceRefresh && 
              state.userVaults.length >= 0 && // Allow empty arrays to be cached
              state.walletPrincipal?.toString() === principal.toString() &&
              (now - state.userVaultsLastFetch) < CACHE_DURATION) {
            console.log('📦 Using cached user vaults');
            resolve(state.userVaults);
            return state;
          }

          // Start new request
          console.log('🆕 Fetching fresh user vaults...');
          state.activeRequests.add(requestKey);
          
          return {
            ...state,
            userVaultsLoading: true,
            userVaultsError: null,
          };
        });

        // Make the actual API call
        this._fetchUserVaultsFromAPI(principal)
          .then(userVaults => {
            update(state => {
              state.activeRequests.delete(requestKey);
              resolve(userVaults);
              return {
                ...state,
                userVaults,
                userVaultsLoading: false,
                userVaultsError: null,
                userVaultsLastFetch: Date.now(),
              };
            });
          })
          .catch(error => {
            update(state => {
              state.activeRequests.delete(requestKey); // Now requestKey is accessible
              const errorMsg = error.message || 'Failed to fetch user vaults';
              reject(new Error(errorMsg));
              return {
                ...state,
                userVaultsLoading: false,
                userVaultsError: errorMsg,
              };
            });
          });
      });
    },

    /**
     * WALLET BALANCES - Single source of truth
     */
    async fetchBalances(principal: Principal, forceRefresh = false): Promise<{ icpBalance: bigint; icusdBalance: bigint }> {
      return new Promise((resolve, reject) => {
        const requestKey = `balances_${principal.toString()}`; // Move requestKey outside
        
        update(state => {
          const now = Date.now();
          
          // If request already active, wait for it
          if (state.activeRequests.has(requestKey)) {
            console.log('🔄 Balance request already in progress...');
            const checkCompletion = () => {
              const currentState = get(appDataStore);
              if (!currentState.activeRequests.has(requestKey)) {
                resolve({ 
                  icpBalance: currentState.icpBalance || 0n, 
                  icusdBalance: currentState.icusdBalance || 0n 
                });
              } else {
                setTimeout(checkCompletion, 100);
              }
            };
            checkCompletion();
            return state;
          }

          // Use cache if valid and not forcing refresh
          if (!forceRefresh && 
              state.icpBalance !== null && 
              state.icusdBalance !== null &&
              state.walletPrincipal?.toString() === principal.toString() &&
              (now - state.balancesLastFetch) < CACHE_DURATION) {
            console.log('📦 Using cached balances');
            resolve({ icpBalance: state.icpBalance, icusdBalance: state.icusdBalance });
            return state;
          }

          // Start new request
          console.log('🆕 Fetching fresh balances...');
          state.activeRequests.add(requestKey);
          
          return {
            ...state,
            balancesLoading: true,
            balancesError: null,
          };
        });

        // Make the actual API call
        this._fetchBalancesFromAPI(principal)
          .then(({ icpBalance, icusdBalance }) => {
            update(state => {
              state.activeRequests.delete(requestKey);
              resolve({ icpBalance, icusdBalance });
              return {
                ...state,
                icpBalance,
                icusdBalance,
                balancesLoading: false,
                balancesError: null,
                balancesLastFetch: Date.now(),
              };
            });
          })
          .catch(error => {
            update(state => {
              state.activeRequests.delete(requestKey); // Now requestKey is accessible
              const errorMsg = error.message || 'Failed to fetch balances';
              reject(new Error(errorMsg));
              return {
                ...state,
                balancesLoading: false,
                balancesError: errorMsg,
              };
            });
          });
      });
    },

    /**
     * WALLET CONNECTION STATE
     */
    setWalletState(connected: boolean, principal: Principal | null) {
      update(state => ({
        ...state,
        walletConnected: connected,
        walletPrincipal: principal,
        // Clear user-specific data when wallet disconnects
        ...(!connected && {
          userVaults: [],
          userVaultsLastFetch: 0,
          icpBalance: null,
          icusdBalance: null,
          balancesLastFetch: 0,
        })
      }));
    },

    /**
     * FORCE REFRESH ALL DATA
     */
    async refreshAll(principal?: Principal): Promise<void> {
      const currentState = get(appDataStore);
      const targetPrincipal = principal || currentState.walletPrincipal;
      
      if (!targetPrincipal) {
        console.warn('No principal available for refresh');
        return;
      }

      console.log('🔄 Force refreshing all data...');
      
      try {
        await Promise.all([
          this.fetchProtocolStatus(true),
          this.fetchUserVaults(targetPrincipal, true),
          this.fetchBalances(targetPrincipal, true),
        ]);
        console.log('✅ All data refreshed successfully');
      } catch (error) {
        console.error('❌ Error refreshing data:', error);
      }
    },

    /**
     * CLEAR ALL DATA
     */
    clearAll(): void {
      set(INITIAL_STATE);
    },

    // PRIVATE API METHODS - These are the only places that should make backend calls
    async _fetchProtocolStatusFromAPI(): Promise<ProtocolStatusDTO> {
      // Import here to avoid circular dependencies
      const { QueryOperations } = await import('../services/protocol/queryOperations');
      return QueryOperations.getProtocolStatus();
    },

    async _fetchUserVaultsFromAPI(principal: Principal): Promise<VaultDTO[]> {
      // Import here to avoid circular dependencies  
      const { ApiClient } = await import('../services/protocol/apiClient');
      return ApiClient.getUserVaults(true); // Always force refresh from API
    },

    async _fetchBalancesFromAPI(principal: Principal): Promise<{ icpBalance: bigint; icusdBalance: bigint }> {
      // Import here to avoid circular dependencies
      const { TokenService } = await import('../services/tokenService');
      const { CONFIG } = await import('../config');
      
      const [icpBalance, icusdBalance] = await Promise.all([
        TokenService.getTokenBalance(CONFIG.currentIcpLedgerId, principal),
        TokenService.getTokenBalance(CONFIG.currentIcusdLedgerId, principal)
      ]);
      
      return { icpBalance, icusdBalance };
    }
  };
}

export const appDataStore = createAppDataStore();

// DERIVED STORES - These are reactive and update automatically
export const protocolStatus = derived(appDataStore, $store => $store.protocolStatus);
export const userVaults = derived(appDataStore, $store => $store.userVaults);
export const icpBalance = derived(appDataStore, $store => $store.icpBalance);
export const icusdBalance = derived(appDataStore, $store => $store.icusdBalance);
export const walletConnected = derived(appDataStore, $store => $store.walletConnected);

// LOADING STATES
export const isLoadingProtocol = derived(appDataStore, $store => $store.protocolStatusLoading);
export const isLoadingVaults = derived(appDataStore, $store => $store.userVaultsLoading);
export const isLoadingBalances = derived(appDataStore, $store => $store.balancesLoading);