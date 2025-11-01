<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { walletsList, type PNPWallet } from '@windoge98/plug-n-play';
  import { walletStore } from '../../stores/wallet';
  import { get } from 'svelte/store';
  import { permissionManager } from '../../services/PermissionManager';
  import { WALLET_TYPES } from '../../services/auth';

  interface WalletInfo extends Omit<PNPWallet, 'adapter' | 'logo'> {
    id: string;
    name: string;
    icon?: string;
    description?: string;
    recommended?: boolean;
    logo?: string; // Add optional logo property for compatibility
  }

  console.log("Available wallets:", walletsList);
  
  // Filter out OISY wallet from the list and add Internet Identity
  const walletList: WalletInfo[] = [
    // Add Internet Identity first
    {
      id: WALLET_TYPES.INTERNET_IDENTITY,
      name: 'Internet Identity',
      icon: '/main-icp-logo.png',
      description: 'Powered by Internet Computer',
      recommended: true
    },
    // Add filtered Plug wallets
    ...walletsList
      .filter(wallet => !wallet.name.toLowerCase().includes('oisy'))
      .filter(wallet => !wallet.name.includes('NFID'))
      .filter(wallet => !wallet.name.includes('Internet Identity'))
      .map(wallet => ({
        ...wallet,
        description: wallet.id === 'nfid' ? 'Sign in with Google' : undefined
      }))
  ];

  let error: string | null = null;
  let showWalletDialog = false;
  let connecting = false;
  let abortController = new AbortController();
  let isRefreshingBalance = false;

  onDestroy(() => {
    if (connecting) {
      connecting = false;
      abortController.abort();
    }
  });

  async function connectWallet(walletId: string) {
    if (!walletId || connecting) return;
    
    try {
      connecting = true;
      error = null;
      abortController = new AbortController();
      
      const timeoutId = setTimeout(() => abortController.abort(), 30000);
      
      // FIXED: Connect wallet FIRST, then permissions are handled automatically
      // The walletStore.connect() will handle permission requests internally
      await walletStore.connect(walletId);
      clearTimeout(timeoutId);
      showWalletDialog = false;
      
      // Add a short delay then refresh balance explicitly
      setTimeout(async () => {
        try {
          await walletStore.refreshBalance();
          console.log('Initial balance refresh completed');
        } catch (err) {
          console.warn('Initial balance refresh failed:', err);
        }
      }, 1000);
      
    } catch (err) {
      console.error('Connection error:', err);
      error = err instanceof Error ? err.message : 'Failed to connect';
    } finally {
      connecting = false;
    }
  }

  async function disconnectWallet() {
    try {
      await walletStore.disconnect();
      showWalletDialog = false; // Close the dropdown after disconnect
    } catch (err) {
      console.error('Disconnection failed:', err);
    }
  }

  function formatAddress(addr: string | null): string {
    if (!addr) return '';
    return addr; // Return the full principal ID
  }

  // Handle clicks outside the wallet dialog to close it
  function handleClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!showWalletDialog) return;
    
    const walletDialog = document.getElementById('wallet-dialog');
    const walletButton = document.getElementById('wallet-button');
    
    // Close dialog if clicking outside and not on the button
    if (walletDialog && !walletDialog.contains(target) && 
        walletButton && !walletButton.contains(target)) {
      showWalletDialog = false;
    }
  }

  // Setup click handler on mount
  onMount(() => {
    document.addEventListener('click', handleClickOutside);
    
    // Perform an initial balance refresh if connected
    if ($walletStore.isConnected && $walletStore.principal) {
      walletStore.refreshBalance().catch(err => {
        console.warn('Initial balance refresh failed:', err);
      });
    }
    
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  });

  // Add manual refresh function
  async function handleRefreshBalance(e: MouseEvent | KeyboardEvent) {
    e.stopPropagation();
    
    if (isRefreshingBalance) return; // Prevent multiple concurrent refreshes
    
    try {
      isRefreshingBalance = true;
      console.log('Manual balance refresh requested');
      await walletStore.refreshBalance();
      console.log('Balance refresh completed');
    } catch (err) {
      console.error('Manual balance refresh failed:', err);
    } finally {
      isRefreshingBalance = false;
    }
  }
  
  $: isConnected = $walletStore.isConnected;
  $: account = $walletStore.principal?.toString() ?? null;
  $: currentIcon = $walletStore.icon;
  $: tokenBalances = $walletStore.tokenBalances ?? {};
  
  // Log the token balances whenever they change
  $: {
    console.log('Current wallet state:', $walletStore);
    if ($walletStore.tokenBalances?.ICP) {
      console.log('Displayed ICP balance:', $walletStore.tokenBalances.ICP.formatted,
                  'Raw:', $walletStore.tokenBalances.ICP.raw.toString());
    }
  }
</script>

<svelte:head>
  <!-- Add any necessary script imports here -->
</svelte:head>

<div class="relative" id="wallet-container">
  {#if !isConnected}
    <button
      id="wallet-button"
      class="icp-button flex items-center bg-white ring-2 ring-black/20 hover:ring-white/40 text-black gap-2"
      on:click|stopPropagation={() => { showWalletDialog = true; console.log("Dialog open state:", showWalletDialog); }}
      disabled={connecting}
    >
      {#if connecting}
        <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
      {:else}
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
          <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
          <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
        </svg>
      {/if}
      {connecting ? 'Connecting...' : 'Connect Wallet'}
    </button>

    {#if showWalletDialog}
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 min-h-screen">
        <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" on:click|stopPropagation={() => showWalletDialog = false}></div>
        <div id="wallet-dialog" class="relative w-full max-w-md p-6 bg-gradient-to-br from-[#522785] to-[#1a237e] rounded-xl border border-[#29abe2]/20 shadow-xl transform transition-all">
          <div class="flex justify-between mb-6">
            <h2 class="text-xl font-semibold text-white">Connect Wallet</h2>
            <button 
              class="text-gray-400 hover:text-gray-200"
              on:click|stopPropagation={() => showWalletDialog = false}
              disabled={connecting}
            >
              ✕
            </button>
          </div>
          
          <div class="flex flex-col gap-3">
            {#each walletList as wallet (wallet.id)}
              <button
                class="flex items-center justify-between w-full px-4 py-3 text-white rounded-xl border transition-all duration-200 {wallet.recommended ? 'bg-gradient-to-r from-purple-900/50 to-blue-900/50 border-purple-500/30 hover:border-purple-400/50' : 'bg-gray-800/50 border-purple-500/10 hover:bg-purple-900/20 hover:border-purple-500/30'}"
                on:click|stopPropagation={() => connectWallet(wallet.id)}
                disabled={connecting}
              >
                <div class="flex items-center gap-4">
                  {#if wallet.icon}
                    <img 
                      src={wallet.icon}
                      alt={wallet.name} 
                      class="w-10 h-10 rounded-lg object-contain"
                    />
                  {:else}
                    <div class="w-10 h-10 bg-gray-700 rounded-full flex items-center justify-center">
                      <span>{wallet.name[0]}</span>
                    </div>
                  {/if}
                  <div class="flex-col">
                    <div class="flex items-center gap-2">
                      <span class="text-lg">{wallet.name}</span>
                      {#if wallet.recommended}
                        <span class="px-2 py-1 text-xs bg-purple-500/20 text-purple-300 rounded-full">Recommended</span>
                      {/if}
                    </div>
                    {#if wallet.description}
                      <span class="flex-col text-sm text-gray-400">{wallet.description}</span>
                    {/if}
                  </div>
                </div>
                <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M9 18l6-6-6-6"/>
                </svg>
              </button>
            {/each}
          </div>

          {#if connecting}
            <div class="flex justify-center mt-4">
              <div class="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          {/if}
          
          {#if error}
            <div class="mt-4 p-3 bg-red-900/50 text-red-200 rounded-lg">
              <div class="flex justify-between">
                <div>{error}</div>
                <button 
                  class="text-gray-400 hover:text-gray-200"
                  on:click|stopPropagation={() => error = null}
                  aria-label="Close error message"
                >
                  ✕
                </button>
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  {:else}
    <div class="relative">
      <button
        id="wallet-button"
        class="bg-gray-900/80 backdrop-blur-sm border border-purple-500/20 hover:border-purple-400/40 hover:bg-gray-800/80 px-4 py-2.5 rounded-xl flex items-center gap-3 transition-all duration-200 shadow-lg"
        on:click|stopPropagation={() => { showWalletDialog = !showWalletDialog; console.log("Toggle wallet dropdown:", showWalletDialog); }}
        aria-expanded={showWalletDialog}
        aria-controls="wallet-dialog"
      >
        <div class="flex items-center gap-3">
          <!-- Wallet Icon -->
          {#if currentIcon}
            <img
              src={currentIcon}
              alt="Wallet Icon"
              class="w-6 h-6 rounded-full"
            />
          {:else}
            <div class="w-6 h-6 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center">
              <div class="w-2 h-2 bg-white rounded-full"></div>
            </div>
          {/if}
          
          <!-- Principal ID -->
          <div class="flex flex-col items-start">
            <span class="text-xs text-gray-400 font-mono">{formatAddress(account)}</span>
            <div class="flex items-center gap-3">
              {#if tokenBalances.ICP}
                <div class="flex items-center gap-1">
                  <span class="font-medium text-white text-sm">{tokenBalances.ICP.formatted} ICP</span>
                  {#if tokenBalances.ICP.usdValue}
                    <span class="text-gray-400 text-xs">(${tokenBalances.ICP.usdValue.toFixed(2)})</span>
                  {/if}
                </div>
              {/if}
              {#if tokenBalances.ICUSD && Number(tokenBalances.ICUSD.formatted) > 0}
                <span class="text-purple-300 text-sm font-medium">{tokenBalances.ICUSD.formatted} icUSD</span>
              {/if}
            </div>
          </div>
          
          <!-- Refresh Button -->
          <div
            class="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700/50 rounded-lg cursor-pointer transition-colors duration-200"
            on:click|stopPropagation={handleRefreshBalance}
            on:keydown={e => e.key === 'Enter' && handleRefreshBalance(e)}
            role="button"
            tabindex="0"
            title="Refresh balance"
          >
            <svg class:animate-spin={isRefreshingBalance} class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          
          <!-- Dropdown Arrow -->
          <svg 
            class="w-4 h-4 text-gray-400 transition-transform duration-200 {showWalletDialog ? 'transform rotate-180' : ''}" 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
          </svg>
        </div>
      </button>

      {#if showWalletDialog}
        <div 
          class="absolute right-0 mt-2 w-80 bg-gray-900/95 backdrop-blur-lg border border-purple-500/20 rounded-xl shadow-2xl p-0 z-50" 
          id="wallet-dialog"
          role="dialog"
          aria-label="Wallet options"
        >
          <!-- Header with wallet info -->
          <div class="p-4 border-b border-gray-800/50">
            <div class="flex items-center gap-3 mb-3">
              {#if currentIcon}
                <img
                  src={currentIcon}
                  alt="Wallet Icon"
                  class="w-8 h-8 rounded-full"
                />
              {:else}
                <div class="w-8 h-8 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center">
                  <svg class="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4zM18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z"></path>
                  </svg>
                </div>
              {/if}
              <div>
                <p class="text-sm font-medium text-white">Connected Wallet</p>
                <p class="text-xs text-gray-400 font-mono break-all">{formatAddress(account)}</p>
              </div>
            </div>
            
            <!-- Balances -->
            <div class="space-y-2">
              <h3 class="text-sm font-medium text-gray-300 mb-2">Balances</h3>
              {#if tokenBalances.ICP}
                <div class="flex items-center justify-between bg-gray-800/30 rounded-lg p-3">
                  <div class="flex items-center gap-2">
                    <img src="/icp_logo.png" alt="ICP" class="w-5 h-5 rounded-full" />
                    <span class="font-medium text-white">{tokenBalances.ICP.formatted} ICP</span>
                  </div>
                  {#if tokenBalances.ICP.usdValue}
                    <span class="text-gray-400 text-sm">${tokenBalances.ICP.usdValue.toFixed(2)}</span>
                  {/if}
                </div>
              {/if}
              
              {#if tokenBalances.ICUSD && Number(tokenBalances.ICUSD.formatted) > 0}
                <div class="flex items-center justify-between bg-gray-800/30 rounded-lg p-3">
                  <div class="flex items-center gap-2">
                    <img src="/icUSD-logo.png" alt="icUSD" class="w-5 h-5 rounded-full" />
                    <span class="font-medium text-white">{tokenBalances.ICUSD.formatted} icUSD</span>
                  </div>
                </div>
              {/if}
              
              {#if (!tokenBalances.ICP || Number(tokenBalances.ICP.formatted) === 0) && (!tokenBalances.ICUSD || Number(tokenBalances.ICUSD.formatted) === 0)}
                <div class="text-center py-4">
                  <p class="text-gray-400 text-sm">No balances found</p>
                  <p class="text-gray-500 text-xs mt-1">Try refreshing your balance</p>
                </div>
              {/if}
            </div>
          </div>
          
          <!-- Actions -->
          <div class="p-2">
            <!-- Refresh Balance Button -->
            <button 
              class="flex items-center w-full gap-3 px-4 py-3 text-sm text-blue-400 hover:bg-blue-900/20 hover:text-blue-300 rounded-lg transition-colors duration-200 mb-1"
              on:click|stopPropagation={handleRefreshBalance}
              disabled={isRefreshingBalance}
            >
              <svg class:animate-spin={isRefreshingBalance} class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span>{isRefreshingBalance ? 'Refreshing...' : 'Refresh Balance'}</span>
            </button>
            
            <!-- Disconnect Button -->
            <button
              class="flex items-center w-full gap-3 px-4 py-3 text-sm text-red-400 hover:bg-red-900/20 hover:text-red-300 rounded-lg transition-colors duration-200"
              on:click|stopPropagation={disconnectWallet}
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span>Disconnect Wallet</span>
            </button>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if error}
  <div class="fixed bottom-4 right-4 p-4 bg-red-500 text-white rounded-lg shadow-lg z-50">
    {error}
    <button class="ml-2" on:click={() => error = null}>✕</button>
  </div>
{/if}