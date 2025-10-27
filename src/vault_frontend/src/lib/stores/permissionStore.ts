import { writable, get } from 'svelte/store';
import { walletStore } from './wallet';

interface PermissionState {
  // Common permissions
  canCreateVault: boolean;
  canViewVaults: boolean;
  canUseAdminTools: boolean;
  
  // User-specific roles
  isAdmin: boolean;
  isDeveloper: boolean;
  
  // Connection state
  initialized: boolean;
  error: string | null;
  lastChecked: number;
}

const DEFAULT_PERMISSIONS: PermissionState = {
  canCreateVault: false,
  canViewVaults: false,
  canUseAdminTools: false,
  isAdmin: false,
  isDeveloper: false,
  initialized: false,
  error: null,
  lastChecked: 0
};

function createPermissionStore() {
  // Internal state
  const { subscribe, set, update } = writable<PermissionState>(DEFAULT_PERMISSIONS);
  
  // Cache timeout (15 minutes)
  const CACHE_TIMEOUT = 15 * 60 * 1000;
  
  // Helper to check if permissions are still valid
  const isPermissionStale = () => {
    const state = get({ subscribe });
    return !state.initialized || (Date.now() - state.lastChecked) > CACHE_TIMEOUT;
  };
  
  // Helpers to save/load from sessionStorage
  const saveToSession = (state: PermissionState) => {
    try {
      sessionStorage.setItem('rumi-permissions', JSON.stringify(state));
    } catch (err) {
      console.warn('Could not save permissions to session storage:', err);
    }
  };
  
  const loadFromSession = (): PermissionState | null => {
    try {
      const saved = sessionStorage.getItem('rumi-permissions');
      if (saved) {
        const parsed = JSON.parse(saved) as PermissionState;
        // Only return if not stale
        if (Date.now() - parsed.lastChecked <= CACHE_TIMEOUT) {
          return parsed;
        }
      }
    } catch (err) {
      console.warn('Could not load permissions from session storage:', err);
    }
    return null;
  };

  return {
    subscribe,
    
    // Initialize permissions - call this on app startup
    async init() {
      try {
        console.log('Starting permission initialization...');
        
        // Try to load from session first
        const sessionPerms = loadFromSession();
        if (sessionPerms) {
          set(sessionPerms);
          console.log('Loaded permissions from session cache');
          return true;
        }
        
        // FIXED: Removed circular dependency - don't call walletStore during init
        // Instead, permissions are set when wallet connects and layout calls this
        
        // Set default permissions for any connected user
        console.log('Setting default permissions for connected user');
        const isDev = sessionStorage.getItem('rumi-dev-access') === 'true';
        
        const permissions: PermissionState = {
          // Basic permissions for any connected wallet - no backend calls needed
          canCreateVault: true,
          canViewVaults: true, // Allow viewing vaults for all connected users
          canUseAdminTools: isDev,
          // Roles
          isAdmin: false,
          isDeveloper: isDev,
          // Status
          initialized: true,
          error: null,
          lastChecked: Date.now()
        };
        
        set(permissions);
        saveToSession(permissions);
        
        console.log('Permissions initialized successfully:', permissions);
        return true;
        
      } catch (error) {
        console.error('Permission initialization failed:', error);
        const errorState = {
          ...DEFAULT_PERMISSIONS,
          initialized: true,
          error: error instanceof Error ? error.message : 'Failed to initialize permissions',
          lastChecked: Date.now()
        };
        set(errorState);
        return false;
      }
    },
    
    // Refresh permissions from the backend
    async refresh() {
      const walletState = get(walletStore);
      
      if (!walletState.isConnected || !walletState.principal) {
        update(state => ({
          ...DEFAULT_PERMISSIONS,
          error: 'Wallet not connected',
          lastChecked: Date.now()
        }));
        return false;
      }
      
      try {
        // Use the developerAccess store to check if developer mode is enabled
        const isDev = sessionStorage.getItem('rumi-dev-access') === 'true';
        // In a real app, you'd check this from the backend canister
        // const isAdmin = await backend.checkIsAdmin(walletState.principal);
        const isAdmin = false; // Default for now
        
        const permissions: PermissionState = {
          // Basic permissions that any connected wallet has
          canCreateVault: true,
          // More granular permissions that might depend on user role
          canViewVaults: isDev || isAdmin,
          canUseAdminTools: isAdmin,
          // Roles
          isAdmin: isAdmin,
          isDeveloper: isDev,
          // Status
          initialized: true,
          error: null,
          lastChecked: Date.now()
        };
        
        set(permissions);
        saveToSession(permissions);
        
        console.log('Permissions updated:', permissions);
        return true;
      } catch (error) {
        console.error('Failed to initialize permissions:', error);
        update(state => ({
          ...state,
          error: error instanceof Error ? error.message : 'Unknown error initializing permissions',
          lastChecked: Date.now()
        }));
        return false;
      }
    },
    
    // Check if a specific permission is granted
    hasPermission(permission: keyof PermissionState): boolean {
      const state = get({ subscribe });
      
      // Re-check permissions if stale, but return current value immediately
      if (isPermissionStale()) {
        console.log('Permissions stale, refreshing in background');
        this.refresh().catch(err => console.error('Background permission refresh failed', err));
      }
      
      // Return the requested permission state
      return state[permission] as boolean;
    },
    
    // Grant a specific permission (for testing/development)
    grantPermission(permission: keyof PermissionState) {
      update(state => {
        const newState = { ...state, [permission]: true };
        saveToSession(newState);
        return newState;
      });
    },
    
    // Clear all permissions (e.g. on logout)
    clear() {
      set(DEFAULT_PERMISSIONS);
      try {
        sessionStorage.removeItem('rumi-permissions');
      } catch (err) {
        console.warn('Failed to clear permission cache:', err);
      }
    }
  };
}

export const permissionStore = createPermissionStore();

// REMOVED: Automatic initialization that causes circular dependency
// Instead, initialization will be handled explicitly in the layout component
