<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { protocolService } from '$lib/services/protocol';
  import { formatNumber } from '$lib/utils/format';
  import { ApiClient } from '$lib/services/protocol/apiClient';
  
  export let vaultId: number;
  export let icpAmount: number;
  
  let phase = 'prepare'; // 'prepare', 'confirm', 'processing', 'completed', 'failed'
  let prepareTxHash: string | null = null;
  let transferTxHash: string | null = null;
  let error: string | null = null;
  
  const dispatch = createEventDispatcher();
  
  async function prepareClose() {
    try {
      phase = 'processing';
      error = null;
      
      const result = await ApiClient.prepareCloseVault(vaultId);
      if (result.success) {
        phase = 'confirm';
        prepareTxHash = result.txHash || null;
      } else {
        phase = 'failed';
        error = result.error || 'Failed to prepare vault closure';
      }
    } catch (err) {
      phase = 'failed';
      error = err instanceof Error ? err.message : 'Unknown error occurred';
    }
  }
  
  async function confirmAndTransfer() {
    try {
      phase = 'processing';
      error = null;
      
      const result = await ApiClient.executeTransferAndClose(vaultId);
      if (result.success) {
        phase = 'completed';
        transferTxHash = result.txHash || null;
        dispatch('closed', { vaultId });
      } else {
        phase = 'failed';
        error = result.error || 'Failed to complete the transfer';
      }
    } catch (err) {
      phase = 'failed';
      error = err instanceof Error ? err.message : 'Unknown error occurred';
    }
  }
</script>

<div class="bg-gray-800/60 p-6 rounded-lg border border-gray-700">
  <h3 class="text-xl font-bold mb-4">Close Vault #{vaultId}</h3>
  
  <div class="mb-6">
    <div class="w-full bg-gray-700 rounded-full h-1.5">
      <div class="bg-purple-600 h-1.5 rounded-full" style="width: {phase === 'prepare' ? '25%' : phase === 'confirm' ? '50%' : phase === 'processing' ? '75%' : '100%'};"></div>
    </div>
  </div>
  
  {#if phase === 'prepare'}
    <div class="mb-6">
      <p class="mb-4">
        You are about to close vault #{vaultId} and retrieve {formatNumber(icpAmount)} ICP.
      </p>
      <p class="text-amber-300 mb-4">
        To ensure your ICP is safely returned, this process will happen in two steps:
      </p>
      <ol class="list-decimal pl-5 space-y-2 text-gray-300">
        <li>First, prepare your vault for closure (locks the vault)</li>
        <li>Then, confirm to initiate the ICP transfer to your wallet</li>
      </ol>
    </div>
    
    <button
      class="w-full py-3 bg-purple-600 hover:bg-purple-500 rounded-lg text-white font-medium"
      on:click={prepareClose}
    >
      Step 1: Prepare to Close Vault
    </button>
  {:else if phase === 'confirm'}
    <div class="mb-6">
      <p class="text-green-400 mb-2">
        Step 1 Complete! Vault is prepared for closure.
      </p>
      <p class="text-sm text-gray-400 mb-4">
        Transaction Hash: {prepareTxHash || 'Processing...'}
      </p>
      <p class="mb-4">
        Now, execute the transfer to send {formatNumber(icpAmount)} ICP to your wallet.
      </p>
      <p class="text-amber-300 text-sm">
        Note: This step will close the vault permanently and initiate the ICP transfer.
      </p>
    </div>
    
    <button
      class="w-full py-3 bg-green-600 hover:bg-green-500 rounded-lg text-white font-medium"
      on:click={confirmAndTransfer}
    >
      Step 2: Transfer ICP and Close Vault
    </button>
  {:else if phase === 'processing'}
    <div class="flex justify-center py-8">
      <div class="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
    <p class="text-center text-gray-300">Processing your request...</p>
  {:else if phase === 'completed'}
    <div class="text-center py-6">
      <svg class="w-16 h-16 mx-auto text-green-500 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
      </svg>
      <h4 class="text-xl font-bold text-green-400 mb-2">Vault Successfully Closed!</h4>
      <p class="mb-4">Your {formatNumber(icpAmount)} ICP has been transferred to your wallet.</p>
      <p class="text-sm text-gray-400">
        Transaction Hash: {transferTxHash || 'Processing...'}
      </p>
    </div>
  {:else if phase === 'failed'}
    <div class="text-center py-6">
      <svg class="w-16 h-16 mx-auto text-red-500 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
      </svg>
      <h4 class="text-xl font-bold text-red-400 mb-2">Error</h4>
      <p class="mb-4 text-red-300">{error}</p>
      <button
        class="px-6 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-white"
        on:click={() => phase = 'prepare'}
      >
        Try Again
      </button>
    </div>
  {/if}
</div>
