<script lang="ts">
  import { onMount } from 'svelte';
  import { priceService } from '$lib/services/priceService';
  import { protocolService } from '$lib/services/protocol';
  
  let directPrice: number | null = null;
  let statusPrice: number | null = null;
  let loading = false;
  let error = '';
  
  async function checkPrices() {
    loading = true;
    error = '';
    try {
      // Get price from logs/metrics
      directPrice = await priceService.getCurrentIcpPrice();
      
      // Get price from protocol status
      const status = await protocolService.getProtocolStatus();
      statusPrice = status.lastIcpRate;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error fetching prices';
    } finally {
      loading = false;
    }
  }
  
  onMount(() => {
    checkPrices();
  });
</script>

<div class="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
  <h3 class="text-lg font-medium mb-4">ICP Price Diagnostics</h3>
  
  {#if loading}
    <div class="flex justify-center py-4">
      <div class="animate-spin h-6 w-6 border-2 border-purple-500 rounded-full border-t-transparent"></div>
    </div>
  {:else}
    <div class="space-y-3">
      <div>
        <div class="text-sm text-gray-400 mb-1">Direct Price (from logs/metrics)</div>
        <div class="text-xl font-bold">${directPrice !== null ? directPrice.toFixed(3) : 'N/A'}</div>
      </div>
      
      <div>
        <div class="text-sm text-gray-400 mb-1">Status Price (from protocol)</div>
        <div class="text-xl font-bold">${statusPrice !== null ? statusPrice.toFixed(3) : 'N/A'}</div>
      </div>
      
      {#if directPrice !== null && statusPrice !== null && Math.abs(directPrice - statusPrice) > 0.1}
        <div class="p-3 bg-yellow-900/30 border border-yellow-800 rounded-lg text-yellow-200 text-sm">
          Warning: Price discrepancy detected! The direct price and status price differ by 
          ${Math.abs(directPrice - statusPrice).toFixed(3)}.
        </div>
      {/if}
    </div>
    
    {#if error}
      <div class="p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-200 text-sm mt-3">
        {error}
      </div>
    {/if}
    
    <button
      class="mt-4 px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded text-white"
      on:click={checkPrices}
    >
      Refresh Prices
    </button>
  {/if}
</div>
