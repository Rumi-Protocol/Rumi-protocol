<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { EnhancedVault } from "../lib/stores/vaultStore";
  import VaultCard from "../lib/components/vault/VaultCard.svelte";
  import { walletStore as wallet } from "../lib/stores/wallet";
  import CreateVault from "../lib/components/vault/CreateVault.svelte";
  import { developerAccess } from '../lib/stores/developer';
  import { protocolService } from '$lib/services/protocol';
  import { formatNumber } from '$lib/utils/format';
  import ProtocolStats from '$lib/components/dashboard/ProtocolStats.svelte';
  import { permissionManager } from '../lib/services/PermissionManager';
  import { tweened } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
	import type { fromHex } from "@dfinity/agent";

  let vaults: EnhancedVault[] = [];
  let icpPrice = 0;
  let isLoading = true;
  let isPriceLoading = true;
  let error = "";
  $: isConnected = $wallet.isConnected;
  $: isDeveloper = $developerAccess;

  let showDevInput = false;
  let devPasskey = "";
  let devError = "";

  let initialized = false;
  let connectionError = '';

  let principal = null;
  let borrowingFee = 0;
  let redemptionFee = 0;
  let isLoadingStatus = true;
  let icpAmount = 0;
  let icusdAmount = 0;
  let actionInProgress = false;
  let errorMessage = '';
  let successMessage = '';

  wallet.subscribe((state) => {
    isConnected = state.isConnected;
    principal = state.principal;
  });

  $: calculatedBorrowFee = icusdAmount * borrowingFee;
  $: calculatedIcusdAmount = icusdAmount - calculatedBorrowFee;
  $: calculatedCollateralRatio = icpAmount > 0 && icusdAmount >= 0.001 
    ? ((icpAmount * icpPrice) / icusdAmount) * 100 
    : icpAmount > 0 ? Infinity : 0;

  // Add a formatted display version that caps extremely large values
  $: formattedCollateralRatio = calculatedCollateralRatio === Infinity 
    ? '∞' 
    : calculatedCollateralRatio > 1000000 
      ? '>1,000,000' 
      : formatNumber(calculatedCollateralRatio);

  $: isValidCollateralRatio = calculatedCollateralRatio >= 130;

  async function fetchData() {
    isLoadingStatus = true;
    try {
      const status = await protocolService.getProtocolStatus();
      icpPrice = status.lastIcpRate;

      const fees = await protocolService.getFees(100);
      borrowingFee = fees.borrowingFee;
      redemptionFee = fees.redemptionFee;

      if (isConnected) {
        isLoading = true;
        const userVaults = await protocolService.getUserVaults();
        vaults = userVaults.map(vault => ({
          ...vault,
          lastUpdated: Date.now(),
          timestamp: vault.timestamp || Date.now() // Ensure timestamp is always defined
        }));
      }
    } catch (error) {
      console.error('Error fetching protocol data:', error);
    } finally {
      isLoadingStatus = false;
    }
  }

  async function createVault() {
    if (!isConnected) {
      errorMessage = 'Please connect your wallet first';
      return;
    }

    if (icpAmount <= 0) {
      errorMessage = 'Please enter a valid ICP amount';
      return;
    }

    if (icusdAmount <= 0) {
      errorMessage = 'Please enter a valid icUSD amount to borrow';
      return;
    }

    if (!isValidCollateralRatio) {
      errorMessage = 'Collateral ratio must be at least 130%';
      return;
    }

    actionInProgress = true;
    errorMessage = '';
    successMessage = '';

    try {
      const openResult = await protocolService.openVault(icpAmount);

      if (!openResult.success) {
        errorMessage = openResult.error || 'Failed to open vault';
        return;
      }

      const borrowResult = await protocolService.borrowFromVault(
        openResult.vaultId!,
        icusdAmount
      );

      if (!borrowResult.success) {
        errorMessage = borrowResult.error || 'Failed to borrow icUSD';
        return;
      }

      successMessage = `Successfully created vault #${openResult.vaultId} and borrowed ${formatNumber(calculatedIcusdAmount)} icUSD`;

      icpAmount = 0;
      icusdAmount = 0;

      await wallet.refreshBalance();

    } catch (error) {
      console.error('Error creating vault:', error);
      errorMessage = 'An unexpected error occurred';
    } finally {
      actionInProgress = false;
    }
  }

  function updatePrice(newPrice: number) {
    icpPrice = newPrice;
    isPriceLoading = false;
  }

  function handleDevAccess() {
    const isValid = developerAccess.checkPasskey(devPasskey);
    if (!isValid) {
      devError = "Invalid developer passkey";
    } else {
      devError = "";
      showDevInput = false;
    }
  }

  async function loadData() {
    try {
      const status = await protocolService.getProtocolStatus();
      icpPrice = status.lastIcpRate;
      isPriceLoading = false;

      if (isConnected) {
        isLoading = true;
        const userVaults = await protocolService.getUserVaults();
        vaults = userVaults.map(vault => ({
          ...vault,
          lastUpdated: Date.now(),
          timestamp: vault.timestamp || Date.now() // Ensure timestamp is always defined
        }));
      }
    } catch (err) {
      console.error("Error loading data:", err);
      error = err instanceof Error ? err.message : "Failed to load data";
    } finally {
      isLoading = false;
    }
  }



  onMount(async () => {
    try {
      if ($wallet.isConnected) {
        initialized = await permissionManager.requestAllPermissions();
        //await vaultStore.loadVaults();
      }
    } catch (err) {
      console.error('Initialization error:', err);
      connectionError = err instanceof Error ? err.message : 'Connection error';
    }
  });

  onMount(fetchData); // Perhaps use fetchData() here instead

  // Add this to debug price display issues
  onMount(async () => {
    try {
      // Get the price directly and log it
      const price = await protocolService.getICPPrice();
      console.log('Direct ICP price check:', price);
      
      // Get full status to compare
      const status = await protocolService.getProtocolStatus();
      console.log('Protocol status with price:', status);
      console.log('ICP price from status:', status.lastIcpRate);
    } catch (error) {
      console.error('Error in price verification:', error);
    }
  });

  // Enhanced price tracking logic
  let animatedPrice = tweened(0, {
    duration: 600,
    easing: cubicOut
  });
  let previousPrice = 0;
  let priceRefreshInterval: ReturnType<typeof setInterval>;
  let lastPriceUpdateTime = '';
  let priceUpdateError = false;
  let priceRefreshCount = 0;
  
  // Price trend tracking
  $: priceTrend = icpPrice > previousPrice 
    ? 'up' : icpPrice < previousPrice 
    ? 'down' : '';
    
  // Update animated price whenever icpPrice changes
  $: if (icpPrice > 0) {
    console.log('Price updated to:', icpPrice, 'Previous:', previousPrice);
    if (previousPrice === 0) {
      // First load, set without animation
      animatedPrice.set(icpPrice, { duration: 0 });
    } else {
      // Normal update with animation
      animatedPrice.set(icpPrice);
    }
  }
  
  // More reliable fetch implementation
  async function refreshIcpPrice() {
    try {
      console.log('Fetching fresh ICP price...');
      isPriceLoading = true;
      priceUpdateError = false;
      
      // Store previous price for comparison
      if (icpPrice > 0) {
        previousPrice = icpPrice;
      }
      
      // Get price directly from service to ensure fresh data
      const newPrice = await protocolService.getICPPrice();
      console.log(`Price received: ${newPrice}, previous: ${previousPrice}`);
      
      if (newPrice > 0) {
        icpPrice = newPrice;
        priceRefreshCount++;
        lastPriceUpdateTime = new Date().toLocaleTimeString();
      } else {
        console.warn('Received invalid price (0 or less)');
        priceUpdateError = true;
      }
    } catch (error) {
      console.error('Failed to refresh ICP price:', error);
      priceUpdateError = true;
    } finally {
      isPriceLoading = false;
    }
  }
  
  // Clean up old timers and establish new refresh cycle
  function resetPriceRefreshTimer() {
    // Clear any existing interval
    if (priceRefreshInterval) {
      clearInterval(priceRefreshInterval);
    }
    
    // Create a new interval
    priceRefreshInterval = setInterval(refreshIcpPrice, 30000);
    console.log('Price refresh interval set: refresh every 30s');
  }
  
  // Improved mount/unmount handling
  onMount(() => {
    // Immediate initial fetch
    refreshIcpPrice();
    
    // Set up regular refresh
    resetPriceRefreshTimer();
    
    return () => {
      if (priceRefreshInterval) {
        clearInterval(priceRefreshInterval);
        console.log('Price refresh interval cleared on unmount');
      }
    };
  });
  
  onDestroy(() => {
    if (priceRefreshInterval) {
      clearInterval(priceRefreshInterval);
      console.log('Price refresh interval cleared on destroy');
    }
  });
</script>

<svelte:head>
  <title>RUMI Protocol - Borrow icUSD</title>
</svelte:head>

<div class="container mx-auto px-4 max-w-6xl">
  <section class="mb-12">
    <div class="text-center mb-10">
      <h1 class="text-4xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-pink-400 to-purple-600">
        Borrow icUSD with your ICP
      </h1>
      <p class="text-xl text-gray-300 max-w-2xl mx-auto">
        Create a vault, deposit ICP as collateral, and borrow the icUSD stablecoin
      </p>
    </div>

    <ProtocolStats />
  </section>

  <div class="mb-8 bg-gray-900/50 p-6 rounded-lg shadow-lg backdrop-blur-sm ring-2 ring-purple-400">
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-2xl font-bold">Current ICP Price</h2>
      <div class="flex items-center gap-2">
        <button 
          class="p-1 bg-gray-800/50 rounded-full hover:bg-gray-800 transition-colors"
          on:click={() => {
            refreshIcpPrice();
            resetPriceRefreshTimer();
          }}
          disabled={isPriceLoading}
          title="Refresh price"
          aria-label="Refresh ICP price"
        >
          <svg class="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        {#if isPriceLoading}
          <div class="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
        {/if}
      </div>
    </div>
    
    {#if icpPrice > 0}
      <div class="flex items-baseline gap-2">
        <p class="text-3xl font-semibold tracking-tight">${$animatedPrice.toFixed(2)}</p>
        
        {#if priceTrend && previousPrice > 0}
          <div class={`flex items-center text-sm ${priceTrend === 'up' ? 'text-green-400' : 'text-red-400'}`}>
            {#if priceTrend === 'up'}
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 011.414 0l4 4a1 1 01-1.414 1.414L11 7.414V15a1 1 011-2 0V7.414L6.707 9.707a1 1 01-1.414 0z" clip-rule="evenodd"></path>
              </svg>
              <span>+${(icpPrice - previousPrice).toFixed(3)}</span>
            {:else}
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M14.707 10.293a1 1 0 010 1.414l-4 4a1 1 01-1.414 0l-4-4a1 1 111.414-1.414L9 12.586V5a1 1 012 0v7.586l2.293-2.293a1 1 011.414 0z" clip-rule="evenodd"></path>
              </svg>
              <span>${(icpPrice - previousPrice).toFixed(3)}</span>
            {/if}
          </div>
        {/if}
      </div>
      <div class="flex justify-between items-center text-xs text-gray-400 mt-1">
        <span>Updated at {lastPriceUpdateTime} · Auto-refreshes every 30s</span>
        {#if priceRefreshCount > 0}
          <span class="text-green-500">Live</span>
        {/if}
      </div>
    {:else if isPriceLoading}
      <div class="flex items-center gap-2">
        <div class="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
        <span>Loading price...</span>
      </div>
    {:else}
      <p class="text-xl text-yellow-500">Price unavailable</p>
      {#if priceUpdateError}
        <p class="text-sm text-red-400 mt-1">Failed to fetch latest price. Please try refreshing.</p>
      {/if}
    {/if}
  </div>

  <div class="mb-4 flex justify-center">
    {#if !$developerAccess}
      <div class="flex items-center gap-2">
        {#if showDevInput}
          <input
            type="password"
            bind:value={devPasskey}
            placeholder="Enter developer passkey"
            class="px-3 py-2 bg-gray-800/50 rounded border border-purple-500/20"
          />
          <button 
            class="px-4 py-2 bg-purple-600/50 rounded hover:bg-purple-500/50"
            on:click={handleDevAccess}
          >
            Unlock
          </button>
          {#if devError}
            <span class="text-red-400 text-sm">{devError}</span>
          {/if}
        {:else}
          <button
            class="text-sm text-gray-400 hover:text-white"
            on:click={() => showDevInput = true}
          >
            Developer Mode
          </button>
        {/if}
      </div>
    {:else}
      <span class="text-purple-400 text-sm">Developer Mode Active</span>
    {/if}
  </div>

  <section class="mb-12">
    <div class="glass-card max-w-2xl mx-auto">
      <h2 class="text-2xl font-semibold mb-6">Create a New Vault</h2>

      {#if $developerAccess}
        <!-- Original vault creation form only shown to developers -->
        <div class="space-y-6">
          <div>
            <label for="icp-amount" class="block text-sm font-medium text-gray-300 mb-1">
              ICP Collateral Amount
            </label>
            <div class="relative">
              <input
                id="icp-amount"
                type="number"
                bind:value={icpAmount}
                min="0"
                step="0.01"
                class="w-full bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-3 text-white"
                placeholder="0.00"
                disabled={actionInProgress}
              />
              <div class="absolute inset-y-0 right-0 flex items-center pr-4 pointer-events-none">
                <span class="text-gray-400">ICP</span>
              </div>
            </div>
            {#if icpAmount > 0}
              <p class="text-sm text-gray-400 mt-1">Value: ≈ ${formatNumber(icpAmount * icpPrice)}</p>
            {/if}
          </div>

          <div>
            <label for="icusd-amount" class="block text-sm font-medium text-gray-300 mb-1">
              icUSD Amount to Borrow
            </label>
            <div class="relative">
              <input
                id="icusd-amount"
                type="number"
                bind:value={icusdAmount}
                min="0"
                step="0.01"
                class="w-full bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-3 text-white"
                placeholder="0.00"
                disabled={actionInProgress}
              />
              <div class="absolute inset-y-0 right-0 flex items-center pr-4 pointer-events-none">
                <span class="text-gray-400">icUSD</span>
              </div>
            </div>
            {#if icusdAmount > 0}
              <div class="flex justify-between text-sm text-gray-400 mt-1">
                <span>Borrowing Fee ({(borrowingFee * 100).toFixed(2)}%):</span>
                <span>{formatNumber(calculatedBorrowFee)} icUSD</span>
              </div>
              <div class="flex justify-between text-sm text-gray-400">
                <span>You will receive:</span>
                <span>{formatNumber(calculatedIcusdAmount)} icUSD</span>
              </div>
            {/if}
          </div>

          {#if icpAmount > 0 && icusdAmount > 0}
            <div class="p-3 bg-gray-800/70 rounded-lg">
              <div class="flex justify-between text-sm mb-1">
                <span class="text-gray-300">Collateral Ratio:</span>
                <span class:text-red-500={!isValidCollateralRatio} class:text-green-500={isValidCollateralRatio}>
                  {formattedCollateralRatio}%
                </span>
              </div>

              <div class="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                <div 
                  class="h-full rounded-full" 
                  class:bg-red-500={!isValidCollateralRatio}
                  class:bg-green-500={isValidCollateralRatio}
                  style="width: {Math.min(calculatedCollateralRatio, 300)}%"
                ></div>
              </div>

              <div class="text-xs mt-1 text-gray-400">
                {#if isValidCollateralRatio}
                  Safe! A higher collateral ratio means lower liquidation risk.
                {:else}
                  Warning: Collateral ratio too low. Minimum required is 130%.
                {/if}
              </div>
            </div>
          {/if}

          {#if errorMessage}
            <div class="p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-200 text-sm">
              {errorMessage}
            </div>
          {/if}

          {#if successMessage}
            <div class="p-3 bg-green-900/30 border border-green-800 rounded-lg text-green-200 text-sm">
              {successMessage}
            </div>
          {/if}

          <div>
            <button
              class="w-full py-3 px-6 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 rounded-lg text-white font-medium transition-colors"
              on:click={createVault}
              disabled={actionInProgress || !isConnected}
            >
              {#if !isConnected}
                Connect Wallet to Continue
              {:else if actionInProgress}
                Creating Vault...
              {:else}
                Create Vault & Borrow icUSD
              {/if}
            </button>
          </div>
        </div>
      {:else}
        <!-- Developer mode access required message -->
        <div class="p-6 bg-gray-800/50 rounded-lg">
          <div class="flex flex-col items-center justify-center text-center">
            <div class="w-12 h-12 rounded-full bg-purple-800/50 flex items-center justify-center mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h3 class="text-xl font-semibold mb-3">Developer Access Required</h3>
            <p class="text-gray-300 mb-4">
              Vault creation is currently in developer mode and requires special access.
            </p>
            <button 
              class="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-500 transition-colors"
              on:click={() => showDevInput = true}
            >
              Enable Developer Mode
            </button>
          </div>
        </div>
      {/if}
    </div>
  </section>

  <section class="mb-16">
    <div class="max-w-4xl mx-auto">
      <h2 class="text-2xl font-semibold mb-6 text-center">How It Works</h2>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div class="glass-card h-full">
          <div class="text-pink-400 text-3xl font-bold mb-2">1</div>
          <h3 class="text-lg font-medium mb-2">Deposit Collateral</h3>
          <p class="text-gray-300">Deposit your ICP tokens as collateral to secure your position.</p>
        </div>

        <div class="glass-card h-full">
          <div class="text-pink-400 text-3xl font-bold mb-2">2</div>
          <h3 class="text-lg font-medium mb-2">Borrow icUSD</h3>
          <p class="text-gray-300">Borrow icUSD stablecoin against your collateral at a minimum ratio of 130%.</p>
        </div>

        <div class="glass-card h-full">
          <div class="text-pink-400 text-3xl font-bold mb-2">3</div>
          <h3 class="text-lg font-medium mb-2">Manage Your Vault</h3>
          <p class="text-gray-300">Add more collateral, borrow more, or repay your icUSD to maintain a healthy position.</p>
        </div>
      </div>
    </div>
  </section>
</div>



<style>
  /* Fix Tailwind @apply rule by converting to standard CSS */
  .glass-card {
    background-color: rgba(31, 41, 55, 0.4);
    backdrop-filter: blur(16px);
    border: 1px solid rgba(75, 85, 99, 0.5);
    border-radius: 0.5rem;
    padding: 1.5rem;
  }

  input::-webkit-outer-spin-button,
  input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  input[type=number] {
    -moz-appearance: textfield;
  }

  @keyframes bounce {
    0%, 100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-20px);
    }
  }
</style>