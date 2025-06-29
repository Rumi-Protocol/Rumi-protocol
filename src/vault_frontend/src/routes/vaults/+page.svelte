<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { walletStore } from '$lib/stores/wallet';
  import { protocolService } from '$lib/services/protocol';
  import { vaultStore, type EnhancedVault } from '$lib/stores/vaultStore';
  import { permissionStore } from '$lib/stores/permissionStore';
  import { isDevelopment } from '$lib/config';
  import VaultCard from '$lib/components/vault/VaultCard.svelte';
  import ProtocolStats from '$lib/components/dashboard/ProtocolStats.svelte';
  
  // Define proper types for state variables
  let isLoading = $vaultStore.isLoading;
  let icpPrice = 0;
  let loadError = $vaultStore.error;
  let showPasskeyInput = false;
  let passkey = '';
  let passkeyError = '';
  
  // Reactive declarations with proper typing
  $: canViewVaults = $permissionStore.canViewVaults;
  $: isDeveloperMode = isDevelopment || $permissionStore.isDeveloper;
  $: vaults = $vaultStore.vaults;
  $: isConnected = $walletStore.isConnected;
  $: principal = $walletStore.principal?.toString() || null;
  
  // Update local state when store changes
  $: {
    isLoading = $vaultStore.isLoading;
    loadError = $vaultStore.error;
  }
  
  // Add a check for stuck transfers - with proper filtering
  $: stuckTransfers = $vaultStore.pendingTransfers.filter(
    transfer => (Date.now() - transfer.timestamp) > 30 * 60 * 1000 // Older than 30 minutes
  );
  
  /**
   * Load user's vaults with caching and error handling
   */
  async function loadVaults(forceRefresh = false): Promise<EnhancedVault[]> {
    if (!isConnected || !principal || !canViewVaults) {
      return [];
    }
    
    try {
      // Load protocol status for ICP price first
      const status = await protocolService.getProtocolStatus();
      icpPrice = status.lastIcpRate;
      
      // Then load vaults with potential caching
      const loadedVaults = await vaultStore.loadVaults(forceRefresh);
      
      // Check for auto-closed vaults to keep UI in sync with backend
      try {
        const userVaults = await protocolService.getUserVaults(true);
        const currentVaultIds = new Set(userVaults.map(v => v.vaultId));
        
        // Find vaults in store that no longer exist on chain
        const missingVaults = $vaultStore.vaults
          .filter(v => !currentVaultIds.has(v.vaultId))
          .map(v => v.vaultId);
        
        if (missingVaults.length > 0) {
          console.log(`Found ${missingVaults.length} vaults in local state that no longer exist:`, missingVaults);
          
          // Remove each missing vault from local state
          missingVaults.forEach(vaultId => {
            vaultStore.removeVault(vaultId);
          });
        }
      } catch (err) {
        console.warn('Error checking for auto-closed vaults:', err);
      }
      
      return loadedVaults;
    } catch (error) {
      console.error('Error loading vaults:', error);
      throw error;
    }
  }
  
  /**
   * Handle developer passkey submission
   */
  function handlePasskeySubmit(): void {
    if (passkey === import.meta.env.VITE_DEVELOPER_PASSKEY || passkey === 'devsecret') {
      permissionStore.grantPermission('isDeveloper');
      passkeyError = '';
      showPasskeyInput = false;
    } else {
      passkeyError = 'Invalid developer passkey';
    }
  }

  /**
   * Handle vault selection from the VaultCard component
   */
  function handleVaultSelect(event: CustomEvent<{vaultId: number}>): void {
    if (event.detail && event.detail.vaultId) {
      goto(`/vaults/${event.detail.vaultId}`);
    }
  }

  /**
   * Refresh vaults with comprehensive error handling
   */
  async function refreshVaults(force = false): Promise<void> {
    try {
      isLoading = true;
      loadError = "";
      
      await loadVaults(force);
    } catch (err) {
      console.error('Error refreshing vaults:', err);
      loadError = err instanceof Error ? err.message : 'Failed to load vaults';
    } finally {
      isLoading = false;
    }
  }
  
  // Load vaults on component mount if connected and has permission
  onMount(async () => {
    // Initialize permission store first (if not already done in layout)
    await permissionStore.init();
    
    if (isConnected && canViewVaults) {
      loadVaults();
    }
  });
</script>

<div class="max-w-4xl mx-auto p-6">
  {#if !isDeveloperMode}
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
      
      {#if showPasskeyInput}
        <div class="mb-4">
          <div class="flex gap-2">
            <input 
              type="password" 
              bind:value={passkey} 
              placeholder="Enter developer passkey"
              class="flex-grow p-2 bg-gray-800 rounded border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
              on:keydown={(e) => e.key === 'Enter' && handlePasskeySubmit()}
            />
            <button 
              class="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-md"
              on:click={handlePasskeySubmit}
            >
              Submit
            </button>
          </div>
          {#if passkeyError}
            <p class="text-red-400 text-sm mt-2">{passkeyError}</p>
          {/if}
        </div>
      {:else}
        <button
          class="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-md"
          on:click={() => showPasskeyInput = true}
        >
          Access Developer Mode
        </button>
      {/if}
      
      <button 
        class="text-xs text-purple-400 hover:text-purple-300 ml-4"
        on:click={() => permissionStore.clear()}
      >
        Exit Developer Mode
      </button>
    </div>
  {:else}
    <!-- ICP Price Display (Only shown in developer mode) -->
    <div class="mb-8 bg-gray-900/50 p-6 rounded-lg shadow-lg backdrop-blur-sm ring-2 ring-purple-400">
      <div class="flex justify-between items-center mb-2">
        <h2 class="text-2xl font-bold">Current ICP Price</h2>
        <div class="bg-purple-900/30 px-3 py-1 rounded-full text-xs text-purple-300 flex items-center gap-2">
          <span class="w-2 h-2 bg-purple-400 rounded-full animate-pulse"></span>
          Developer Mode
          <button 
            class="text-xs text-purple-400 hover:text-purple-300"
            on:click={() => permissionStore.clear()}
          >
            Exit
          </button>
        </div>
      </div>
      
      {#if isLoading && !icpPrice}
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
        
        {#if isConnected}
          <button 
            on:click={() => refreshVaults()}
            class="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-md text-sm"
            disabled={isLoading}
          >
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        {/if}
      </div>
    </div>

    <!-- Display content based on connection status and data -->
    {#if !isConnected}
      <div class="text-center p-12 bg-gray-900/50 rounded-lg backdrop-blur-sm">
        <p class="text-xl text-gray-300 mb-4">Please connect your wallet to view your vaults</p>
        <button 
          on:click={() => walletStore.connect('plug')}
          class="inline-block px-6 py-3 bg-purple-600 rounded-lg hover:bg-purple-500"
        >
          Connect Wallet
        </button>
      </div>
    {:else if isLoading && vaults.length === 0}
      <div class="flex justify-center p-12">
        <div class="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    {:else if loadError && vaults.length === 0}
      <div class="p-6 text-center bg-red-900/30 border border-red-800 rounded-lg">
        <p class="text-red-200 mb-4">{loadError}</p>
        <button 
          on:click={() => refreshVaults()}
          class="px-4 py-2 bg-red-700 hover:bg-red-600 rounded-lg"
        >
          Try Again
        </button>
      </div>
    {:else if vaults.length === 0}
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
        {#each vaults as vault (vault.vaultId)}
          <VaultCard {vault} {icpPrice} on:select={handleVaultSelect} />
        {/each}
      </div>
    {/if}

    <!-- Status indicator for debugging -->
    <div class="mt-6 text-xs text-gray-500">
      <p>Status: {isConnected ? 'Connected' : 'Not connected'} | 
         Principal: {principal || 'None'} | 
         Vaults: {vaults.length} | 
         Last updated: {new Date($vaultStore.lastUpdated).toLocaleTimeString()}</p>
    </div>
  {/if}
</div>