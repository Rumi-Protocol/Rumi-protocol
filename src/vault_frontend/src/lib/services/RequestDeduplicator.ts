/**
 * Global request deduplication system to eliminate redundant backend calls
 * This prevents multiple simultaneous calls to the same backend methods
 */
class RequestDeduplicator {
  private static pendingRequests: Map<string, Promise<any>> = new Map();
  
  /**
   * Deduplicate requests by caching pending promises
   */
  static async deduplicate<T>(key: string, requestFn: () => Promise<T>): Promise<T> {
    // If the same request is already pending, return the existing promise
    if (this.pendingRequests.has(key)) {
      console.log(`🔄 Deduplicating request: ${key}`);
      return this.pendingRequests.get(key);
    }
    
    // Create new request
    console.log(`🆕 New request: ${key}`);
    const promise = requestFn().finally(() => {
      // Clean up after request completes
      this.pendingRequests.delete(key);
    });
    
    this.pendingRequests.set(key, promise);
    return promise;
  }
  
  /**
   * Clear all pending requests (useful for wallet disconnection)
   */
  static clearAll(): void {
    this.pendingRequests.clear();
  }
}

export { RequestDeduplicator };