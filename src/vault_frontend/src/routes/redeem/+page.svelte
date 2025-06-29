<script lang="ts">
  import { onMount } from 'svelte';
  import { walletStore as wallet } from '$lib/stores/wallet';
  import { protocolService } from '$lib/services/protocol';
  import { formatNumber } from '$lib/utils/format';
  import ProtocolStats from '$lib/components/dashboard/ProtocolStats.svelte';
  
  let isConnected = false;
  let icpPrice = 0;
  let redemptionFee = 0;
  let icusdBalance = 0;
  let icusdAmount = 0;
  let isLoading = true;
  let actionInProgress = false;
  let errorMessage = '';
  let successMessage = '';
  
  // Subscribe to wallet state
  wallet.subscribe(state => {
    isConnected = state.isConnected;
    icusdBalance = state.balances.icusd ? Number(state.balances.icusd) : 0;
  });
  
  // Calculate values
  $: calculatedRedemptionFee = icusdAmount * redemptionFee;
  $: calculatedIcpAmount = icusdAmount > 0 ? (icusdAmount - calculatedRedemptionFee) / icpPrice : 0;
  
  // Fetch protocol data
  async function fetchData() {
    isLoading = true;
    try {
      const status = await protocolService.getProtocolStatus();
      icpPrice = status.lastIcpRate;
      
      // Get fees for 100 ICUSD
      const fees = await protocolService.getFees(100);
      redemptionFee = fees.redemptionFee;
      
      if (isConnected) {
        await wallet.refreshBalance();
        // Use the icusdBalance from the wallet store which is already subscribed to
      }
    } catch (error) {
      console.error('Error fetching protocol data:', error);
    } finally {
      isLoading = false;
    }
  }
  
  // Handle ICP redemption
  async function redeemIcp() {
    if (!isConnected) {
      errorMessage = 'Please connect your wallet first';
      return;
    }
    
    if (icusdAmount <= 0) {
      errorMessage = 'Please enter a valid icUSD amount';
      return;
    }
    
    if (icusdAmount > icusdBalance) {
      errorMessage = 'Insufficient icUSD balance';
      return;
    }
    
    actionInProgress = true;
    errorMessage = '';
    successMessage = '';
    
    try {
      // Use protocolService.redeemIcp instead of a non-existent method
      const result = await protocolService.redeemIcp(icusdAmount);
      
      if (result.success) {
        successMessage = `Successfully redeemed ${formatNumber(calculatedIcpAmount)} ICP for ${formatNumber(icusdAmount)} icUSD`;
        icusdAmount = 0;
        await wallet.refreshBalance();
      } else {
        errorMessage = result.error || 'Failed to redeem ICP';
      }
    } catch (error) {
      console.error('Error redeeming ICP:', error);
      errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    } finally {
      actionInProgress = false;
    }
  }
  
  onMount(fetchData);
</script>

<svelte:head>
  <title>RUMI Protocol - Redeem ICP</title>
</svelte:head>

<div class="container mx-auto px-4 max-w-6xl">
  <section class="mb-12">
    <div class="text-center mb-10">
      <h1 class="text-4xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-pink-400 to-purple-600">
        Redeem ICP with icUSD
      </h1>
      <p class="text-xl text-gray-300 max-w-2xl mx-auto">
        Exchange your icUSD stablecoin back to ICP tokens
      </p>
    </div>
    
    <ProtocolStats />
  </section>
  
  <section class="mb-12">
    <div class="glass-card max-w-2xl mx-auto">
      <h2 class="text-2xl font-semibold mb-6">Redeem ICP</h2>
      
      <div class="space-y-6">
        <div>
          <label for="icusd-amount" class="block text-sm font-medium text-gray-300 mb-1">
            icUSD Amount
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
              disabled={actionInProgress || isLoading}
            />
            <div class="absolute inset-y-0 right-0 flex items-center pr-4 pointer-events-none">
              <span class="text-gray-400">icUSD</span>
            </div>
          </div>
          
          {#if isConnected && !isLoading && icusdBalance > 0}
            <div class="text-xs text-right mt-1">
              <button 
                class="text-blue-400 hover:text-blue-300" 
                on:click={() => icusdAmount = icusdBalance}
                disabled={actionInProgress}
              >
                Max: {formatNumber(icusdBalance)}
              </button>
            </div>
          {/if}
        </div>
        
        {#if icusdAmount > 0}
          <div class="p-3 bg-gray-800/70 rounded-lg">
            <div class="flex justify-between text-sm text-gray-400 mb-1">
              <span>Redemption Fee ({(redemptionFee * 100).toFixed(2)}%):</span>
              <span>{formatNumber(calculatedRedemptionFee)} icUSD</span>
            </div>
            <div class="flex justify-between text-sm">
              <span class="text-gray-300">You will receive:</span>
              <span class="text-white font-medium">{formatNumber(calculatedIcpAmount)} ICP</span>
            </div>
            <div class="flex justify-between text-xs text-gray-500 mt-1">
              <span>Current ICP price:</span>
              <span>${formatNumber(icpPrice)}</span>
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
            on:click={redeemIcp}
            disabled={actionInProgress || !isConnected || icusdAmount <= 0 || icusdAmount > icusdBalance || isLoading}
          >
            {#if !isConnected}
              Connect Wallet to Continue
            {:else if actionInProgress}
              Processing Redemption...
            {:else if isLoading}
              Loading...
            {:else}
              Redeem ICP
            {/if}
          </button>
        </div>
      </div>
    </div>
  </section>
  
  <section class="mb-16">
    <div class="max-w-4xl mx-auto">
      <h2 class="text-2xl font-semibold mb-6 text-center">How Redemption Works</h2>
      
      <div class="glass-card p-6">
        <ol class="space-y-4">
          <li class="flex gap-4">
            <div class="flex-none w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center">1</div>
            <div>
              <strong class="text-white">Provide icUSD</strong>
              <p class="text-gray-300">Enter the amount of icUSD you want to redeem for ICP.</p>
            </div>
          </li>
          
          <li class="flex gap-4">
            <div class="flex-none w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center">2</div>
            <div>
              <strong class="text-white">Pay Redemption Fee</strong>
              <p class="text-gray-300">A small fee is charged for the redemption service.</p>
            </div>
          </li>
          
          <li class="flex gap-4">
            <div class="flex-none w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center">3</div>
            <div>
              <strong class="text-white">Receive ICP</strong>
              <p class="text-gray-300">The equivalent amount of ICP (based on current price) will be transferred to your wallet.</p>
            </div>
          </li>
        </ol>
        
        <div class="mt-6 p-3 bg-gray-900/50 rounded-lg">
          <p class="text-sm text-gray-400">Note: Redemption uses the protocol's liquidity pool. In rare cases of low liquidity, redemptions might be temporarily limited.</p>
        </div>
      </div>
    </div>
  </section>
</div>

<style>
  .glass-card {
    @apply bg-gray-800/40 backdrop-blur-lg border border-gray-700/50 rounded-lg p-6;
  }
  
  input::-webkit-outer-spin-button,
  input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  
  input[type=number] {
    -moz-appearance: textfield;
  }
</style>
