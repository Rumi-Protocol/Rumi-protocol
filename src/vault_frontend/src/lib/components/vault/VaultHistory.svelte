<script lang="ts">
  import { onMount } from 'svelte';
  import { protocolService } from '$lib/services/protocol';
  import { formatNumber } from '$lib/utils/format';
  
  export let vaultId: number;
  
  let vaultEvents: Array<{ type: string, timestamp: string, details: string }> = [];
  let isLoading = true;
  let error = '';
  
  // Format event for display
  function formatEvent(event: any): { type: string, timestamp: string, details: string } {
    const getTimestamp = (ts: number) => {
      if (!ts) return 'Unknown';
      const date = new Date(Number(ts) / 1_000_000);
      return date.toLocaleString();
    };
    
    let type = 'Unknown Event';
    let timestamp = '';
    let details = '';
    
    // Parse event based on type
    if ('open_vault' in event) {
      type = 'Vault Opened';
      timestamp = getTimestamp(event.open_vault.block_index);
      const vault = event.open_vault.vault;
      details = `Initial margin: ${formatNumber(Number(vault.icp_margin_amount) / 100_000_000)} ICP`;
    } 
    else if ('add_margin_to_vault' in event) {
      type = 'Margin Added';
      timestamp = getTimestamp(event.add_margin_to_vault.block_index);
      details = `Added ${formatNumber(Number(event.add_margin_to_vault.margin_added) / 100_000_000)} ICP`;
    }
    else if ('borrow_from_vault' in event) {
      type = 'Borrowed icUSD';
      timestamp = getTimestamp(event.borrow_from_vault.block_index);
      const borrowed = Number(event.borrow_from_vault.borrowed_amount) / 100_000_000;
      const fee = Number(event.borrow_from_vault.fee_amount) / 100_000_000;
      details = `Borrowed ${formatNumber(borrowed)} icUSD (Fee: ${formatNumber(fee)} icUSD)`;
    }
    else if ('repay_to_vault' in event) {
      type = 'Repaid icUSD';
      timestamp = getTimestamp(event.repay_to_vault.block_index);
      details = `Repaid ${formatNumber(Number(event.repay_to_vault.repayed_amount) / 100_000_000)} icUSD`;
    }
    else if ('close_vault' in event) {
      type = 'Vault Closed';
      timestamp = event.close_vault.block_index ? 
        getTimestamp(event.close_vault.block_index[0]) : 'Unknown';
      details = 'Vault was closed and collateral returned';
    }
    else if ('liquidate_vault' in event) {
      type = 'Vault Liquidated';
      timestamp = 'Unknown'; // Liquidation events might not have timestamps
      const mode = event.liquidate_vault.mode;
      details = `Liquidated in ${mode} mode`;
    }
    
    return { type, timestamp, details };
  }

  // Load vault history
  async function loadVaultHistory() {
    isLoading = true;
    error = '';
    
    try {
      const events = await protocolService.getVaultHistory(vaultId);
      vaultEvents = events.map(formatEvent);
      
      // Sort events by timestamp (newest first)
      vaultEvents.sort((a, b) => {
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });
    } catch (err) {
      console.error('Error loading vault history:', err);
      error = 'Failed to load vault history';
    } finally {
      isLoading = false;
    }
  }
  
  onMount(loadVaultHistory);
</script>

<div class="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-5">
  <h2 class="text-xl font-semibold mb-4">Vault History</h2>
  
  {#if isLoading}
    <div class="flex justify-center p-8">
      <div class="w-6 h-6 border-3 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  {:else if error}
    <div class="p-4 bg-red-900/30 border border-red-800 rounded-lg text-red-200 text-sm">
      {error}
    </div>
  {:else if vaultEvents.length === 0}
    <div class="p-4 text-center text-gray-400">
      No events found for this vault
    </div>
  {:else}
    <div class="overflow-x-auto">
      <table class="min-w-full">
        <thead>
          <tr class="border-b border-gray-700">
            <th class="py-2 text-left text-gray-400 font-medium">Event</th>
            <th class="py-2 text-left text-gray-400 font-medium">Timestamp</th>
            <th class="py-2 text-left text-gray-400 font-medium">Details</th>
          </tr>
        </thead>
        <tbody>
          {#each vaultEvents as event}
            <tr class="border-b border-gray-800">
              <td class="py-3 text-white">{event.type}</td>
              <td class="py-3 text-gray-300">{event.timestamp}</td>
              <td class="py-3 text-gray-300">{event.details}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
