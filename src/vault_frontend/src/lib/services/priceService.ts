import { HttpAgent } from "@dfinity/agent";
import { writable } from 'svelte/store';
import { CONFIG } from '../config';
import { promiseWithTimeout } from '../utils/async';

/**
 * Store to track the latest ICP price
 */
export const currentIcpPriceStore = writable<{
  price: number | null;
  source: 'logs' | 'metrics' | 'protocol' | 'cached' | null;
  timestamp: number;
  error: string | null;
}>({
  price: null,
  source: null,
  timestamp: 0,
  error: null
});

/**
 * Service for fetching the current ICP price from different sources
 */
export class PriceServiceClass {
  // Cache price values for a short period
  private cachedPrice: number | null = null;
  private lastPriceUpdate: number = 0;
  private readonly CACHE_DURATION = 15000; // 15 seconds

  /**
   * Get the current ICP price from logs
   */
  async fetchPriceFromLogs(): Promise<number | null> {
    try {
      console.log("Fetching ICP price from logs...");
      
      // Try to get the price directly from the canister logs
      const response = await fetch(
        `${CONFIG.host}/api/${CONFIG.currentCanisterId}/logs?priority=TraceXrc`
      );
      
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }
      
      const text = await response.text();
      const matches = text.matchAll(/\[FetchPrice\] fetched new ICP rate: ([0-9.]+)/g);
      let latestPrice = null;
      
      for (const match of Array.from(matches)) {
        if (match && match[1]) {
          latestPrice = parseFloat(match[1]);
        }
      }
      
      if (latestPrice !== null && latestPrice > 0) {
        console.log('✓ Found ICP price in logs:', latestPrice);
        return latestPrice;
      }
      
      return null;
    } catch (err) {
      console.error('Error fetching price from logs:', err);
      return null;
    }
  }
  
  /**
   * Get the current ICP price from metrics
   */
  async fetchPriceFromMetrics(): Promise<number | null> {
    try {
      console.log("Fetching ICP price from metrics...");
      
      // Try metrics endpoint
      const response = await fetch(
        `${CONFIG.host}/api/${CONFIG.currentCanisterId}/metrics`
      );
      
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }
      
      const text = await response.text();
      const match = text.match(/rumi_icp_rate\s+([0-9.]+)/);
      
      if (match && match[1]) {
        const price = parseFloat(match[1]);
        if (price > 0) {
          console.log('✓ Found ICP price in metrics:', price);
          return price;
        }
      }
      
      return null;
    } catch (err) {
      console.error('Error fetching price from metrics:', err);
      return null;
    }
  }
  
  /**
   * Get the current ICP price using the best available source
   */
  async getCurrentIcpPrice(): Promise<number> {
    const now = Date.now();
    
    // Return cached price if it's recent
    if (this.cachedPrice !== null && now - this.lastPriceUpdate < this.CACHE_DURATION) {
      return this.cachedPrice;
    }
    
    try {
      // Try logs first (most recent data)
      const logsPrice = await promiseWithTimeout(
        this.fetchPriceFromLogs(),
        5000,
        'Logs price fetch timed out'
      );
      
      if (logsPrice !== null) {
        this.cachedPrice = logsPrice;
        this.lastPriceUpdate = now;
        return logsPrice;
      }
      
      // Try metrics next
      const metricsPrice = await promiseWithTimeout(
        this.fetchPriceFromMetrics(),
        5000,
        'Metrics price fetch timed out'
      );
      
      if (metricsPrice !== null) {
        this.cachedPrice = metricsPrice;
        this.lastPriceUpdate = now;
        return metricsPrice;
      }
      
      // If we reach here, we couldn't get a price from logs or metrics
      if (this.cachedPrice !== null) {
        // Return cached price even if old
        console.log('Using stale cached price:', this.cachedPrice);
        return this.cachedPrice;
      }
      
      // Default fallback price
      return 6.41; // Current ICP price as a fallback
    } catch (err) {
      console.error('Error getting current ICP price:', err);
      
      // Return cached price if available, otherwise fallback
      return this.cachedPrice !== null ? this.cachedPrice : 6.41;
    }
  }

  // Start auto-refresh of price
  startPriceRefresh(intervalMs: number = 30000) {
    this.getCurrentIcpPrice().catch(console.error);
    
    setInterval(() => {
      this.getCurrentIcpPrice().catch(console.error);
    }, intervalMs);
  }
}

// Export singleton instance
export const priceService = new PriceServiceClass();

// Auto-start price refreshing if in browser environment
if (typeof window !== 'undefined') {
  setTimeout(() => {
    priceService.startPriceRefresh();
  }, 1000);
}
