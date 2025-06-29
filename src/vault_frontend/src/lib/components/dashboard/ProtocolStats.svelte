<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { protocolService } from '$lib/services/protocol';
  import { formatNumber } from '$lib/utils/format';
  
  let protocolStatus = {
    mode: 'GeneralAvailability',
    totalIcpMargin: 0,
    totalIcusdBorrowed: 0,
    lastIcpRate: 0,
    lastIcpTimestamp: 0,
    totalCollateralRatio: 0
  };
  
  let isLoading = true;
  let formattedTimestamp = '';
  let refreshInterval: NodeJS.Timeout;
  
  // Function to fetch protocol status including live price
  async function fetchProtocolStatus() {
    isLoading = true;
    try {
      // Get protocol status with real price from logs
      const status = await protocolService.getProtocolStatus();
      console.log('Protocol status with live price:', status);
      
      protocolStatus = {
        mode: status.mode || 'GeneralAvailability',
        totalIcpMargin: Number(status.totalIcpMargin || 0),
        totalIcusdBorrowed: Number(status.totalIcusdBorrowed || 0),
        lastIcpRate: Number(status.lastIcpRate || 0),
        lastIcpTimestamp: Number(status.lastIcpTimestamp || 0),
        totalCollateralRatio: Number(status.totalCollateralRatio || 0)
      };
      
      updateTimestamp();
    } catch (error) {
      console.error('Error fetching protocol status:', error);
    } finally {
      isLoading = false;
    }
  }
  
  function updateTimestamp() {
    if (protocolStatus.lastIcpTimestamp) {
      const date = new Date(protocolStatus.lastIcpTimestamp);
      formattedTimestamp = date.toLocaleString();
    } else {
      formattedTimestamp = 'Unknown';
    }
  }
  
  onMount(() => {
    // Initial fetch
    fetchProtocolStatus();
    
    // Refresh every 15 seconds to get the latest price
    refreshInterval = setInterval(fetchProtocolStatus, 15000);
    
    return () => {
      if (refreshInterval) clearInterval(refreshInterval);
    };
  });
  
  onDestroy(() => {
    if (refreshInterval) clearInterval(refreshInterval);
  });
  
  $: icpValueInUsd = protocolStatus.totalIcpMargin * protocolStatus.lastIcpRate;
  $: collateralPercent = protocolStatus.totalIcusdBorrowed > 0
    ? protocolStatus.totalCollateralRatio * 100
    : protocolStatus.totalIcpMargin > 0 
      ? Infinity 
      : 0;

  // Create a formatted version for display
  $: formattedCollateralPercent = collateralPercent === Infinity 
    ? '∞'
    : collateralPercent > 1000000
      ? '>1,000,000'
      : formatNumber(collateralPercent);

  $: modeDisplay = {
    'ReadOnly': 'Read Only',
    'GeneralAvailability': 'General Availability',
    'Recovery': 'Recovery Mode'
  }[protocolStatus.mode] || 'Unknown Mode';
  
  $: modeColor = {
    'ReadOnly': 'text-yellow-500',
    'GeneralAvailability': 'text-green-500',
    'Recovery': 'text-orange-500'
  }[protocolStatus.mode] || 'text-gray-500';
</script>

<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
  <div class="stat-card">
    <div class="text-sm text-gray-400">Total Collateral (ICP)</div>
    <div class="text-xl font-bold">{formatNumber(protocolStatus.totalIcpMargin)} ICP</div>
    <div class="text-sm text-gray-400">≈ ${formatNumber(icpValueInUsd)}</div>
  </div>
  
  <div class="stat-card">
    <div class="text-sm text-gray-400">Total icUSD Borrowed</div>
    <div class="text-xl font-bold">{formatNumber(protocolStatus.totalIcusdBorrowed)} icUSD</div>
  </div>
  
  <div class="stat-card">
    <div class="text-sm text-gray-400">Current ICP Price</div>
    <div class="text-xl font-bold">
      {#if isLoading}
        <div class="animate-pulse bg-gray-700 h-6 w-24 rounded"></div>
      {:else}
        ${formatNumber(protocolStatus.lastIcpRate)}
      {/if}
    </div>
  </div>
  
  <div class="stat-card">
    <div class="text-sm text-gray-400">Total Collateral Ratio</div>
    <div class="text-xl font-bold">{formattedCollateralPercent}%</div>
  </div>
</div>

<style>
  .stat-card {
    @apply bg-gray-800/60 backdrop-blur-lg p-4 rounded-lg border border-gray-700;
  }
</style>