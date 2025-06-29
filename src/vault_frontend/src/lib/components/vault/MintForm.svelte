<script lang="ts">
  import { walletStore } from '../../stores/wallet';
  import { ProtocolService } from '../../services/protocol';
  import { protocolManager } from '../../services/ProtocolManager';


  interface VaultResponse {
    Ok: {
      vault_id: bigint;
    };
  }
  
  let collateralAmount = '';
  let mintAmount = '';
  let sliderValue = 0;
  let isCreatingVault = false;
  let error = '';

  // Subscribe to store states
  $: wallet = $walletStore;
  $: icpPrice = ProtocolService?.getICPPrice() || 0;
  $: balance = wallet.balance;

  // Calculate potential amounts
  $: maxCollateralAmount = balance ? Number(balance) / 100000000 : 0;
  $: collateralValueUSD = parseFloat(collateralAmount) * Number(icpPrice);
  $: maxMintAmount = collateralValueUSD / 1.5; // Based on minimum collateral ratio
  $: mintPercentage = (parseFloat(mintAmount) / maxMintAmount) * 100;
  $: collateralRatio = mintAmount ? (collateralValueUSD / parseFloat(mintAmount)) : Infinity;
  $: collateralRatioColor = 
    collateralRatio >= 2.0 ? 'text-green-400' :
    collateralRatio >= 1.5 ? 'text-yellow-400' : 
    'text-red-400';

  // Handle slider changes
  function updateFromSlider() {
    mintAmount = ((maxMintAmount * sliderValue) / 100).toFixed(2);
  }

  function updateFromInput() {
    sliderValue = (parseFloat(mintAmount) / maxMintAmount) * 100;
  }

  async function handleCreateVault() {
    if (!collateralAmount) return;
    
    isCreatingVault = true;
    error = '';
    
    try {
      // Show approval status
      error = 'Approving ICP transfer...';
      
      const result = await protocolManager.createVault(Number(collateralAmount));

      // Clear approval message
      error = '';

      // Handle minting if needed
      if (result.success && result.vaultId && mintAmount) {
        error = 'Creating vault and minting icUSD...';
        const vaultId = result.vaultId;
        await protocolManager.borrowFromVault(vaultId, parseFloat(mintAmount));
      }

      // Reset form
      collateralAmount = '';
      mintAmount = '';
      sliderValue = 0;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to create vault';
    } finally {
      isCreatingVault = false;
    }
  }
</script>

<div class="bg-gray-900/50 p-6 rounded-lg backdrop-blur-sm ring-2 ring-purple-400">
  <h2 class="text-2xl font-bold mb-6">Create Vault</h2>

  <div class="space-y-6">
    <!-- Collateral Input -->
    <div>
      <label for="deposit-icp" class="block text-sm text-gray-400 mb-2">
        Deposit ICP Collateral
      </label>
      <div class="flex gap-2">
        <input
          id="deposit-icp"
          type="number"
          bind:value={collateralAmount}
          placeholder="Amount"
          class="bg-gray-800 rounded px-3 py-2 w-full text-white"
          min="0"
          max={maxCollateralAmount}
          step="0.1"
        />
        <button
          class="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded font-medium"
          on:click={() => collateralAmount = maxCollateralAmount.toString()}
        >
          Max
        </button>
      </div>
      <p class="text-sm text-gray-400 mt-1">
        Available: {maxCollateralAmount.toFixed(4)} ICP
      </p>
    </div>

    <!-- Mint Amount -->
    <div>
      <label for="mint-icusd" class="block text-sm text-gray-400 mb-2">
        Mint icUSD Amount
      </label>
      <input
        id="mint-icusd"
        type="number"
        bind:value={mintAmount}
        on:input={updateFromInput}
        placeholder="Amount to mint"
        class="bg-gray-800 rounded px-3 py-2 w-full text-white"
        min="0"
        max={maxMintAmount}
        step="0.1"
      />
      
      <!-- Percentage Slider -->
      <div class="mt-2">
        <input
          type="range"
          bind:value={sliderValue}
          on:input={updateFromSlider}
          min="0"
          max="100"
          step="1"
          class="w-full"
        />
        <div class="flex justify-between text-xs text-gray-400">
          <span>0%</span>
          <span>25%</span>
          <span>50%</span>
          <span>75%</span>
          <span>100%</span>
        </div>
      </div>
    </div>

    <!-- Summary -->
    <div class="bg-gray-800/50 p-4 rounded space-y-2">
      <div class="flex justify-between text-sm">
        <span class="text-gray-400">Collateral Value:</span>
        <span>${collateralValueUSD.toFixed(2)}</span>
      </div>
      <div class="flex justify-between text-sm">
        <span class="text-gray-400">Maximum Mintable:</span>
        <span>{maxMintAmount.toFixed(2)} icUSD</span>
      </div>
      <div class="flex justify-between text-sm">
        <span class="text-gray-400">Collateral Ratio:</span>
        <span class={collateralRatioColor}>
          {collateralRatio === Infinity ? '∞' : (collateralRatio * 100).toFixed(1)}%
        </span>
      </div>
    </div>

    {#if error}
      <div class="p-3 bg-red-900/50 border border-red-500 rounded text-sm text-red-200">
        {error}
      </div>
    {/if}

    <button
      class="w-full px-6 py-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded font-medium"
      on:click={handleCreateVault}
      disabled={isCreatingVault || !collateralAmount || parseFloat(collateralAmount) <= 0}
    >
      {#if isCreatingVault}
        <span class="flex items-center justify-center gap-2">
          <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          Creating...
        </span>
      {:else}
        Create Vault {mintAmount ? '& Mint icUSD' : ''}
      {/if}
    </button>
  </div>
</div>

<style>
  input[type="range"] {
    appearance: none;
    background-color: #4a5568;
    height: 0.5rem;
    border-radius: 9999px;
  }

  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 1rem;
    height: 1rem;
    background-color: #805ad5;
    border-radius: 9999px;
    cursor: pointer;
  }

  input[type="range"]::-moz-range-thumb {
    width: 1rem;
    height: 1rem;
    background-color: #805ad5;
    border-radius: 9999px;
    cursor: pointer;
    border: 0;
  }
</style>