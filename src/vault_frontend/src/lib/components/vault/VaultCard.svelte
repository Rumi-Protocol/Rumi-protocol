<script lang="ts">
  import { formatNumber, formatPercent } from "../../utils/format";
  import { onMount } from "svelte";
  import { developerAccess } from '../../stores/developer';
  import type { Vault } from '../../services/types';
  import { CollateralType } from '../../services/types';
  import { protocolService } from '../../services/protocol';
  import { createEventDispatcher } from 'svelte';

  
  // Proper typing for the vault prop
  export let vault: Vault;
  export let icpPrice: number = 0;
  export let ckbtcPrice: number = 94500; // Default fallback
  export let showActions: boolean = true;
  
  const dispatch = createEventDispatcher<{
    select: { vaultId: number };
    manage: { vaultId: number };
  }>();
  
  // Determine collateral type and related calculations
  $: collateralType = vault.collateralType || CollateralType.ICP;
  $: isIcp = collateralType === CollateralType.ICP;
  $: collateralAmount = isIcp ? vault.icpMargin : vault.ckbtcMargin;
  $: collateralPrice = isIcp ? icpPrice : ckbtcPrice;
  $: collateralSymbol = isIcp ? 'ICP' : 'ckBTC';
  
  // Calculate display values with proper reactivity
  $: collateralValueUsd = collateralAmount * collateralPrice;
  $: collateralRatio = vault.borrowedIcusd > 0 
    ? collateralValueUsd / vault.borrowedIcusd 
    : Infinity;
  $: minCollateralRatio = 1.33; // 133%
  $: dangerThreshold = 1.4; // 140%
  $: warningThreshold = 1.6; // 160%
  $: vaultHealthStatus = getVaultHealthStatus(collateralRatio);
  $: maxBorrowable = (collateralValueUsd / minCollateralRatio) - vault.borrowedIcusd;
  
  // Format display values
  $: formattedCollateralValue = formatNumber(collateralValueUsd, 2);
  $: formattedMargin = formatNumber(collateralAmount, isIcp ? 4 : 8); // Different precision for ckBTC
  $: formattedBorrowedAmount = formatNumber(vault.borrowedIcusd);
  $: formattedMaxBorrowable = formatNumber(Math.max(0, maxBorrowable), 2);
  $: formattedCollateralRatio = collateralRatio === Infinity 
    ? "∞" 
    : formatPercent(collateralRatio);
  
  // Function to determine vault health status
  function getVaultHealthStatus(ratio: number): 'healthy' | 'warning' | 'danger' {
    if (ratio === Infinity || ratio >= warningThreshold) return 'healthy';
    if (ratio >= dangerThreshold) return 'warning';
    return 'danger';
  }
  
  // Function to handle vault selection
  function handleSelect() {
    dispatch('select', { vaultId: vault.vaultId });
  }
  
  // Function to handle manage action
  function handleManage() {
    dispatch('manage', { vaultId: vault.vaultId });
  }

  let mintAmount = ""; // Amount to mint
  let addCollateralAmount = ""; // Amount to add as collateral
  let withdrawCollateralAmount = ""; // Amount to withdraw
  let isProcessing = false; // Tracks loading state
  let error = ""; // Tracks errors for user feedback
  let isWithdrawingCollateral = false; // Track collateral withdrawal state

  let showPasskeyInput = false;
  let passkey = "";
  let passkeyError = "";

  function handlePasskeySubmit() {
    const isValid = developerAccess.checkPasskey(passkey);
    if (!isValid) {
      passkeyError = "Invalid passkey";
    } else {
      showPasskeyInput = false;
      passkeyError = "";
    }
  }

  $: isDeveloper = $developerAccess;
  // Check if collateral can be withdrawn (has collateral, no matter the debt)
  $: hasCollateral = collateralAmount > 0;

  // Helper methods for handling vault interactions
  async function handleMint() {
    try {
      isProcessing = true;
      error = "";
      const amount = parseFloat(mintAmount);
      // Use borrowFromVault instead of non-existent mintIcUSD
      await protocolService.borrowFromVault(Number(vault.vaultId), amount);
      mintAmount = "";
    } catch (err) {
      console.error("Mint error:", err);
      if (err instanceof Error) {
        error = err.message || "Failed to mint icUSD.";
      } else {
        error = "Failed to mint icUSD.";
      }
    } finally {
      isProcessing = false;
    }
  }

  async function handleAddCollateral() {
    try {
      isProcessing = true;
      error = "";
      const amount = parseFloat(addCollateralAmount);
      await protocolService.addMarginToVault(Number(vault.vaultId), amount);
      addCollateralAmount = "";
    } catch (err) {
      console.error("Add collateral error:", err);
      if (err instanceof Error) {
        error = err.message || "Failed to add collateral.";
      } else {
        error = "Failed to add collateral.";
      }
    } finally {
      isProcessing = false;
    }
  }

  // Replace the handleWithdrawCollateral function with a working implementation
  async function handleWithdrawCollateral() {
    try {
      isProcessing = true;
      isWithdrawingCollateral = true;
      error = "";
      
      // Check if there's still debt
      if (Number(vault.borrowedIcusd) > 0) {
        error = `Cannot withdraw collateral while you have outstanding debt. Please repay all borrowed icUSD first.`;
        return;
      }
      
      // Call the actual withdrawCollateral method
      const result = await protocolService.withdrawCollateral(Number(vault.vaultId));
      
      if (result.success) {
        // Update the UI state locally
        vault.icpMargin = 0;
        console.log("Collateral withdrawn successfully");
      } else {
        error = result.error || "Failed to withdraw collateral.";
      }
    } catch (err) {
      console.error("Withdraw collateral error:", err);
      if (err instanceof Error) {
        error = err.message || "Failed to withdraw collateral.";
      } else {
        error = "Failed to withdraw collateral.";
      }
    } finally {
      isProcessing = false;
      isWithdrawingCollateral = false;
    }
  }

  async function handleCloseVault() {
    try {
      isProcessing = true;
      error = "";
      await protocolService.closeVault(Number(vault.vaultId));
    } catch (err) {
      console.error("Close vault error:", err);
      if (err instanceof Error) {
        error = err.message || "Failed to close vault.";
      } else {
        error = "Failed to close vault.";
      }
    } finally {
      isProcessing = false;
    }
  }

  // Format icUSD balance properly 
  $: icusdBalance = vault.borrowedIcusd ? 
      formatNumber(Number(vault.borrowedIcusd) / 100_000_000) : "0";

  onMount(() => {
    // Add debugging to check received data
    console.log(`VaultCard mounted for vault #${vault.vaultId}:`, {
      vaultId: vault.vaultId,
      collateralType: vault.collateralType,
      icpMargin: vault.icpMargin,
      ckbtcMargin: vault.ckbtcMargin,
      borrowedIcusd: vault.borrowedIcusd,
      typeof_icpMargin: typeof vault.icpMargin,
      typeof_ckbtcMargin: typeof vault.ckbtcMargin,
      typeof_borrowedIcusd: typeof vault.borrowedIcusd
    });
  });
</script>

<div 
  class="relative bg-gray-800/40 backdrop-blur-sm border rounded-lg overflow-hidden transition-all duration-200 hover:shadow-lg"
  class:border-green-500={vaultHealthStatus === 'healthy'}
  class:border-yellow-500={vaultHealthStatus === 'warning'}
  class:border-red-500={vaultHealthStatus === 'danger'}
  class:border-gray-700={!vaultHealthStatus}
>
  <!-- Health status indicator -->
  <div 
    class="absolute top-0 right-0 h-6 w-6 transform translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-gray-800"
    class:bg-green-500={vaultHealthStatus === 'healthy'}
    class:bg-yellow-500={vaultHealthStatus === 'warning'}
    class:bg-red-500={vaultHealthStatus === 'danger'}
    class:bg-gray-500={!vaultHealthStatus}
  ></div>
  
  <!-- Vault header -->
  <div class="p-5 border-b border-gray-700">
    <div class="flex justify-between items-center">
      <h3 class="text-xl font-bold">Vault #{vault.vaultId}</h3>
      <span class="text-sm text-gray-400">
        Collateral Ratio: {formattedCollateralRatio}
      </span>
    </div>
  </div>
  
  <!-- Vault data -->
  <div class="p-5">
    <div class="grid grid-cols-2 gap-4 mb-4">
      <div>
        <div class="text-sm text-gray-400 mb-1">Collateral ({collateralSymbol})</div>
        <div class="text-lg font-semibold">{formattedMargin} {collateralSymbol}</div>
        <div class="text-sm text-gray-400">${formattedCollateralValue}</div>
      </div>
      
      <div>
        <div class="text-sm text-gray-400 mb-1">Borrowed</div>
        <div class="text-lg font-semibold">{formattedBorrowedAmount} icUSD</div>
        <div class="text-sm text-gray-400">${formattedBorrowedAmount}</div>
      </div>
    </div>
    
    <!-- Available to borrow -->
    {#if maxBorrowable > 0}
      <div class="mt-2 mb-4">
        <div class="text-sm text-gray-400 mb-1">Available to borrow</div>
        <div class="text-md font-medium text-green-400">{formattedMaxBorrowable} icUSD</div>
      </div>
    {/if}
    
    <!-- Action buttons -->
    {#if showActions}
      <div class="flex justify-end gap-2 mt-4">
        <button 
          on:click={handleSelect}
          class="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-md"
        >
          View Details
        </button>
      </div>
    {/if}
  </div>
</div>

<div class="flex flex-col gap-4 mt-4">
  <!-- Show passkey input if not developer -->
  {#if !isDeveloper}
    <div class="mb-4">
      {#if showPasskeyInput}
        <div class="flex gap-2">
          <input
            type="password"
            bind:value={passkey}
            placeholder="Enter developer passkey"
            class="input"
          />
          <button class="btn" on:click={handlePasskeySubmit}>Submit</button>
        </div>
        {#if passkeyError}
          <p class="text-red-500 text-sm mt-1">{passkeyError}</p>
        {/if}
      {:else}
        <button
          class="text-xs text-gray-500 hover:text-gray-400"
          on:click={() => showPasskeyInput = true}
        >
          Developer Access
        </button>
      {/if}
    </div>
  {/if}


</div>

<style>
  .input {
    background: #2d3748;
    color: white;
    padding: 0.5rem;
    border-radius: 0.25rem;
    width: 100%;
  }
  .btn {
    background: #4a5568;
    color: white;
    padding: 0.5rem 1rem;
    border-radius: 0.25rem;
    cursor: pointer;
  }
  .btn:hover {
    background: #2d3748;
  }
  .loader {
    width: 2rem;
    height: 2rem;
    border: 4px solid #4a5568;
    border-top: 4px solid transparent;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }
</style>
