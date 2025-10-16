import { permissionManager } from './PermissionManager';
import { browser } from '$app/environment';

/**
 * Streamlined Permissions Service
 * Provides a simple interface for batch operations and permission management
 */
class StreamlinedPermissions {
  private ready = false;
  private activating = false;

  /**
   * Check if permissions are ready for use
   */
  isReady(): boolean {
    return this.ready && permissionManager.hasPermissions();
  }

  /**
   * Activate permissions - ensures all necessary permissions are granted
   */
  async activate(): Promise<boolean> {
    if (!browser) return false;
    
    if (this.activating) return this.ready;
    
    this.activating = true;
    
    try {
      // FIXED: No longer explicitly request permissions - they're handled at connection
      // Just check if we have a valid session instead
      const hasValidSession = permissionManager.hasPermissions();
      this.ready = hasValidSession;
      return hasValidSession;
    } catch (error) {
      console.error('Failed to activate streamlined permissions:', error);
      this.ready = false;
      return false;
    } finally {
      this.activating = false;
    }
  }

  /**
   * Deactivate permissions and clear state
   */
  deactivate(): void {
    this.ready = false;
    permissionManager.clearCache();
  }

  /**
   * Check if currently activating permissions
   */
  isActivating(): boolean {
    return this.activating;
  }

  /**
   * Reset the service state
   */
  reset(): void {
    this.ready = false;
    this.activating = false;
    permissionManager.clearCache();
  }
}

// Export singleton instance
export const streamlinedPermissions = new StreamlinedPermissions();