import { writable } from 'svelte/store';

function createDeveloperAccessStore() {
  const { subscribe, set } = writable(false);
  
  // Developer passkey - in production this would be a more secure mechanism
  const validPasskeys = ['rumi-dev8', 'rumi-admin8'];
  
  return {
    subscribe,
    
    checkPasskey(passkey: string): boolean {
      const isValid = validPasskeys.includes(passkey);
      
      if (isValid) {
        set(true);
        
        // Store in session storage so it persists during the session
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem('rumi-dev-access', 'true');
        }
      }
      
      return isValid;
    },
    
    // Check if developer access is stored in session
    checkStoredAccess(): boolean {
      if (typeof sessionStorage !== 'undefined') {
        const hasAccess = sessionStorage.getItem('rumi-dev-access') === 'true';
        
        if (hasAccess) {
          set(true);
        }
        
        return hasAccess;
      }
      
      return false;
    },
    
    // Clear developer access
    clearAccess() {
      set(false);
      
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('rumi-dev-access');
      }
    }
  };
}

export const developerAccess = createDeveloperAccessStore();

// Check for stored access on module initialization
if (typeof window !== 'undefined') {
  setTimeout(() => {
    developerAccess.checkStoredAccess();
  }, 0);
}
