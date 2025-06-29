<script lang="ts">
  import { onMount } from 'svelte';
  import { protocolService } from '$lib/services/protocol';
  import { formatNumber } from '$lib/utils/format';
  
  let icpPrice = 0;
  let priceSource = 'Loading...';
  let loading = true;
  let refreshTime = '';
  
  async function fetchPrice() {
    loading = true;
    try {
      // Try to fetch the price
      const price = await protocolService.getICPPrice();
      icpPrice = price;
      
      // Get the full status to check the price source
      const status = await protocolService.getProtocolStatus();
      
      // Determine the price source
      if (icpPrice !== status.lastIcpRate) {
        priceSource = 'Live price from logs';
      } else {
        priceSource = 'Protocol status API';
      }
      
      // Format timestamp
      refreshTime = new Date().toLocaleTimeString();
    } catch (err) {
      console.error('Failed to fetch ICP price:', err);
      priceSource = 'Error fetching price';
    } finally {
      loading = false;
    }
  }
  
  onMount(() => {
    fetchPrice();
    // Set up periodic refresh
    const interval = setInterval(fetchPrice, 30000);
    
    return () => {
      clearInterval(interval);
    };
  });
</script>

<div class="mt-4 p-2 bg-gray-800/30 rounded-lg text-sm">
  <h3 class="text-gray-300 mb-1">ICP Price Debug</h3>
  <div class="flex items-center gap-2">
    <span class="text-gray-400">Current Price:</span>
    {#if loading}
      <div class="w-16 h-4 bg-gray-700 animate-pulse rounded"></div>
    {:else}
      <span class="font-medium">${formatNumber(icpPrice)}</span>
    {/if}
  </div>
  <div class="flex items-center gap-2">
    <span class="text-gray-400">Source:</span>
    <span class="font-medium">{priceSource}</span>
  </div>
  <div class="text-xs text-gray-500 mt-1">
    Last refresh: {refreshTime}
    <button 
      class="ml-2 text-purple-400 hover:text-purple-300"
      on:click={fetchPrice}
    >
      Refresh
    </button>
  </div>
</div>
