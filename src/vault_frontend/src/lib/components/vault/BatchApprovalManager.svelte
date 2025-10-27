<script lang="ts">
  import { onMount } from 'svelte';
  import { streamlinedPermissions } from '../../services/StreamlinedPermissions';
  import { walletStore } from '../../stores/wallet';
  import { selectedWalletId } from '../../services/auth';
  import { get } from 'svelte/store';

  // Props
  export let showBatchApproval = false;
  export let onBatchApprovalComplete: ((success: boolean) => void) | undefined = undefined;

  // Component state
  let isReady = false;
  let currentWalletId = '';

  // Subscribe to wallet changes
  $: {
    const wallet = get(walletStore);
    const walletId = get(selectedWalletId);
    currentWalletId = walletId || '';
    
    // Check if permissions are ready
    isReady = streamlinedPermissions.isReady();
  }

  onMount(() => {
    // Auto-activate permissions when component mounts
    if (showBatchApproval && currentWalletId) {
      streamlinedPermissions.activate();
      if (onBatchApprovalComplete) {
        onBatchApprovalComplete(true);
      }
    }
  });
</script>

{#if showBatchApproval}
  <div class="batch-approval-card">
    {#if isReady}
      <div class="mb-4">
        <div class="flex items-center gap-2 mb-3">
          <svg class="w-5 h-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path>
          </svg>
          <h3 class="text-lg font-semibold text-green-400">Ready for Operations</h3>
        </div>
        
        <div class="bg-green-900/20 border border-green-500/30 rounded-lg p-3">
          <p class="text-green-300 text-sm">
            ✓ All vault operations will proceed seamlessly without additional wallet pop-ups
          </p>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .batch-approval-card {
    background: linear-gradient(135deg, #1f2937 0%, #374151 100%);
    border: 1px solid #4b5563;
    border-radius: 12px;
    padding: 1.5rem;
    margin-bottom: 1rem;
  }
</style>