<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { walletStore } from '$lib/stores/wallet';
  import { protocolService } from '$lib/services/protocol';
  import VaultDetails from '$lib/components/vault/VaultDetails.svelte';
  import { isDevelopment } from '$lib/config';
  import { permissionStore } from '$lib/stores/permissionStore';
  import type { EnhancedVault } from '$lib/services/types';
  import { vaultStore } from '$lib/stores/vaultStore';
  import { developerAccess } from '$lib/stores/developer';
  
  // Get vault ID from URL params - with proper number parsing
  $: vaultId = parseInt($page.params.id) || 0;
  
  // State management with proper types
  let isConnected = $walletStore.isConnected;
  let principal = $walletStore.principal;
  let vault: EnhancedVault | null = null;
  let isLoading = true;
  let error = '';
  let icpPrice = 0;
  
  // Developer mode management
  let showPasskeyInput = false;
  let passkey = "";
  let passkeyError = "";
  
  // Subscribe to wallet state changes
  $: isConnected = $walletStore.isConnected;
  $: principal = $walletStore.principal;
  
  // Check for developer access
  $: isDeveloperMode = isDevelopment || $permissionStore.isDeveloper;
  
  // Handle developer passkey submission
  function handlePasskeySubmit() {
    const isValid = developerAccess.checkPasskey(passkey);
    if (isValid) {
      passkeyError = '';
      passkey = '';
      showPasskeyInput = false;
      // Load vault now that we have access
      loadVault();
    } else {
      passkeyError = 'Invalid developer passkey';
    }
  }
  
  // Load vault data
  async function loadVault() {
    if (!isConnected) {
      goto('/');
      return;
    }
    
    // Check for developer access
    if (!isDeveloperMode) {
      error = 'Developer access required';
      isLoading = false;
      return;
    }
    
    isLoading = true;
    error = '';
    
    try {
      // First try to get vault from store
      vault = await vaultStore.getVault(vaultId);
      
      // If vault not in store, load from API
      if (!vault) {
        // Get protocol status for ICP price
        const status = await protocolService.getProtocolStatus();
        icpPrice = status.lastIcpRate;
        
        // Get user vaults and filter by ID
        const userVaults = await protocolService.getUserVaults();
        const foundVault = userVaults.find(v => v.vaultId === vaultId);
        
        if (foundVault) {
          // Enhance vault with calculated properties
          vault = vaultStore.enhanceVault(foundVault, icpPrice);
        } else {
          error = 'Vault not found or you do not have permission to access it';
        }
      } else {
        // We already have the vault data from the store
        // Just get the latest ICP price for up-to-date calculations
        const status = await protocolService.getProtocolStatus();
        icpPrice = status.lastIcpRate;
      }
    } catch (err) {
      console.error('Error loading vault:', err);
      error = err instanceof Error ? err.message : 'Failed to load vault details';
    } finally {
      isLoading = false;
    }
  }
  
  onMount(() => {
    // Load vault if we already have developer access
    if (isDeveloperMode) {
      loadVault();
    }
  });
</script>

<svelte:head>
  <title>RUMI Protocol - Vault #{vaultId}</title>
</svelte:head>

<div class="max-w-4xl mx-auto p-6">
  <div class="mb-8">
    <button 
      class="flex items-center text-gray-300 hover:text-white mb-4"
      on:click={() => goto('/vaults')}
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clip-rule="evenodd" />
      </svg>
      Back to Vaults
    </button>
  
    <h1 class="text-3xl font-bold mb-2">Vault #{vaultId}</h1>
    <p class="text-gray-400">Manage your collateral and debt position</p>
  </div>
  
  {#if !isDeveloperMode}
    <!-- Developer Access Required Section -->
    <div class="bg-gray-900/50 p-6 rounded-lg shadow-lg backdrop-blur-sm border border-purple-500/30">
      <div class="flex items-center gap-2 mb-4">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        <h2 class="text-2xl font-semibold">Developer Access Required</h2>
      </div>
      
      <p class="text-gray-300 mb-6">
        The vault details feature is currently in development. Please enter your developer passkey to continue.
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
          Enter Developer Mode
        </button>
      {/if}
    </div>
  {:else if isLoading}
    <div class="flex justify-center p-12">
      <div class="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  {:else if error}
    <div class="p-4 bg-red-900/50 border border-red-500 rounded-lg text-red-200">
      {error}
      
      <div class="mt-4">
        <button 
          class="px-4 py-2 bg-red-700 hover:bg-red-600 rounded text-white"
          on:click={() => goto('/vaults')}
        >
          Return to Vaults
        </button>
      </div>
    </div>
  {:else if vault}
    <!-- Developer Mode Indicator -->
    <div class="flex justify-end mb-4">
      <div class="bg-purple-900/30 px-3 py-1 rounded-full text-xs text-purple-300 flex items-center gap-2">
        <span class="w-2 h-2 bg-purple-400 rounded-full animate-pulse"></span> 
        Developer Mode
        <button 
          class="text-xs text-purple-400 hover:text-purple-300 ml-1"
          on:click={() => developerAccess.clearAccess()}
        >
          Exit
        </button>
      </div>
    </div>
    
    <VaultDetails vaultId={vault.vaultId} icpPrice={icpPrice} />
  {/if}
</div>
