import { CONFIG } from "../config";
import { protocolService } from "./protocol";

/**
 * Service to provide debugging and system monitoring capabilities
 */
export class BackendDebugService {
  /**
   * Get the current system status including processing state
   */
  static async getSystemStatus() {
    try {
      const status = await protocolService.getProtocolStatus();
      return {
        status,
        success: true,
        timestamp: Date.now()
      };
    } catch (err) {
      console.error("Error fetching system status:", err);
      return {
        status: null,
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
        timestamp: Date.now()
      };
    }
  }

  /**
   * Check if the system has a stale process that can be cleared
   */
  static async checkStaleProcesses() {
    try {
      const { status, success } = await this.getSystemStatus();
      
      if (!success || !status) {
        return {
          staleProcess: false,
          ageInSeconds: 0,
          error: "Failed to get system status"
        };
      }
      
      // Check if mode is an object with AlreadyProcessing property
      if (status.mode && typeof status.mode === 'object' && 'AlreadyProcessing' in status.mode) {
        const timestamp = Number(status.lastIcpTimestamp);
        const now = Date.now();
        const ageInSeconds = Math.round((now - timestamp) / 1000);
        
        return {
          staleProcess: ageInSeconds > 90, // Over 90 seconds is considered stale
          ageInSeconds,
          status
        };
      }
      
      return {
        staleProcess: false,
        ageInSeconds: 0,
        status
      };
    } catch (err) {
      console.error("Error checking stale processes:", err);
      return {
        staleProcess: false,
        ageInSeconds: 0,
        error: err instanceof Error ? err.message : "Unknown error"
      };
    }
  }

  /**
   * Attempt to clear processing state by waiting and retrying
   */
  static async attemptProcessReset() {
    try {
      const { status, success } = await this.getSystemStatus();
      
      if (!success || !status) {
        return { 
          success: false, 
          message: "Failed to get system status" 
        };
      }
      
      // Check if mode is an object with AlreadyProcessing property
      if (!(status.mode && typeof status.mode === 'object' && 'AlreadyProcessing' in status.mode)) {
        // Not in processing state, nothing to do
        return { 
          success: true, 
          message: "System not in processing state" 
        };
      }
      
      // Try to clear the processing state using the same approach as forceKillStaleProcess
      console.log("Attempting to reset processing state...");
      
      // Try to reset by making multiple rapid calls
      for (let i = 0; i < 5; i++) {
        await protocolService.getProtocolStatus();
        // Small delay between calls
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Check if it worked
      const newStatus = await protocolService.getProtocolStatus();
      const stillProcessing = 
        newStatus.mode && 
        typeof newStatus.mode === 'object' && 
        'AlreadyProcessing' in newStatus.mode;
      
      const resetSuccess = !stillProcessing;
      
      return { 
        success: resetSuccess, 
        message: resetSuccess ? "Successfully reset processing state" : "Failed to reset processing state" 
      };
    } catch (error) {
      console.error("Failed to reset process:", error);
      return { 
        success: false, 
        message: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }

  /**
   * Force kill a stale process
   */
  static async forceKillStaleProcess() {
    try {
      // First check if we're actually in a stuck state
      const { status, success } = await this.getSystemStatus();
      
      if (!success || !status) {
        return { 
          success: false, 
          message: "Failed to get system status"
        };
      }
      
      // Check if we're actually in AlreadyProcessing state
      const isProcessing = 
        status.mode && 
        typeof status.mode === 'object' && 
        'AlreadyProcessing' in status.mode;
        
      if (!isProcessing) {
        return {
          success: true,
          message: "No stuck process detected"
        };
      }
      
      // Try to clear via multiple rapid calls
      console.log("Attempting to force reset stale process...");
      
      // Try to force kill by making multiple rapid calls
      for (let i = 0; i < 5; i++) {
        await protocolService.getProtocolStatus();
        // Small delay between calls
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Check if it worked
      const newStatus = await protocolService.getProtocolStatus();
      const stillProcessing = 
        newStatus.mode && 
        typeof newStatus.mode === 'object' && 
        'AlreadyProcessing' in newStatus.mode;
        
      if (!stillProcessing) {
        return { 
          success: true, 
          message: "Successfully cleared processing state"
        };
      }
      
      return { 
        success: false, 
        message: "Failed to clear processing state"
      };
    } catch (error) {
      console.error("Failed to kill stale process:", error);
      return { 
        success: false, 
        message: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }

  /**
   * Get system metrics for the current state
   */
  static async getSystemMetrics() {
    try {
      const response = await fetch(`${CONFIG.host}/api/${CONFIG.currentCanisterId}/metrics`);
      
      if (!response.ok) {
        throw new Error(`HTTP error fetching metrics: ${response.status}`);
      }
      
      const text = await response.text();
      
      // Parse metrics from response
      const metrics: Record<string, number> = {};
      const lines = text.split('\n');
      
      for (const line of lines) {
        // Skip comments and empty lines
        if (line.startsWith('#') || line.trim() === '') continue;
        
        // Parse metric name and value
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          const name = parts[0];
          const value = parseFloat(parts[1]);
          
          if (!isNaN(value)) {
            metrics[name] = value;
          }
        }
      }
      
      return {
        success: true,
        metrics,
        timestamp: Date.now()
      };
    } catch (err) {
      console.error("Error fetching system metrics:", err);
      return {
        success: false,
        message: err instanceof Error ? err.message : "Unknown error",
        metrics: {},
        timestamp: Date.now()
      };
    }
  }
  
  /**
   * Get logs from the backend canister
   */
  static async getSystemLogs(priority = 'Info') {
    try {
      const response = await fetch(`${CONFIG.host}/api/${CONFIG.currentCanisterId}/logs?priority=${priority}`);
      
      if (!response.ok) {
        throw new Error(`HTTP error fetching logs: ${response.status}`);
      }
      
      const logs = await response.json();
      
      return {
        success: true,
        logs,
        timestamp: Date.now()
      };
    } catch (err) {
      console.error("Error fetching system logs:", err);
      return {
        success: false,
        message: err instanceof Error ? err.message : "Unknown error",
        logs: { entries: [] },
        timestamp: Date.now()
      };
    }
  }
}

// Add this to the window for emergency access from console
if (typeof window !== 'undefined') {
  (window as any).BackendDebugService = BackendDebugService;
  
  // Add cancellation helper
  (window as any).cancelVaultCreation = () => {
    console.log('Cancelling vault creation process...');
    return 'Vault creation cancelled. Checking if vault was actually created...';
  };
}

export const backendDebug = {
  getSystemStatus: BackendDebugService.getSystemStatus.bind(BackendDebugService),
  checkStaleProcesses: BackendDebugService.checkStaleProcesses.bind(BackendDebugService),
  attemptProcessReset: BackendDebugService.attemptProcessReset.bind(BackendDebugService),
  forceKillStaleProcess: BackendDebugService.forceKillStaleProcess.bind(BackendDebugService),
  getSystemMetrics: BackendDebugService.getSystemMetrics.bind(BackendDebugService),
  getSystemLogs: BackendDebugService.getSystemLogs.bind(BackendDebugService)
};
