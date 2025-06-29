import { ApiClient, E8S } from './apiClient';
import type { FeesInfo, ProtocolStatus, FeesDTO, ProtocolStatusDTO } from '../types';
import type {
    ProtocolStatus as CanisterProtocolStatus,
    Fees
  } from '../../../../../declarations/rumi_protocol_backend/rumi_protocol_backend.did';
import { CONFIG } from '../../config';

/**
 * Operations focused on querying protocol data
 */
export class QueryOperations {
  /**
   * Get the current protocol status
   */
  static async getProtocolStatus(): Promise<ProtocolStatusDTO> {
    try {
      const canisterStatus = await ApiClient.getPublicData<CanisterProtocolStatus>('get_protocol_status');
      
      return {
        mode: canisterStatus.mode,
        totalIcpMargin: Number(canisterStatus.total_icp_margin) / E8S,
        totalIcusdBorrowed: Number(canisterStatus.total_icusd_borrowed) / E8S,
        lastIcpRate: Number(canisterStatus.last_icp_rate),
        lastIcpTimestamp: Number(canisterStatus.last_icp_timestamp),
        totalCollateralRatio: Number(canisterStatus.total_collateral_ratio)
      };
    } catch (err) {
      console.error('Failed to get protocol status:', err);
      throw new Error('Failed to get protocol status');
    }
  }

  /**
   * Get the current ICP price - SIMPLIFIED to directly use protocol status
   */
  static async getICPPrice(): Promise<number> {
    try {
      const status = await ApiClient.getPublicData<CanisterProtocolStatus>('get_protocol_status');
      console.log('Raw protocol status:', status); 
      const rate = Number(status.last_icp_rate);
      console.log('Converted ICP rate:', rate); 
      return rate;
    } catch (err) {
      console.error("Failed to fetch ICP price:", err);
      throw new Error("Could not fetch ICP price");
    }
  }

  // Add a method to get the real price from logs even in mock mode
  static async getRealICPPrice(): Promise<number> {
    try {
      // First try logs approach
      const priceFromLogs = await this.getRealIcpPriceFromLogs();
      if (priceFromLogs !== null) {
        return priceFromLogs;
      }
      
      // Then try metrics endpoint
      const metricsResponse = await fetch(`${CONFIG.host}/api/${CONFIG.currentCanisterId}/metrics`);
      if (metricsResponse.ok) {
        const metricsText = await metricsResponse.text();
        const metricsMatch = metricsText.match(/rumi_icp_rate\s+([0-9.]+)/);
        
        if (metricsMatch && metricsMatch[1]) {
          const price = parseFloat(metricsMatch[1]);
          console.log('Found ICP price in metrics:', price);
          return price;
        }
      }
      
      // Default fallback price
      return 6.41;
    } catch (err) {
      console.error('Error fetching real ICP price:', err);
      return 6.41; // Default fallback value
    }
  }

  /**
   * Method to get real ICP price from logs
   */
  private static async getRealIcpPriceFromLogs(): Promise<number | null> {
    try {
      // Try to get the price directly from the canister logs
      const response = await fetch(`${CONFIG.host}/api/${CONFIG.currentCanisterId}/logs?priority=TraceXrc`);
      
      if (response.ok) {
        const text = await response.text();
        const matches = text.matchAll(/\[FetchPrice\] fetched new ICP rate: ([0-9.]+)/g);
        let latestPrice = null;
        
        for (const match of Array.from(matches)) {
          if (match && match[1]) {
            latestPrice = parseFloat(match[1]);
          }
        }
        
        if (latestPrice !== null) {
          console.log('Found live ICP price in logs:', latestPrice);
          return latestPrice;
        }
      }
      return null;
    } catch (err) {
      console.error('Error fetching ICP price from logs:', err);
      return null;
    }
  }

  /**
   * Get current fee rates
   */
  static async getFees(amount: number): Promise<FeesDTO> {
    try {
      const amountBigInt = BigInt(Math.round(amount * E8S));
      const fees = await ApiClient.getPublicData<Fees>('get_fees', amountBigInt);
      
      return {
        borrowingFee: Number(fees.borrowing_fee),
        redemptionFee: Number(fees.redemption_fee)
      };
    } catch (err) {
      console.error('Failed to get fees:', err);
      return {
        borrowingFee: 0.005, // 0.5%
        redemptionFee: 0.001 // 0.1%
      };
    }
  }

  /**
   * Get pending transfers
   * Note: The backend doesn't have a dedicated endpoint for this yet
   */
  static async getPendingTransfers(): Promise<any[]> {
    try {
      // This is a placeholder for when the backend adds this endpoint
      return [];
    } catch (err) {
      console.error('Error getting pending transfers:', err);
      return [];
    }
  }

  /**
   * Check if an error is an AlreadyProcessing error
   */
  public static isAlreadyProcessingError(error: any): boolean {
    return error && (
      ('AlreadyProcessing' in error) || 
      (error instanceof Error && error.message.toLowerCase().includes('already has an ongoing operation')) ||
      (error instanceof Error && error.message.toLowerCase().includes('operation in progress'))
    );
  }

  /**
   * Check if an error is for a stale processing state
   */
  public static isStaleProcessingState(error: any, timeThresholdSeconds: number = 90): boolean {
    // Add implementation to check if the processing state is stale based on timestamp
    if (error && typeof error === 'object' && 'timestamp' in error) {
      const timestampMs = Number(error.timestamp);
      if (!isNaN(timestampMs)) {
        const ageMs = Date.now() - timestampMs;
        return ageMs > timeThresholdSeconds * 1000;
      }
    }
    
    // Also check error message for clues
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('stale') || msg.includes('previous operation is being cleaned up')) {
        return true;
      }
    }
    
    return false;
  }
}

