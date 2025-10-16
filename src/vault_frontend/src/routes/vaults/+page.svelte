<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { appDataStore, userVaults, isLoadingVaults, walletConnected } from '$lib/stores/appDataStore';
  import { walletStore, isConnected, principal } from '$lib/stores/wallet';
  import { permissionStore } from '$lib/stores/permissionStore';
  import VaultCard from '$lib/components/vault/VaultCard.svelte';
  import BatchApprovalManager from '$lib/components/vault/BatchApprovalManager.svelte';
  import { selectedWalletId } from '$lib/services/auth';
  import { isDevelopment } from '$lib/config';
  import { developerAccess } from '$lib/stores/developer';
  import { get } from 'svelte/store';

  let showBatchApproval = false;
  let icpPrice = 0;
  
  // Simple reactive derived value for vault access - include developer access
  $: canViewVaults = isDevelopment || $developerAccess || $isConnected || ($permissionStore.initialized && $permissionStore.canViewVaults);
  
  // Debug logging
  $: if (typeof canViewVaults !== 'undefined') {
    console.log('🔍 Vault access check:', {
      isDevelopment,
      developerAccess: $developerAccess,
      isConnected: $isConnected,
      permissionStoreInitialized: $permissionStore.initialized,
      permissionStoreCanViewVaults: $permissionStore.canViewVaults,
      finalCanViewVaults: canViewVaults
    });
  }

  // Auto-load data when wallet connects
  $: if ($isConnected && $principal && !$isLoadingVaults) {
    console.log('🚀 Wallet connected - loading user vaults...');
    loadUserVaults();
  }

  async function loadUserVaults() {
    if (!$principal) {
      console.warn('No principal available for loading vaults');
      return;
    }

    try {
      // Load protocol status for price info
      const protocolStatus = await appDataStore.fetchProtocolStatus();
      if (protocolStatus) {
        icpPrice = protocolStatus.lastIcpRate;
      }
      
      // Load user vaults
      await appDataStore.fetchUserVaults($principal);
    } catch (error) {
      console.error('Error loading user vaults:', error);
    }
  }

  // Check if user should see batch approval
  $: {
    const walletId = get(selectedWalletId);
    showBatchApproval = walletId === 'plug' && ($userVaults.length > 0 || $isConnected);
  }

  onMount(() => {
    console.log('🚀 Vaults page mounted');
    // Data loading is handled by reactive statements when wallet state changes
  });
</script>

<div class="max-w-4xl mx-auto p-6">
  {#if !canViewVaults}
    <!-- Developer Access Required Section -->
    <div class="bg-gray-900/50 p-6 rounded-lg shadow-lg backdrop-blur-sm border border-purple-500/30 mb-8">
      <div class="flex items-center gap-2 mb-4">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        <h2 class="text-2xl font-semibold">Developer Access Required</h2>
      </div>
      
      <p class="text-gray-300 mb-6">
        The vaults feature is currently in development. Please enter your developer passkey to continue.
      </p>
    </div>
  {:else}
    <!-- ICP Price Display -->
    <div class="mb-8 bg-gray-900/50 p-6 rounded-lg shadow-lg backdrop-blur-sm ring-2 ring-purple-400">
      <div class="flex justify-between items-center mb-2">
        <h2 class="text-2xl font-bold">Current ICP Price</h2>
        <div class="bg-purple-900/30 px-3 py-1 rounded-full text-xs text-purple-300 flex items-center gap-2">
          <span class="w-2 h-2 bg-purple-400 rounded-full animate-pulse"></span>
          Developer Mode
        </div>
      </div>
      
      {#if $isLoadingVaults && !icpPrice}
        <div class="flex items-center gap-2">
          <div class="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
          <span>Loading price...</span>
        </div>
      {:else}
        <p class="text-xl">${icpPrice.toFixed(2)} USD</p>
      {/if}
    </div>

    <!-- Vaults Section -->
    <div class="mb-10">
      <div class="flex justify-between items-center">
        <div>
          <h1 class="text-3xl font-bold mb-2 mt-8">My Vaults</h1>
          <p class="text-gray-400">Manage your collateral and mint icUSD</p>
        </div>
        
        {#if $isConnected}
          <button 
            on:click={() => loadUserVaults()}
            class="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-md text-sm"
            disabled={$isLoadingVaults}
          >
            {$isLoadingVaults ? 'Refreshing...' : 'Refresh'}
          </button>
        {/if}
      </div>
    </div>

    <!-- Display content based on connection status and data -->
    {#if !$isConnected}
      <div class="text-center p-12 bg-gray-900/50 rounded-lg backdrop-blur-sm">
        <p class="text-xl text-gray-300 mb-4">Please connect your wallet to view your vaults</p>
        <button 
          on:click={() => walletStore.connect('plug')}
          class="inline-block px-6 py-3 bg-purple-600 rounded-lg hover:bg-purple-500"
        >
          Connect Wallet
        </button>
      </div>
    {:else if $isLoadingVaults && $userVaults.length === 0}
      <div class="flex justify-center p-12">
        <div class="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    {:else if $userVaults.length === 0}
      <div class="text-center p-12 bg-gray-900/50 rounded-lg backdrop-blur-sm">
        <p class="text-xl text-gray-300 mb-4">You don't have any vaults yet</p>
        <a 
          href="/"
          class="inline-block px-6 py-3 bg-purple-600 rounded-lg hover:bg-purple-500"
        >
          Create Your First Vault
        </a>
      </div>
    {:else}
      <!-- Display vaults list when we have vaults -->
      <div class="space-y-6">
        {#each $userVaults as vault (vault.vaultId)}
          <VaultCard {vault} {icpPrice} on:select={(event) => goto(`/vaults/${event.detail.vaultId}`)} />
        {/each}
      </div>
    {/if}

    <!-- Status indicator for debugging -->
    <div class="mt-6 text-xs text-gray-500">
      <p>Status: {$isConnected ? 'Connected' : 'Not connected'} | 
         Principal: {$principal || 'None'} | 
         Vaults: {$userVaults.length}</p>
    </div>
  {/if}
</div>