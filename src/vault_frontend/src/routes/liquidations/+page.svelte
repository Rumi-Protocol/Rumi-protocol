<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { walletStore as wallet } from "$lib/stores/wallet";
  import { protocolService } from '$lib/services/protocol';
  import { formatNumber } from '$lib/utils/format';
  import ProtocolStats from '$lib/components/dashboard/ProtocolStats.svelte';
  import StabilityPoolCard from '$lib/components/stability/StabilityPoolCard.svelte';
  import { tweened } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import type { CandidVault } from '$lib/services/types';
  import { walletOperations } from "$lib/services/protocol/walletOperations";
  import { CONFIG } from "$lib/config";

  let liquidatableVaults: CandidVault[] = [];
  let icpPrice = 0;
  let isLoading = true;
  let isPriceLoading = true;
  let liquidationError = "";
  let liquidationSuccess = "";
  let processingVaultId: number | null = null;
  let isApprovingAllowance = false;
  
  $: isConnected = $wallet.isConnected;
  
  // Setup animated price display
  let animatedPrice = tweened(0, {
    duration: 600,
    easing: cubicOut
  });
  
  // Update animated price whenever icpPrice changes
  $: if (icpPrice > 0) {
    animatedPrice.set(icpPrice);
  }
  
  // Calculate collateral ratio for each vault
  function calculateCollateralRatio(vault: CandidVault): number {
  // Ensure we have valid numbers and prevent division by zero
  const icpAmount = Number(vault.icp_margin_amount || 0) / 100_000_000;
  const icusdAmount = Number(vault.borrowed_icusd_amount || 0) / 100_000_000;
  const currentPrice = icpPrice || 0;
  
  // Calculate collateral value in USD
  const icpValue = icpAmount * currentPrice;
  
  // Safe division
  if (icusdAmount <= 0) return Infinity;
  
  const ratio = (icpValue / icusdAmount) * 100;
  
  // Handle potential NaN or infinity results
  return isFinite(ratio) ? ratio : 0;
}
  
  // Calculate liquidation profit for a vault
  function calculateLiquidationProfit(vault: CandidVault): { icpAmount: number, profitUsd: number } {
  // Ensure we have valid numbers
  const icusdDebt = Number(vault.borrowed_icusd_amount || 0) / 100_000_000;
  const icpCollateral = Number(vault.icp_margin_amount || 0) / 100_000_000;
  const currentPrice = icpPrice || 1; // Fallback to 1 to avoid division by zero
  
  // Calculate how much ICP the liquidator would receive
  // (accounting for 10% discount - liquidator pays debt and gets collateral at 90% of value)
  let icpReceived = 0;
  if (currentPrice > 0) {
    icpReceived = icusdDebt / currentPrice * (1 / 0.9);
  }
  
  // Can't receive more than available collateral
  const icpToReceive = Math.min(icpReceived, icpCollateral);
  
  // Calculate profit (value of ICP received minus cost paid in icUSD)
  const profitUsd = (icpToReceive * currentPrice) - icusdDebt;
  
  return {
    icpAmount: isFinite(icpToReceive) ? icpToReceive : 0,
    profitUsd: isFinite(profitUsd) ? profitUsd : 0
  };
}
  
  // Load liquidatable vaults
  async function loadLiquidatableVaults() {
  isLoading = true;
  liquidationError = "";
  
  try {
    const vaults = await protocolService.getLiquidatableVaults();
    liquidatableVaults = vaults.map(vault => {
      // Safely convert BigInt values to Numbers, defaulting to 0 for invalid values
      const icpMarginAmount = Number(vault.icp_margin_amount || 0);
      const borrowedIcusdAmount = Number(vault.borrowed_icusd_amount || 0);
      const vaultId = Number(vault.vault_id || 0);
      
      return {
        ...vault,
        // Store original values
        original_icp_margin_amount: vault.icp_margin_amount,
        original_borrowed_icusd_amount: vault.borrowed_icusd_amount,
        // Convert to Numbers for UI handling
        icp_margin_amount: icpMarginAmount,
        borrowed_icusd_amount: borrowedIcusdAmount,
        vault_id: vaultId,
        // Add metadata for display
        owner: vault.owner.toString()
      };
    });
    console.log("Liquidatable vaults loaded:", liquidatableVaults);
  } catch (error) {
    console.error("Error loading liquidatable vaults:", error);
    liquidationError = "Failed to load liquidatable vaults. Please try again.";
  } finally {
    isLoading = false;
  }
}
  
  // Check if the user has sufficient icUSD allowance for liquidation
  async function checkAndApproveAllowance(vaultId: number, icusdAmount: number): Promise<boolean> {
    try {
      isApprovingAllowance = true;
      
      // Convert amount to e8s (8 decimal places)
      const amountE8s = BigInt(Math.floor(icusdAmount * 100_000_000));
      const spenderCanisterId = CONFIG.currentCanisterId;
      
      // Check current allowance
      const currentAllowance = await walletOperations.checkIcusdAllowance(spenderCanisterId);
      console.log(`Current icUSD allowance: ${Number(currentAllowance) / 100_000_000}`);
      
      // If allowance is insufficient, request approval
      if (currentAllowance < amountE8s) {
        console.log(`Setting icUSD approval for ${icusdAmount}`);
        
        // Request approval with a significant buffer (50% more) to handle any fees or calculation differences
        const approvalAmount = amountE8s * BigInt(150) / BigInt(100);
        const approvalResult = await walletOperations.approveIcusdTransfer(
          approvalAmount, 
          spenderCanisterId
        );
        
        if (!approvalResult.success) {
          liquidationError = approvalResult.error || "Failed to approve icUSD transfer";
          return false;
        }
        
        console.log(`Successfully approved ${Number(approvalAmount) / 100_000_000} icUSD`);
        
        // Short pause to ensure approval transaction is processed
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      return true;
    } catch (error) {
      console.error("Error checking/approving allowance:", error);
      liquidationError = "Failed to approve icUSD transfer. Please try again.";
      return false;
    } finally {
      isApprovingAllowance = false;
    }
  }
  
  // Function to perform liquidation
  async function liquidateVault(vaultId: number) {
  if (!isConnected) {
    liquidationError = "Please connect your wallet to liquidate vaults";
    return;
  }
  
  if (processingVaultId !== null) {
    return; // Already processing a liquidation
  }
  
  const vault = liquidatableVaults.find(v => v.vault_id === vaultId);
  if (!vault) {
    liquidationError = "Vault not found";
    return;
  }
  
  liquidationError = "";
  liquidationSuccess = "";
  processingVaultId = vaultId;
  
  try {
    // Check if user has sufficient icUSD balance
    const icusdDebt = Number(vault.borrowed_icusd_amount) / 100_000_000;
    const icusdBalance = await walletOperations.getIcusdBalance();
    
    if (icusdBalance < icusdDebt) {
      liquidationError = `Insufficient icUSD balance. You need ${formatNumber(icusdDebt)} icUSD but have ${formatNumber(icusdBalance)} icUSD.`;
      processingVaultId = null;
      return;
    }
    
    // Increase buffer to 20% to handle potential calculation differences
    const bufferedDebt = icusdDebt * 1.20;
    
    // Check and set allowance for icUSD with extra buffer
    const allowanceApproved = await checkAndApproveAllowance(vaultId, bufferedDebt);
    if (!allowanceApproved) {
      processingVaultId = null;
      return;
    }
    
    // Get latest vaults data before liquidation to ensure we have fresh data
    await loadLiquidatableVaults();
    
    // Re-check that the vault is still available for liquidation
    const updatedVault = liquidatableVaults.find(v => v.vault_id === vaultId);
    if (!updatedVault) {
      liquidationError = "This vault is no longer available for liquidation";
      processingVaultId = null;
      return;
    }
    
    console.log(`Liquidating vault #${vaultId}`);
    const result = await protocolService.liquidateVault(vaultId);
    
    if (result.success) {
      liquidationSuccess = `Successfully liquidated vault #${vaultId}. You paid ${formatNumber(icusdDebt)} icUSD and received approximately ${formatNumber(calculateLiquidationProfit(vault).icpAmount)} ICP.`;
      // Refresh the list of liquidatable vaults
      await loadLiquidatableVaults();
    } else {
      liquidationError = result.error || "Liquidation failed for unknown reason";
    }
  } catch (error) {
    console.error("Error during liquidation:", error);
    
    // Check for specific underflow error
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('underflow') && errorMessage.includes('numeric.rs')) {
      liquidationError = "Liquidation failed due to a calculation error. The vault may have already been liquidated or its state has changed.";
    } else {
      liquidationError = errorMessage;
    }
  } finally {
    processingVaultId = null;
  }
}
  
  // Load ICP price
  async function refreshIcpPrice() {
    try {
      isPriceLoading = true;
      const price = await protocolService.getICPPrice();
      if (price > 0) {
        icpPrice = price;
      } else {
        // If price is 0 or invalid, use mock price
        console.log('Invalid price received, using mock ICP price for local testing');
        icpPrice = 10.0;
      }
    } catch (error) {
      console.error("Error fetching ICP price:", error);
      // For local testing, always set a mock price when fetching fails
      console.log('Price fetch failed, using mock ICP price for local testing');
      icpPrice = 10.0; // $10.00 mock price for testing
    } finally {
      isPriceLoading = false;
    }
  }
  
  // Initial data loading
  onMount(() => {
    refreshIcpPrice();
    loadLiquidatableVaults();
    
    // Set up regular refresh intervals
    const priceInterval = setInterval(refreshIcpPrice, 30000); // Every 30 seconds
    const vaultsInterval = setInterval(loadLiquidatableVaults, 60000); // Every minute
    
    return () => {
      clearInterval(priceInterval);
      clearInterval(vaultsInterval);
    };
  });
  
  onDestroy(() => {
    // This is handled by the return function in onMount, but added for clarity
  });
</script>

<svelte:head>
  <title>RUMI Protocol - Liquidations</title>
</svelte:head>

<div class="container mx-auto px-4 max-w-6xl">
  <section class="mb-8">
    <div class="text-center mb-8">
      <h1 class="text-4xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-pink-400 to-purple-600">
        Liquidations
      </h1>
      <p class="text-xl text-gray-300 max-w-3xl mx-auto">
        Earn liquidation profits through automated community pool participation or individual vault liquidations
      </p>
    </div>

    <ProtocolStats />
  </section>

  <!-- Stability Pool Section -->
  <section class="mb-12">
    <StabilityPoolCard />
  </section>
  
  <!-- Current ICP Price Display -->
  <div class="mb-8 bg-gray-900/50 p-6 rounded-lg shadow-lg backdrop-blur-sm ring-2 ring-purple-400">
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-2xl font-bold">Current ICP Price</h2>
      <div class="flex items-center gap-2">
        <button 
          class="p-1 bg-gray-800/50 rounded-full hover:bg-gray-800 transition-colors"
          on:click={refreshIcpPrice}
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
      </div>
    {:else if isPriceLoading}
      <div class="flex items-center gap-2">
        <div class="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
        <span>Loading price...</span>
      </div>
    {:else}
      <p class="text-xl text-yellow-500">Price unavailable</p>
    {/if}
  </div>

  <!-- Manual Liquidations Section -->
  <section class="mb-12">
    <div class="glass-card">
      <div class="flex justify-between items-center mb-6">
        <div>
          <h2 class="text-2xl font-semibold">Manual Liquidations</h2>
          <p class="text-gray-400 text-sm mt-1">Liquidate individual vaults directly for immediate profit</p>
        </div>
        <button 
          class="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-500 transition-colors"
          on:click={loadLiquidatableVaults}
          disabled={isLoading}
        >
          {isLoading ? 'Loading...' : 'Refresh Vaults'}
        </button>
      </div>
      
      {#if !isConnected}
        <div class="p-4 mb-6 bg-yellow-900/30 border border-yellow-800 rounded-lg text-yellow-200">
          <p>Please connect your wallet to liquidate vaults. You'll need icUSD to pay off the vault debt.</p>
        </div>
      {/if}
      
      {#if liquidationError}
        <div class="p-4 mb-6 bg-red-900/30 border border-red-800 rounded-lg text-red-200">
          <p>{liquidationError}</p>
        </div>
      {/if}
      
      {#if liquidationSuccess}
        <div class="p-4 mb-6 bg-green-900/30 border border-green-800 rounded-lg text-green-200">
          <p>{liquidationSuccess}</p>
        </div>
      {/if}
      
      {#if isLoading}
        <div class="flex justify-center items-center py-12">
          <div class="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      {:else if liquidatableVaults.length === 0}
        <div class="text-center py-12 bg-gray-800/30 rounded-lg">
          <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 class="mt-2 text-xl font-medium text-gray-300">No liquidatable vaults</h3>
          <p class="mt-1 text-gray-400">All vaults are currently healthy with sufficient collateral ratios.</p>
        </div>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-gray-700">
                <th class="px-4 py-3 text-left text-sm font-medium text-gray-400">Vault ID</th>
                <th class="px-4 py-3 text-left text-sm font-medium text-gray-400">Debt (icUSD)</th>
                <th class="px-4 py-3 text-left text-sm font-medium text-gray-400">Collateral (ICP)</th>
                <th class="px-4 py-3 text-left text-sm font-medium text-gray-400">Coll. Ratio</th>
                <th class="px-4 py-3 text-left text-sm font-medium text-gray-400">Profit Potential</th>
                <th class="px-4 py-3 text-right text-sm font-medium text-gray-400">Action</th>
              </tr>
            </thead>
            <tbody>
              {#each liquidatableVaults as vault (vault.vault_id)}
                {@const collateralRatio = calculateCollateralRatio(vault)}
                {@const profit = calculateLiquidationProfit(vault)}
                <tr class="border-b border-gray-800 hover:bg-gray-800/30">
                  <td class="px-4 py-4">{vault.vault_id}</td>
                  <td class="px-4 py-4">{formatNumber(vault.borrowed_icusd_amount / 100_000_000)} icUSD</td>
                  <td class="px-4 py-4">{formatNumber(vault.icp_margin_amount / 100_000_000)} ICP</td>
                  <td class="px-4 py-4">
                    <span class="text-red-400">{formatNumber(collateralRatio)}%</span>
                  </td>
                  <td class="px-4 py-4">
                    <div class="flex flex-col">
                      <span>{formatNumber(profit.icpAmount)} ICP</span>
                      <span class="text-green-400">≈ ${formatNumber(profit.profitUsd)}</span>
                    </div>
                  </td>
                  <td class="px-4 py-4 text-right">
                    <button 
                      class="px-4 py-2 bg-pink-600 text-white rounded hover:bg-pink-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      on:click={() => liquidateVault(vault.vault_id)}
                      disabled={processingVaultId !== null || !isConnected || isApprovingAllowance}
                    >
                      {#if processingVaultId === vault.vault_id}
                        {#if isApprovingAllowance}
                          <span class="flex items-center gap-2">
                            <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            Approving icUSD...
                          </span>
                        {:else}
                          <span class="flex items-center gap-2">
                            <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            Liquidating...
                          </span>
                        {/if}
                      {:else}
                        Liquidate
                      {/if}
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  </section>
  
  <!-- How Liquidations Work Section -->
  <section class="mb-16">
    <div class="max-w-4xl mx-auto">
      <h2 class="text-2xl font-semibold mb-6 text-center">How Liquidations Work</h2>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div class="glass-card h-full">
          <div class="text-pink-400 text-3xl font-bold mb-2">1</div>
          <h3 class="text-lg font-medium mb-2">Find Opportunities</h3>
          <p class="text-gray-300">Browse vaults with collateral ratios below the required threshold (133% in normal mode, 150% in recovery mode).</p>
        </div>

        <div class="glass-card h-full">
          <div class="text-pink-400 text-3xl font-bold mb-2">2</div>
          <h3 class="text-lg font-medium mb-2">Pay the Debt</h3>
          <p class="text-gray-300">Pay the full debt amount in icUSD to liquidate the vault. Ensure you have sufficient icUSD in your wallet.</p>
        </div>

        <div class="glass-card h-full">
          <div class="text-pink-400 text-3xl font-bold mb-2">3</div>
          <h3 class="text-lg font-medium mb-2">Receive Collateral</h3>
          <p class="text-gray-300">Get the vault's ICP collateral with a 10% discount compared to the current market price, generating profit.</p>
        </div>
      </div>
    </div>
  </section>
</div>

<style>
  /* Add glass card styling */
  .glass-card {
    background-color: rgba(31, 41, 55, 0.4);
    backdrop-filter: blur(16px);
    border: 1px solid rgba(75, 85, 99, 0.5);
    border-radius: 0.5rem;
    padding: 1.5rem;
  }
</style>