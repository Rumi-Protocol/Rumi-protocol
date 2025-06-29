import { writable, get } from 'svelte/store';
import { protocolService } from '../services/protocol';
import { walletStore } from './wallet';
import { BigIntUtils } from '../utils/bigintUtils';
import type { VaultDTO } from '../services/types';

// Define enhanced vault type with additional calculated properties
export interface EnhancedVault {
  vaultId: number;
  owner: string;
  icpMargin: number;
  borrowedIcusd: number;
  timestamp: number;
  lastUpdated: number;
  collateralRatio?: number;
  collateralValueUSD?: number;
  maxBorrowable?: number;
  status?: 'healthy' | 'warning' | 'danger';
}

export interface PendingTransfer {
  vaultId: number;
  amount: number;
  timestamp: number;
  type: 'margin' | 'redemption';
}

interface VaultStoreState {
  vaults: EnhancedVault[];
  isLoading: boolean;
  error: string | null;
  lastUpdated: number;
  pendingTransfers: PendingTransfer[];
}

const DEFAULT_STATE: VaultStoreState = {
  vaults: [],
  isLoading: false,
  error: null,
  lastUpdated: 0,
  pendingTransfers: []
};

function createVaultStore() {
  const { subscribe, set, update } = writable<VaultStoreState>(DEFAULT_STATE);
  
  // Add a timestamp to track the last successful vault fetching
  let lastFetchTime = 0;
  // Cache time in milliseconds (5 seconds)
  const CACHE_DURATION = 5000;

  return {
    subscribe,

        /**
     * Refresh all vaults data with the latest from backend
     * This is the primary method to call when you need fresh data
     */
        async refreshVaults(): Promise<EnhancedVault[]> {
          // Force a true refresh by ignoring cache
          return this.loadVaults(true);
        },
    
        /**
         * Update a vault after an operation
         * This method ensures the UI components update properly
         */
        async refreshVault(vaultId: number): Promise<EnhancedVault | null> {
          try {
            // Get fresh data from backend for this specific vault
            const vaultData = await protocolService.getVaultById(vaultId);
            
            if (!vaultData) {
              // Vault might have been closed - remove it from the store
              this.removeVault(vaultId);
              return null;
            }
            
            // Get current ICP price
            const protocolStatus = await protocolService.getProtocolStatus();
            const icpPrice = protocolStatus.lastIcpRate;
            
            // Enhance the vault with derived values
            const enhancedVault = this.enhanceVault(vaultData, icpPrice);
            
            // Update the store with this new vault data
            update(state => {
              const index = state.vaults.findIndex(v => v.vaultId === vaultId);
              const updatedVaults = [...state.vaults];
              
              if (index >= 0) {
                // Update existing vault
                updatedVaults[index] = enhancedVault;
              } else {
                // Add new vault
                updatedVaults.push(enhancedVault);
              }
              
              // Save to local storage
              this.saveToLocalStorage(updatedVaults, state.pendingTransfers);
              
              return {
                ...state,
                vaults: updatedVaults,
                lastUpdated: Date.now()
              };
            });
            
            return enhancedVault;
          } catch (err) {
            console.error(`Error refreshing vault #${vaultId}:`, err);
            return null;
          }
        },
    
    /**
     * Load vaults for the currently connected wallet with caching
     */
    async loadVaults(forceRefresh = false) {
      const walletState = get(walletStore);
      if (!walletState.isConnected || !walletState.principal) {
        update(state => ({ ...state, error: 'Wallet not connected' }));
        return [];
      }
      
      const currentTime = Date.now();
      
      // If data is fresh enough and forceRefresh is not requested, use cached data
      if (!forceRefresh && 
          currentTime - lastFetchTime < CACHE_DURATION && 
          get({ subscribe }).vaults.length > 0) {
        console.log('Using cached vaults data - last fetched:', new Date(lastFetchTime).toLocaleTimeString());
        return get({ subscribe }).vaults;
      }
      
      // Otherwise fetch fresh data
      update(state => ({ ...state, isLoading: true, error: null }));
      
      try {
        console.log('Fetching fresh vaults data at', new Date().toLocaleTimeString());
        const protocolStatus = await protocolService.getProtocolStatus();
        // Explicitly exclude empty vaults when loading
        const vaults = await protocolService.getUserVaults(true); // Changed to true to force backend refresh
        
        const icpPrice = protocolStatus.lastIcpRate;
        
        const enhancedVaults = vaults
          .filter(vault => {
            // Double-check the vault is not effectively closed
            const hasCollateral = Number(vault.icpMargin) > 0;
            const hasDebt = Number(vault.borrowedIcusd) > 0;
            return hasCollateral || hasDebt;
          })
          .map(vault => this.enhanceVault(vault, icpPrice));
        
        update(state => ({
          ...state,
          vaults: enhancedVaults,
          lastUpdated: currentTime,
          isLoading: false
        }));
        
        // Update successful fetch timestamp
        lastFetchTime = currentTime;
        
        // Cache data
        this.saveToLocalStorage(enhancedVaults, get({ subscribe }).pendingTransfers);
        
        // Explicitly notify UI components that vault data has changed
        this.notifyVaultListChanged();
        
        return enhancedVaults;
      } catch (error) {
        console.error('Error loading vaults:', error);
        update(state => ({
          ...state,
          error: error instanceof Error ? error.message : 'Failed to load vaults',
          isLoading: false
        }));
        
        // Try to load from cache if available
        const cachedVaults = this.loadCachedVaults();
        if (cachedVaults.length > 0) {
          update(state => ({
            ...state,
            vaults: cachedVaults,
            error: 'Using cached data - unable to fetch latest',
          }));
          return cachedVaults;
        }
        
        throw error;
      }
    },
    
    /**
     * Enhance a vault DTO with calculated properties
     */
    enhanceVault(vault: VaultDTO, currentIcpPrice: number): EnhancedVault {
      // CRITICAL FIX: Ensure values are proper numbers and not strings
      const icpMargin = typeof vault.icpMargin === 'string' ? parseFloat(vault.icpMargin) : vault.icpMargin;
      const borrowedIcusd = typeof vault.borrowedIcusd === 'string' ? parseFloat(vault.borrowedIcusd) : vault.borrowedIcusd;
      
      // Log the values for debugging
      console.log(`Enhancing vault #${vault.vaultId} - icpMargin: ${icpMargin}, borrowedIcusd: ${borrowedIcusd}`);
      
      const collateralValueUsd = icpMargin * currentIcpPrice;
      
      // Calculate collateral ratio (prevent division by zero)
      const collateralRatio = borrowedIcusd > 0 
        ? collateralValueUsd / borrowedIcusd 
        : Infinity;
      
      // Ensure timestamp is a number (use current time if not present)
      const timestamp = vault.timestamp || Date.now();
      
      return {
        ...vault,
        icpMargin,             // Ensure numeric
        borrowedIcusd,         // Ensure numeric
        collateralValueUSD: collateralValueUsd,
        collateralRatio,
        timestamp,             // Ensure timestamp is always provided
        lastUpdated: Date.now()
      };
    },
    
    /**
     * Load vaults from cache
     */
    loadCachedVaults(): EnhancedVault[] {
      try {
        const principal = get(walletStore).principal?.toString();
        if (!principal) return [];
        
        const vaultsStorageKey = `vaults_${principal}`;
        const storedVaultsData = localStorage.getItem(vaultsStorageKey);
        
        if (storedVaultsData) {
          const data = BigIntUtils.parse(storedVaultsData);
          return data.vaults || [];
        }
        return [];
      } catch (err) {
        console.error('Failed to load cached vaults:', err);
        return [];
      }
    },
    
    /**
     * Get a specific vault by ID with option to force refresh from backend
     */
    async getVault(vaultId: number, forceRefresh = false): Promise<EnhancedVault | null> {
      if (forceRefresh) {
        return this.refreshVault(vaultId);
      }
      
      const state = get({ subscribe });
      
      // Try to find in current state first
      const existingVault = state.vaults.find(v => v.vaultId === vaultId);
      if (existingVault) return existingVault;
      
      // If not found, try to load all vaults
      try {
        const vaults = await this.loadVaults();
        return vaults.find(v => v.vaultId === vaultId) || null;
      } catch (error) {
        console.error(`Failed to get vault #${vaultId}:`, error);
        return null;
      }
    },
    
    /**
     * Update a specific vault's data with recalculation of derived values if needed
     */
    async updateVaultWithDerivedValues(vaultId: number, updates: Partial<EnhancedVault>): Promise<void> {
      // First check if we need to recalculate derived values
      const needsRecalculation = 'icpMargin' in updates || 'borrowedIcusd' in updates;
      
      if (needsRecalculation) {
        try {
          // Get current price outside of update to avoid multiple store updates
          const icpPrice = await protocolService.getICPPrice();
          
          update(state => {
            const index = state.vaults.findIndex(v => v.vaultId === vaultId);
            if (index === -1) return state;
            
            // Create updated vault with new values
            const updatedVault = {
              ...state.vaults[index],
              ...updates,
            } as VaultDTO;
            
            // Enhance it with derived values
            const enhancedVault = this.enhanceVault(updatedVault, icpPrice);
            
            // Create new vaults array with the updated vault
            const updatedVaults = [...state.vaults];
            updatedVaults[index] = enhancedVault;
            
            // Save to local storage
            this.saveToLocalStorage(updatedVaults, state.pendingTransfers);
            
            return {
              ...state,
              vaults: updatedVaults
            };
          });
        } catch (error) {
          console.warn('Failed to update vault with derived values:', error);
          
          // Fall back to basic update without derived values recalculation
          this.updateVaultBasic(vaultId, updates);
        }
      } else {
        // No need for price or recalculation, just do a basic update
        this.updateVaultBasic(vaultId, updates);
      }
    },
    
 
    /**
     * Basic vault update without recalculating derived values
     */
    updateVaultBasic(vaultId: number, updates: Partial<EnhancedVault>): void {
      update(state => {
        const index = state.vaults.findIndex(v => v.vaultId === vaultId);
        if (index === -1) return state;
        
        const updatedVaults = [...state.vaults];
        updatedVaults[index] = {
          ...updatedVaults[index],
          ...updates,
          lastUpdated: Date.now()
        };
        
        // Save to local storage
        this.saveToLocalStorage(updatedVaults, state.pendingTransfers);
        
        return {
          ...state,
          vaults: updatedVaults
        };
      });
      
      // Ensure UI components know about the change
      this.notifyVaultDataChanged(vaultId);
    },

        /**
     * Notify subscribers that a specific vault has updated
     * This helps reactive components know when to update
     */
        notifyVaultDataChanged(vaultId: number): void {
          const event = new CustomEvent('vault-updated', {
            detail: {
              vaultId,
              timestamp: Date.now()
            }
          });
          window.dispatchEvent(event);
          
          // Also dispatch the general vaults-changed event
          this.notifyVaultListChanged();
        },
    
    // Replace the existing updateVault method with a delegation to the new methods
    updateVault(vaultId: number, updates: Partial<EnhancedVault>): void {
      this.updateVaultWithDerivedValues(vaultId, updates);
    },
    
    /**
     * Add a pending transfer when a vault is closed
     */
    addPendingTransfer(vaultId: number, amount: number, type: 'margin' | 'redemption' = 'margin'): void {
      update(state => {
        // Check if this transfer already exists
        const existingIndex = state.pendingTransfers.findIndex(t => 
          t.vaultId === vaultId && t.type === type
        );
        
        let newPendingTransfers = [...state.pendingTransfers];
        
        if (existingIndex >= 0) {
          // Update existing transfer
          newPendingTransfers[existingIndex] = {
            ...newPendingTransfers[existingIndex],
            amount,
            timestamp: Date.now()
          };
        } else {
          // Add new transfer
          newPendingTransfers.push({
            vaultId,
            amount,
            timestamp: Date.now(),
            type
          });
        }
        
        const updatedState = {
          ...state,
          pendingTransfers: newPendingTransfers
        };
        
        this.saveToLocalStorage(state.vaults, newPendingTransfers);
        
        return updatedState;
      });
    },
    
    /**
     * Remove a pending transfer once it's confirmed
     */
    removePendingTransfer(vaultId: number): void {
      update(state => {
        const updatedTransfers = state.pendingTransfers.filter(t => t.vaultId !== vaultId);
        
        this.saveToLocalStorage(state.vaults, updatedTransfers);
        
        return {
          ...state,
          pendingTransfers: updatedTransfers
        };
      });
    },
    
    /**
     * Remove a vault from local state (after closing)
     */
    removeVault(vaultId: number): void {
      update(state => {
        const updatedVaults = state.vaults.filter(v => v.vaultId !== vaultId);
        
        // Re-organize the UI display of vaults (not the actual IDs)
        const organizedVaults = updatedVaults.map((vault, idx) => ({
          ...vault,
          displayOrder: idx + 1 // Add display order for UI purposes
        }));
        
        // Save to local storage
        this.saveToLocalStorage(organizedVaults, state.pendingTransfers);
        
        return {
          ...state,
          vaults: organizedVaults
        };
      });
      
      // Notify any subscribers that vault list has changed
      this.notifyVaultListChanged();
    },
    
    /**
     * Verify if a vault exists
     */
    vaultExists(vaultId: number): boolean {
      return get({ subscribe }).vaults.some(v => v.vaultId === vaultId);
    },
    
    /**
     * Notify subscribers that the vault list has changed
     */
     notifyVaultListChanged(): void {
      const event = new CustomEvent('vaults-changed', {
        detail: {
          vaults: get({ subscribe }).vaults
        }
      });
      window.dispatchEvent(event);
    },
    
    /**
     * Load pending transfers from local storage
     */
    loadPendingTransfers(): PendingTransfer[] {
      try {
        const principal = get(walletStore).principal?.toString();
        if (!principal) return [];
        
        const storageKey = `transfers_${principal}`;
        const storedData = localStorage.getItem(storageKey);
        
        if (storedData) {
          const data = BigIntUtils.parse(storedData);
          return data.pendingTransfers || [];
        }
        return [];
      } catch (err) {
        console.error('Failed to load pending transfers from localStorage:', err);
        return [];
      }
    },
    
    /**
     * Save vaults and pending transfers to local storage
     */
    saveToLocalStorage(vaults: EnhancedVault[], pendingTransfers: PendingTransfer[] = []): void {
      try {
        const principal = get(walletStore).principal?.toString();
        if (!principal) return;
        
        // Save vaults
        const vaultsStorageKey = `vaults_${principal}`;
        const vaultsData = {
          vaults,
          timestamp: Date.now()
        };
        localStorage.setItem(vaultsStorageKey, BigIntUtils.stringify(vaultsData));
        
        // Save pending transfers
        const transfersStorageKey = `transfers_${principal}`;
        const transfersData = {
          pendingTransfers,
          timestamp: Date.now()
        };
        localStorage.setItem(transfersStorageKey, BigIntUtils.stringify(transfersData));
      } catch (err) {
        console.error('Failed to save to localStorage:', err);
      }
    },
    
    /**
     * Load from local storage with pending transfers
     */
    loadFromLocalStorage(): boolean {
      try {
        const principal = get(walletStore).principal?.toString();
        if (!principal) return false;
        
        // Load pending transfers - we can simplify this
        const pendingTransfers = this.loadPendingTransfers();
        
        // Load vaults
        const cachedVaults = this.loadCachedVaults();
        
        // Update state based on what was loaded
        let hasData = false;
        
        if (cachedVaults.length > 0 || pendingTransfers.length > 0) {
          update(state => ({
            ...state,
            vaults: cachedVaults.length > 0 ? cachedVaults : state.vaults,
            pendingTransfers,
            lastUpdated: cachedVaults.length > 0 ? Date.now() : state.lastUpdated,
            error: cachedVaults.length > 0 ? null : state.error
          }));
          hasData = true;
        }
        
        return hasData;
      } catch (err) {
        console.error('Failed to load from localStorage:', err);
        return false;
      }
    },
    
    /**
     * Reset store state
     */
    reset() {
      set(DEFAULT_STATE);
      lastFetchTime = 0;
    }
  };
}

export const vaultStore = createVaultStore();
