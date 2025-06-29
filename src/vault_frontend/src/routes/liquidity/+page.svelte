<script lang="ts">
  import { onMount } from 'svelte';
  import { walletStore as wallet } from '$lib/stores/wallet';
  import { protocolService } from '$lib/services/protocol';
  import { formatNumber } from '$lib/utils/format';
  import ProtocolStats from '$lib/components/dashboard/ProtocolStats.svelte';
  
  // Component state
  let isConnected = false;
  let icpPrice = 0;
  let totalIcpMargin = 0;
  let liquidityStatus = {
    liquidityProvided: 0,
    totalLiquidityProvided: 0,
    liquidityPoolShare: 0,
    availableLiquidityReward: 0,
    totalAvailableReturns: 0
  };
  let isLoading = true;
  let actionInProgress = false;
  let errorMessage = '';
  let successMessage = '';
  
  // Form values
  let provideAmount = 0;
  let withdrawAmount = 0;
  
  // Store the current wallet state
  let currentWalletState: any;
  
  // Subscribe to wallet state
  wallet.subscribe(state => {
    isConnected = state.isConnected;
    currentWalletState = state;
  });
  
  // Fetch protocol data and user's liquidity status
  async function fetchData() {
    isLoading = true;
    errorMessage = '';
    successMessage = '';
    
    try {
      // Get protocol status for ICP price and total margin
      const status = await protocolService.getProtocolStatus();
      icpPrice = status.lastIcpRate;
      
      // Get user's liquidity status if connected
      if (isConnected && currentWalletState?.principal) {
        try {
          const userLiquidityStatus = await protocolService.getLiquidityStatus(currentWalletState.principal);
          
          // Convert to numbers safely, defaulting to 0 for invalid values
          const liquidityProvided = Number(userLiquidityStatus.liquidity_provided || 0) / 100_000_000;
          const totalLiquidityProvided = Number(userLiquidityStatus.total_liquidity_provided || 0) / 100_000_000;
          
          // Calculate pool share safely - avoid division by zero or infinity
          let liquidityPoolShare = 0;
          if (totalLiquidityProvided > 0 && isFinite(userLiquidityStatus.liquidity_pool_share)) {
            liquidityPoolShare = userLiquidityStatus.liquidity_pool_share * 100; // Convert to percentage
          } else if (liquidityProvided > 0 && totalLiquidityProvided > 0) {
            // Calculate manually if the backend ratio is invalid
            liquidityPoolShare = (liquidityProvided / totalLiquidityProvided) * 100;
          }
          
          // Ensure we have valid numbers for rewards
          const availableLiquidityReward = Number(userLiquidityStatus.available_liquidity_reward || 0) / 100_000_000;
          const totalAvailableReturns = Number(userLiquidityStatus.total_available_returns || 0) / 100_000_000;
          
          liquidityStatus = {
            liquidityProvided,
            totalLiquidityProvided,
            liquidityPoolShare,
            availableLiquidityReward,
            totalAvailableReturns
          };
        } catch (statusError) {
          console.error('Error fetching liquidity status:', statusError);
          // Keep the default zero values in liquidityStatus
        }
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      errorMessage = 'Failed to load liquidity data';
    } finally {
      isLoading = false;
    }
  }
  
  // Handle providing liquidity
  async function handleProvideLiquidity() {
    if (!isConnected || provideAmount <= 0) return;
    
    actionInProgress = true;
    errorMessage = '';
    successMessage = '';
    
    try {
      // Call protocol service to provide liquidity
      const result = await protocolService.provideLiquidity(provideAmount);
      
      if (result.success) {
        successMessage = `Successfully provided ${formatNumber(provideAmount)} ICP to the liquidity pool`;
        provideAmount = 0;
        // Refresh data
        await fetchData();
      } else {
        errorMessage = result.error || 'Failed to provide liquidity';
      }
    } catch (error) {
      console.error('Error providing liquidity:', error);
      errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    } finally {
      actionInProgress = false;
    }
  }
  
  // Handle withdrawing liquidity
  async function handleWithdrawLiquidity() {
    if (!isConnected || withdrawAmount <= 0 || withdrawAmount > liquidityStatus.liquidityProvided) return;
    
    actionInProgress = true;
    errorMessage = '';
    successMessage = '';
    
    try {
      // Call protocol service to withdraw liquidity
      const result = await protocolService.withdrawLiquidity(withdrawAmount);
      
      if (result.success) {
        successMessage = `Successfully withdrew ${formatNumber(withdrawAmount)} ICP from the liquidity pool`;
        withdrawAmount = 0;
        // Refresh data
        await fetchData();
      } else {
        errorMessage = result.error || 'Failed to withdraw liquidity';
      }
    } catch (error) {
      console.error('Error withdrawing liquidity:', error);
      errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    } finally {
      actionInProgress = false;
    }
  }
  
  // Handle claiming liquidity rewards
  async function handleClaimRewards() {
    if (!isConnected || liquidityStatus.availableLiquidityReward <= 0) return;
    
    actionInProgress = true;
    errorMessage = '';
    successMessage = '';
    
    try {
      // Call protocol service to claim rewards
      const result = await protocolService.claimLiquidityReturns();
      
      if (result.success) {
        successMessage = `Successfully claimed ${formatNumber(liquidityStatus.availableLiquidityReward)} icUSD rewards`;
        // Refresh data
        await fetchData();
      } else {
        errorMessage = result.error || 'Failed to claim rewards';
      }
    } catch (error) {
      console.error('Error claiming rewards:', error);
      errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    } finally {
      actionInProgress = false;
    }
  }
  
  // Calculate values safely
  $: liquidityValueUsd = isFinite(liquidityStatus.liquidityProvided * icpPrice) 
     ? liquidityStatus.liquidityProvided * icpPrice 
     : 0;
  
  $: totalLiquidityValueUsd = isFinite(liquidityStatus.totalLiquidityProvided * icpPrice) 
     ? liquidityStatus.totalLiquidityProvided * icpPrice 
     : 0;
  
  onMount(fetchData);
</script>

<svelte:head>
  <title>RUMI Protocol - Liquidity</title>
</svelte:head>

<div class="container mx-auto px-4 max-w-6xl">
  <section class="mb-12">
    <div class="text-center mb-10">
      <h1 class="text-4xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-pink-400 to-purple-600">
        Liquidity Pool
      </h1>
      <p class="text-xl text-gray-300 max-w-2xl mx-auto">
        Provide liquidity to the RUMI Protocol and earn rewards
      </p>
    </div>
    
    <ProtocolStats />
  </section>
  
  {#if isConnected}
    <!-- User Liquidity Status -->
    <section class="mb-12">
      <div class="glass-card max-w-4xl mx-auto mb-8">
        <h2 class="text-2xl font-semibold mb-6">Your Liquidity Position</h2>
        
        {#if isLoading}
          <div class="flex justify-center py-12">
            <div class="w-8 h-8 border-4 border-t-transparent border-purple-500 rounded-full animate-spin"></div>
          </div>
        {:else}
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="p-4 bg-gray-800/60 rounded-lg">
              <div class="text-sm text-gray-400 mb-1">Your Provided Liquidity</div>
              <div class="text-2xl font-bold">{formatNumber(liquidityStatus.liquidityProvided)} ICP</div>
              <div class="text-sm text-gray-400">≈ ${formatNumber(liquidityValueUsd)}</div>
            </div>
            
            <div class="p-4 bg-gray-800/60 rounded-lg">
              <div class="text-sm text-gray-400 mb-1">Pool Share</div>
              <div class="text-2xl font-bold">{formatNumber(liquidityStatus.liquidityPoolShare)}%</div>
              <div class="text-sm text-gray-400">of total {formatNumber(liquidityStatus.totalLiquidityProvided)} ICP</div>
            </div>
          </div>
          
          <div class="mt-6 p-4 bg-gray-800/60 rounded-lg">
            <div class="flex justify-between items-center mb-2">
              <div class="text-lg font-semibold">Available Rewards</div>
              <button 
                class="px-4 py-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 rounded-lg text-white text-sm"
                disabled={actionInProgress || liquidityStatus.availableLiquidityReward <= 0}
                on:click={handleClaimRewards}
              >
                {actionInProgress ? 'Processing...' : 'Claim Rewards'}
              </button>
            </div>
            <div class="text-xl font-bold">{formatNumber(liquidityStatus.availableLiquidityReward)} icUSD</div>
            <div class="text-sm text-gray-400">System-wide rewards available: {formatNumber(liquidityStatus.totalAvailableReturns)} icUSD</div>
          </div>
        {/if}
      </div>
    </section>
    
    <!-- Provide and Withdraw Liquidity -->
    <section class="mb-16 grid grid-cols-1 md:grid-cols-2 gap-8">
      <!-- Provide Liquidity -->
      <div class="glass-card">
        <h3 class="text-xl font-semibold mb-4">Provide Liquidity</h3>
        
        <div class="space-y-4">
          <div>
            <label for="provide-amount" class="block text-sm font-medium text-gray-300 mb-1">
              ICP Amount
            </label>
            <input
              id="provide-amount"
              type="number"
              bind:value={provideAmount}
              min="0"
              step="0.1"
              class="w-full bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-3 text-white"
              placeholder="0.00"
              disabled={actionInProgress}
            />
          </div>
          
          {#if provideAmount > 0}
            <div class="p-3 bg-gray-800/70 rounded-lg">
              <div class="flex justify-between text-sm">
                <span class="text-gray-300">Value in USD:</span>
                <span class="text-white font-medium">${formatNumber(provideAmount * icpPrice)}</span>
              </div>
            </div>
          {/if}
          
          <button
            class="w-full py-3 px-6 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 rounded-lg text-white font-medium transition-colors disabled:opacity-50"
            on:click={handleProvideLiquidity}
            disabled={actionInProgress || provideAmount <= 0}
          >
            {actionInProgress ? 'Processing...' : 'Provide Liquidity'}
          </button>
        </div>
      </div>
      
      <!-- Withdraw Liquidity -->
      <div class="glass-card">
        <h3 class="text-xl font-semibold mb-4">Withdraw Liquidity</h3>
        
        <div class="space-y-4">
          <div>
            <label for="withdraw-amount" class="block text-sm font-medium text-gray-300 mb-1">
              ICP Amount
            </label>
            <div class="relative">
              <input
                id="withdraw-amount"
                type="number"
                bind:value={withdrawAmount}
                min="0"
                max={liquidityStatus.liquidityProvided}
                step="0.1"
                class="w-full bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-3 text-white"
                placeholder="0.00"
                disabled={actionInProgress}
              />
              <div class="absolute inset-y-0 right-0 flex items-center pr-4 pointer-events-none">
                <span class="text-gray-400">ICP</span>
              </div>
            </div>
            
            {#if isConnected && !isLoading && liquidityStatus.liquidityProvided > 0}
              <div class="text-xs text-right mt-1">
                <button 
                  class="text-blue-400 hover:text-blue-300" 
                  on:click={() => withdrawAmount = liquidityStatus.liquidityProvided}
                  disabled={actionInProgress}
                >
                  Max: {formatNumber(liquidityStatus.liquidityProvided)}
                </button>
              </div>
            {/if}
          </div>
          
          {#if withdrawAmount > 0}
            <div class="p-3 bg-gray-800/70 rounded-lg">
              <div class="flex justify-between text-sm">
                <span class="text-gray-300">Value in USD:</span>
                <span class="text-white font-medium">${formatNumber(withdrawAmount * icpPrice)}</span>
              </div>
            </div>
          {/if}
          
          <button
            class="w-full py-3 px-6 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 rounded-lg text-white font-medium transition-colors disabled:opacity-50"
            on:click={handleWithdrawLiquidity}
            disabled={actionInProgress || withdrawAmount <= 0 || withdrawAmount > liquidityStatus.liquidityProvided}
          >
            {actionInProgress ? 'Processing...' : 'Withdraw Liquidity'}
          </button>
        </div>
      </div>
    </section>
    
    {#if errorMessage}
      <div class="p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-200 text-sm mt-6">
        {errorMessage}
      </div>
    {/if}
    
    {#if successMessage}
      <div class="p-3 bg-green-900/30 border border-green-800 rounded-lg text-green-200 text-sm mt-6">
        {successMessage}
      </div>
    {/if}
  {/if}
  
  <section class="mb-16">
    <div class="max-w-4xl mx-auto">
      <h2 class="text-2xl font-semibold mb-6 text-center">How The Liquidity Pool Works</h2>
      
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div class="glass-card h-full">
          <div class="text-pink-400 text-3xl font-bold mb-2">1</div>
          <h3 class="text-lg font-medium mb-2">Provide Liquidity</h3>
          <p class="text-gray-300">Deposit your ICP tokens to the protocol's liquidity pool.</p>
        </div>
        
        <div class="glass-card h-full">
          <div class="text-pink-400 text-3xl font-bold mb-2">2</div>
          <h3 class="text-lg font-medium mb-2">Earn Returns</h3>
          <p class="text-gray-300">Earn a share of protocol fees proportional to your contribution.</p>
        </div>
        
        <div class="glass-card h-full">
          <div class="text-pink-400 text-3xl font-bold mb-2">3</div>
          <h3 class="text-lg font-medium mb-2">Withdraw Anytime</h3>
          <p class="text-gray-300">Withdraw your liquidity and claim your earned rewards when you want.</p>
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