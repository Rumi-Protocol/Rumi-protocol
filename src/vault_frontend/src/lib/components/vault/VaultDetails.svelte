<script lang="ts">
  import { goto } from '$app/navigation';
  import { formatNumber } from '$lib/utils/format';
  import { protocolService } from '$lib/services/protocol';
  import type { Vault } from '$lib/services/types';
  import { onMount, onDestroy } from 'svelte';
  import { createEventDispatcher } from 'svelte';
  import { vaultStore } from '$lib/stores/vaultStore';
  import { walletOperations } from '$lib/services/protocol/walletOperations';
  import { protocolManager } from '$lib/services/ProtocolManager';
  import { CONFIG } from '$lib/config';
  
  // Change this to accept vaultId instead of the full vault object
  export let vaultId: number;
  export let icpPrice: number;
  
  // Create reactive binding to the vault from the store
  // This will automatically update when the vault changes in the store
  $: currentVault = $vaultStore.vaults.find(v => v.vaultId === vaultId);
  
  let isLoading = false;
  let addMarginAmount = 0;
  let borrowAmount = 0;
  let repayAmount = 0;
  let errorMessage = '';
  let successMessage = '';
  let isAddingMargin = false;
  let isBorrowing = false;
  let isRepaying = false;
  let isApproving = false;
  let isClosing = false;
  let closeError = '';
  let closeSuccess = false;
  let showClosingConfirmation = false;
  let transferInProgress = false;
  let currentAllowance = 0;
  let isResettingOperations = false;
  let isWithdrawingCollateral = false;
  $: showCollectButton = currentVault && currentVault.icpMargin > 0;
  let isWithdrawingAndClosing = false;
  
  const dispatch = createEventDispatcher();
  const E8S = 100_000_000;
  
  // Change all reactive declarations to use currentVault instead of vault
  $: collateralValueUsd = currentVault ? currentVault.icpMargin * icpPrice : 0;
  $: collateralRatio = currentVault && currentVault.borrowedIcusd > 0 
    ? collateralValueUsd / currentVault.borrowedIcusd 
    : Infinity;
  $: minCollateralRatio = 1.33;
  $: warningCollateralRatio = 1.5;
  $: maxBorrowable = currentVault && currentVault.borrowedIcusd > 0 
    ? (collateralValueUsd / minCollateralRatio) - currentVault.borrowedIcusd
    : collateralValueUsd / minCollateralRatio;
  $: vaultHealthStatus = getVaultHealthStatus(collateralRatio);
  $: canWithdraw = currentVault && currentVault.borrowedIcusd === 0 && currentVault.icpMargin > 0;
  $: canClose = currentVault && currentVault.borrowedIcusd === 0;
  
  // Format display values
  $: formattedCollateralValue = formatNumber(collateralValueUsd, 2);
  $: formattedMargin = currentVault ? formatNumber(currentVault.icpMargin) : '0';
  $: formattedBorrowedAmount = currentVault ? formatNumber(currentVault.borrowedIcusd) : '0';
  $: formattedCollateralRatio = collateralRatio === Infinity 
    ? "∞" 
    : `${(collateralRatio * 100).toFixed(1)}%`;
  
  function getVaultHealthStatus(ratio: number): 'healthy' | 'warning' | 'danger' {
    if (ratio === Infinity || ratio >= warningCollateralRatio) return 'healthy';
    if (ratio >= minCollateralRatio) return 'warning';
    return 'danger';
  }
  
  // Update handleAddMargin to use currentVault
  async function handleAddMargin() {
    if (!currentVault) return;
    if (addMarginAmount <= 0) {
      errorMessage = "Please enter a valid amount";
      return;
    }
    
    try {
      isAddingMargin = true;
      errorMessage = '';
      successMessage = '';
      
      // First check and request ICP approval if needed
      const amountE8s = BigInt(Math.floor(addMarginAmount * E8S));
      const spenderCanisterId = CONFIG.currentCanisterId;
      
      // Set approval state to show user what's happening
      isApproving = true;
      
      // Check current allowance
      const currentAllowance = await protocolService.checkIcpAllowance(spenderCanisterId);
      console.log('Current ICP allowance:', currentAllowance.toString());
      
      // If allowance is insufficient, request approval with 20% buffer
      if (currentAllowance < amountE8s) {
        const bufferAmount = amountE8s * BigInt(120) / BigInt(100); // 20% buffer
        console.log('Requesting approval for:', bufferAmount.toString());
        
        const approvalResult = await protocolService.approveIcpTransfer(
          bufferAmount,
          spenderCanisterId
        );
        
        if (!approvalResult.success) {
          errorMessage = approvalResult.error || 'Failed to approve ICP transfer';
          isAddingMargin = false;
          isApproving = false;
          return;
        }
        
        // Short delay to allow approval to be processed
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      // Reset approval state
      isApproving = false;
      
      // Now proceed with adding margin
      const result = await protocolService.addMarginToVault(currentVault.vaultId, addMarginAmount);
      
      if (result.success) {
        successMessage = `Successfully added ${addMarginAmount} ICP to vault`;
        
        // Reset input
        addMarginAmount = 0;
        
        // Explicitly refresh this vault to ensure UI is updated
        await vaultStore.refreshVault(currentVault.vaultId);
      } else {
        errorMessage = result.error || "Failed to add margin";
      }
    } catch (err) {
      console.error('Error adding margin:', err);
      errorMessage = err instanceof Error ? err.message : "Unknown error";
    } finally {
      isAddingMargin = false;
      isApproving = false;
    }
  }
  
  // Update handleBorrow to use currentVault
  async function handleBorrow() {
    if (!currentVault) return;
    if (borrowAmount <= 0) {
      errorMessage = "Please enter a valid amount";
      return;
    }
    
    if (borrowAmount > maxBorrowable) {
      errorMessage = `Maximum borrowable amount is ${maxBorrowable.toFixed(2)} icUSD`;
      return;
    }
    
    try {
      isBorrowing = true;
      errorMessage = '';
      successMessage = '';
      
      // Call protocol service to borrow
      const result = await protocolService.borrowFromVault(currentVault.vaultId, borrowAmount);
      
      if (result.success) {
        successMessage = `Successfully borrowed ${borrowAmount} icUSD`;
        
        // Reset input
        borrowAmount = 0;
        
        // Explicitly refresh this vault to ensure UI is updated
        await vaultStore.refreshVault(currentVault.vaultId);
      } else {
        errorMessage = result.error || "Failed to borrow";
      }
    } catch (err) {
      console.error('Error borrowing:', err);
      errorMessage = err instanceof Error ? err.message : "Unknown error";
    } finally {
      isBorrowing = false;
    }
  }
  
  // Update handleRepay to use currentVault
  async function handleRepay() {
    if (!currentVault) return;
    if (repayAmount <= 0 || !isFinite(repayAmount)) {
      errorMessage = "Please enter a valid amount";
      return;
    }
    
    if (!isFinite(currentVault.borrowedIcusd) || repayAmount > currentVault.borrowedIcusd) {
      errorMessage = `You can only repay up to ${currentVault.borrowedIcusd} icUSD`;
      return;
    }
    
    try {
      isRepaying = true;
      isApproving = false;
      errorMessage = '';
      successMessage = '';
      
      // SIMPLIFIED: Let the ProtocolManager handle approval logic completely
      // This eliminates duplicate approval requests and race conditions
      console.log(`🔄 Starting repayment of ${repayAmount} icUSD to vault ${currentVault.vaultId}`);
      
      // Call protocol manager directly - it will handle all approval logic internally
      const result = await protocolManager.repayToVault(currentVault.vaultId, repayAmount);
      
      if (result.success) {
        successMessage = `Successfully repaid ${repayAmount} icUSD`;
        
        // Reset input
        repayAmount = 0;
        
        // Wait a moment for transaction to settle
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Explicitly refresh this vault to ensure UI is updated
        await vaultStore.refreshVault(currentVault.vaultId);
      } else {
        errorMessage = result.error || "Failed to repay";
      }
    } catch (err) {
      console.error('Error repaying:', err);
      errorMessage = err instanceof Error ? err.message : "Unknown error";
    } finally {
      isRepaying = false;
      isApproving = false;
    }
  }

  // Handle partial repayment
  async function handlePartialRepay() {
    if (!currentVault) return;
    if (repayAmount <= 0) {
      errorMessage = "Please enter a valid amount";
      return;
    }
    
    if (repayAmount > currentVault.borrowedIcusd) {
      errorMessage = `You can only repay up to ${currentVault.borrowedIcusd} icUSD`;
      return;
    }
    
    try {
      isRepaying = true;
      isApproving = false;
      errorMessage = '';
      successMessage = '';
      
      // Check approval first
      const amountE8s = BigInt(Math.floor(repayAmount * E8S));
      const spenderCanisterId = CONFIG.currentCanisterId;
      currentAllowance = Number(await protocolService.checkIcusdAllowance(spenderCanisterId));
      
      // If approval is needed
      if (currentAllowance < Number(amountE8s)) {
        isApproving = true;
        
        // Request approval
        const approvalResult = await protocolService.approveIcusdTransfer(
          amountE8s, 
          spenderCanisterId
        );
        
        if (!approvalResult.success) {
          errorMessage = approvalResult.error || "Failed to approve icUSD transfer";
          isRepaying = false;
          isApproving = false;
          return;
        }
        
        isApproving = false;
      }
      
      // Call protocol service for partial repayment
      const result = await protocolService.partialRepayToVault(currentVault.vaultId, repayAmount);
      
      if (result.success) {
        successMessage = `Successfully made partial repayment of ${repayAmount} icUSD`;
        
        // Reset input
        repayAmount = 0;
        
        // Explicitly refresh this vault to ensure UI is updated
        await vaultStore.refreshVault(currentVault.vaultId);
      } else {
        errorMessage = result.error || "Failed to make partial repayment";
      }
    } catch (err) {
      console.error('Error making partial repayment:', err);
      errorMessage = err instanceof Error ? err.message : "Unknown error";
    } finally {
      isRepaying = false;
      isApproving = false;
    }
  }
  
  // Update handleWithdrawAndCloseVault to use currentVault
  async function handleWithdrawAndCloseVault() {
    if (!currentVault || !canWithdraw) {
      errorMessage = "You must repay all debt before withdrawing collateral and closing";
      return;
    }
    
    try {
      isWithdrawingAndClosing = true;
      errorMessage = '';
      successMessage = '';
      
      // Call the combined operation
      const result = await protocolService.withdrawCollateralAndCloseVault(currentVault.vaultId);
      
      if (result.success) {
        successMessage = `Successfully withdrew ${currentVault.icpMargin} ICP and closed the vault`;
        closeSuccess = true;
        
        // Notify parent component
        dispatch('close', { vaultId: currentVault.vaultId });

        // Force refresh all vaults to reflect the closure
        await vaultStore.refreshVaults();

        setTimeout(() => {
          goto('/vaults'); 
        }, 1500);

      } else {
        errorMessage = result.error || "Failed to withdraw and close vault";
      }
    } catch (err) {
      console.error('Error in withdraw and close:', err);
      errorMessage = err instanceof Error ? err.message : "Unknown error";
    } finally {
      isWithdrawingAndClosing = false;
    }
  }
  
  // Update handleResetOperations
  async function handleResetOperations() {
    try {
      isResettingOperations = true;
      errorMessage = '';
      
      // Force refresh vault data
      await vaultStore.refreshVault(vaultId);
      
      successMessage = "Operations reset successfully";
    } catch (err) {
      console.error('Error resetting operations:', err);
      errorMessage = "Failed to reset operations";
    } finally {
      isResettingOperations = false;
    }
  }
  
  // Listen for vault updates
  let vaultUpdateListener: (e: CustomEvent) => void;
  
  onMount(async () => {
    // Refresh this specific vault when component mounts
    await vaultStore.refreshVault(vaultId);
    
    // Add event listener for vault updates
    vaultUpdateListener = (e: CustomEvent) => {
      const detail = (e as CustomEvent<{vaultId: number}>).detail;
      if (detail?.vaultId === vaultId) {
        console.log(`Vault #${vaultId} updated, refreshing component`);
      }
    };
    
    window.addEventListener('vault-updated', vaultUpdateListener as EventListener);
  });
  
  onDestroy(() => {
    // Clean up event listener when component is destroyed
    if (vaultUpdateListener) {
      window.removeEventListener('vault-updated', vaultUpdateListener as EventListener);
    }
  });
  
  // Helper to automatically repay max amount
  function setMaxRepay() {
    if (currentVault && isFinite(currentVault.borrowedIcusd) && currentVault.borrowedIcusd > 0) {
      repayAmount = currentVault.borrowedIcusd;
    } else {
      errorMessage = "Cannot set repay amount - invalid debt value";
    }
  }
</script>

<!-- Update template to use currentVault instead of vault -->
{#if currentVault}
<div class="bg-gray-800/60 backdrop-blur-lg border border-gray-700 rounded-lg p-6">
  <!-- Vault Header - Keep as is -->
  <div class="flex justify-between items-center mb-6">
    <h2 class="text-2xl font-bold">Vault #{currentVault.vaultId}</h2>
    
    <!-- Health Status Indicator - Keep as is -->
    <div class="flex items-center">
      <div class="flex items-center bg-gray-900 rounded-full px-3 py-1">
        {#if vaultHealthStatus === 'healthy'}
          <span class="w-3 h-3 bg-green-500 rounded-full mr-2"></span>
          <span class="text-green-400 text-sm">Healthy</span>
        {:else if vaultHealthStatus === 'warning'}
          <span class="w-3 h-3 bg-yellow-500 rounded-full mr-2"></span>
          <span class="text-yellow-400 text-sm">Warning</span>
        {:else}
          <span class="w-3 h-3 bg-red-500 rounded-full mr-2"></span>
          <span class="text-red-400 text-sm">At Risk</span>
        {/if}
      </div>
      <div class="text-gray-400 text-sm ml-3">
        Collateral Ratio: {formattedCollateralRatio}
      </div>
    </div>
  </div>
  
  <!-- Vault Stats - FIXED MARKUP -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
    <div class="bg-gray-900/60 rounded-lg p-4">
      <h3 class="text-gray-400 mb-1">Collateral</h3>
      <div class="flex items-end justify-between">
        <div>
          <p class="text-xl font-bold">{formattedMargin} ICP</p>
          <p class="text-gray-400 text-sm">${formattedCollateralValue}</p>
        </div>
        <div>
          {#if canWithdraw}
            <button 
              on:click={handleWithdrawAndCloseVault} 
              disabled={isWithdrawingCollateral}
              class="text-sm px-3 py-1 bg-purple-600 hover:bg-purple-500 rounded-md"
            >
              {isWithdrawingCollateral ? 'Withdrawing...' : 'Withdraw'}
            </button>
          {/if}
        </div>
      </div>
    </div>
    
    <div class="bg-gray-900/60 rounded-lg p-4">
      <h3 class="text-gray-400 mb-1">Borrowed</h3>
      <div class="flex items-end justify-between">
        <div>
          <p class="text-xl font-bold">{formattedBorrowedAmount} icUSD</p>
          <p class="text-gray-400 text-sm">${formattedBorrowedAmount}</p>
        </div>
        <div>
          {#if currentVault.borrowedIcusd > 0}
            <button 
              on:click={setMaxRepay}
              class="text-sm px-3 py-1 bg-purple-600 hover:bg-purple-500 rounded-md"
            >
              Repay All
            </button>
          {/if}
        </div>
      </div>
    </div>
  </div>
  
  <!-- IMPROVED Action Panels -->
  <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
    <!-- Add Margin Panel - IMPROVED -->
    <div class="bg-gray-900/30 p-4 rounded-lg flex flex-col h-full">
      <h3 class="text-lg font-semibold mb-3">Add Collateral</h3>
      <div class="mb-2 flex-grow">
        <input 
          type="number" 
          bind:value={addMarginAmount} 
          min="0.001" 
          step="0.01"
          placeholder="ICP amount" 
          class="w-full bg-gray-800 text-white p-2 rounded border border-gray-700"
        />
        <p class="text-xs text-gray-400 mt-1">
          Current: {formattedMargin} ICP
        </p>
      </div>
      <button 
        on:click={handleAddMargin} 
        disabled={isAddingMargin || isApproving || !addMarginAmount || addMarginAmount <= 0}
        class="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {#if isApproving}
          Approving...
        {:else if isAddingMargin}
          Processing...
        {:else}
          Add ICP
        {/if}
      </button>
    </div>
    
    <!-- Borrow Panel - IMPROVED -->
    <div class="bg-gray-900/30 p-4 rounded-lg flex flex-col h-full">
      <h3 class="text-lg font-semibold mb-3">Borrow</h3>
      <div class="mb-2 flex-grow">
        <input 
          type="number" 
          bind:value={borrowAmount}
          min="0.1"
          step="0.1" 
          placeholder="icUSD amount" 
          class="w-full bg-gray-800 text-white p-2 rounded border border-gray-700"
        />
        <p class="text-xs text-gray-400 mt-1">
          Max borrowable: {maxBorrowable.toFixed(2)} icUSD
        </p>
      </div>
      <button 
        on:click={handleBorrow} 
        disabled={isBorrowing || !borrowAmount || borrowAmount <= 0 || borrowAmount > maxBorrowable}
        class="w-full bg-green-600 hover:bg-green-500 text-white py-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {#if isBorrowing}
          Borrowing...
        {:else}
          Borrow icUSD
        {/if}
      </button>
    </div>
    
    <!-- Repay Panel - IMPROVED -->
    <div class="bg-gray-900/30 p-4 rounded-lg flex flex-col h-full">
      <h3 class="text-lg font-semibold mb-3">Repay</h3>
      <div class="mb-2 flex-grow">
        <input 
          type="number" 
          bind:value={repayAmount} 
          min="0" 
          max={currentVault.borrowedIcusd}
          step="0.01"
          placeholder="icUSD amount" 
          class="w-full bg-gray-800 text-white p-2 rounded border border-gray-700"
        />
        <p class="text-xs text-gray-400 mt-1">
          {#if currentVault.borrowedIcusd > 0}
            Outstanding: {formattedBorrowedAmount} icUSD
          {:else}
            No outstanding debt
          {/if}
        </p>
      </div>
      <div class="flex gap-2">
        <button 
          on:click={handlePartialRepay} 
          disabled={isRepaying || isApproving || repayAmount <= 0 || repayAmount > currentVault.borrowedIcusd || currentVault.borrowedIcusd === 0}
          class="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          {#if isApproving}
            Approving...
          {:else if isRepaying}
            Processing...
          {:else}
            Partial Repay
          {/if}
        </button>
        <button 
          on:click={handleRepay} 
          disabled={isRepaying || isApproving || repayAmount <= 0 || repayAmount > currentVault.borrowedIcusd || currentVault.borrowedIcusd === 0}
          class="flex-1 bg-yellow-600 hover:bg-yellow-500 text-white py-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          {#if isApproving}
            Approving...
          {:else if isRepaying}
            Processing...
          {:else}
            Full Repay
          {/if}
        </button>
      </div>
    </div>
  </div>
  
  <!-- Message Panels - IMPROVED -->
  {#if errorMessage}
    <div class="bg-red-900/30 border border-red-800 text-red-100 p-3 rounded-md mb-6 flex justify-between items-center">
      <div>{errorMessage}</div>
      <button 
        class="text-red-200 hover:text-white" 
        on:click={() => errorMessage = ''}
        aria-label="Close error message"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
        </svg>
      </button>
    </div>
  {/if}
  
  {#if successMessage}
  <div class="bg-green-900/30 border border-green-800 text-green-100 p-3 rounded-md mb-6 flex justify-between items-center">
    <div>{successMessage}</div>
    <button 
      class="text-green-200 hover:text-white" 
      on:click={() => successMessage = ''}
      aria-label="Close success message"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
      </svg>
    </button>
  </div>
{/if}
  
  <!-- Close Vault Section - IMPROVED -->
  <div class="mt-8 border-t border-gray-700 pt-6">
    <h3 class="text-lg font-semibold mb-4">Vault Management</h3>
    
    <div class="flex flex-wrap gap-4">
      {#if canWithdraw && canClose}
        <!-- Combined withdrawal and close button -->
        <button 
          on:click={handleWithdrawAndCloseVault}
          disabled={isWithdrawingAndClosing }
          class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
        >
          {#if isWithdrawingAndClosing}
            <span class="inline-block animate-spin mr-2">↻</span> Processing...
          {:else}
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
              <path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4V5h12v10z" />
            </svg>
            Withdraw & Close Vault
          {/if}
        </button>
      {:else if canClose}
        <!-- Just close button if no collateral -->
        <button 
          on:click={handleWithdrawAndCloseVault}
          disabled={isClosing }
          class="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
        >
          {#if isClosing}
            <span class="inline-block animate-spin mr-2">↻</span> Closing...
          {:else}
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
            </svg>
            Close Vault
          {/if}
        </button>
      {/if}
      
      <!-- Debug button for resetting operations -->
      <button 
        on:click={handleResetOperations}
        disabled={isResettingOperations}
        class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md flex items-center"
      >
        {#if isResettingOperations}
          <span class="inline-block animate-spin mr-2">↻</span> Resetting...
        {:else}
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />
          </svg>
          Reset Operations
        {/if}
      </button>
    </div>
    
    {#if closeError}
      <div class="mt-4 bg-red-900/30 border border-red-800 text-red-100 p-3 rounded-md">
        {closeError}
      </div>
    {/if}
    
    {#if closeSuccess}
      <div class="mt-4 bg-green-900/30 border border-green-800 text-green-100 p-3 rounded-md">
        Vault has been successfully closed
      </div>
    {/if}
  </div>
</div>
{:else}
<!-- Show loading state when vault is null -->
<div class="bg-gray-800/60 backdrop-blur-lg border border-gray-700 rounded-lg p-6">
  <div class="text-center py-8">
    <div class="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-purple-500 mb-4"></div>
    <p class="text-gray-400">Loading vault data...</p>
  </div>
</div>
{/if}