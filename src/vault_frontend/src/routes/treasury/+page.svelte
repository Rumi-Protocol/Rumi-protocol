<script lang="ts">
  import { onMount } from 'svelte';
  import { walletStore as wallet } from "../../lib/stores/wallet";
  import { TreasuryService, TreasuryManagementService } from '../../lib/services/protocol/apiClient';
  import { formatNumber } from '../../lib/utils/format';
  import { protocolService } from '../../lib/services/protocol';

  let isController = false;
  let treasuryStatus: any = null;
  let feeSummary: any = null;
  let revenueEstimate: any = null;
  let isLoading = true;
  let error = '';
  let icpPrice = 0;

  // Withdrawal form state
  let withdrawalInProgress = false;
  let withdrawalError = '';
  let withdrawalSuccess = '';
  let withdrawalForm = {
    assetType: 'ICUSD' as 'ICUSD' | 'ICP' | 'CKBTC',
    amount: 0,
    to: '',
    memo: ''
  };

  $: isConnected = $wallet.isConnected;

  async function loadTreasuryData() {
    try {
      isLoading = true;
      error = '';

      // Check if user is controller
      isController = await TreasuryService.isController();
      
      if (!isController) {
        error = 'Access denied. Only the treasury controller can access this page.';
        return;
      }

      // Load treasury data
      const [status, summary, price] = await Promise.all([
        TreasuryService.getTreasuryStatus(),
        TreasuryManagementService.getFeeSummary(),
        protocolService.getICPPrice()
      ]);

      treasuryStatus = status;
      feeSummary = summary;
      icpPrice = price;

      // Calculate revenue estimate
      revenueEstimate = await TreasuryManagementService.getRevenueEstimate(icpPrice);

    } catch (err) {
      console.error('Error loading treasury data:', err);
      error = err instanceof Error ? err.message : 'Failed to load treasury data';
    } finally {
      isLoading = false;
    }
  }

  async function handleWithdrawal() {
    if (!withdrawalForm.amount || !withdrawalForm.to || withdrawalForm.amount <= 0) {
      withdrawalError = 'Please fill in all required fields with valid values';
      return;
    }

    try {
      withdrawalInProgress = true;
      withdrawalError = '';
      withdrawalSuccess = '';

      const result = await TreasuryService.withdrawFromTreasury(
        withdrawalForm.assetType,
        withdrawalForm.amount,
        withdrawalForm.to,
        withdrawalForm.memo || undefined
      );

      if (result.success) {
        withdrawalSuccess = `Successfully withdrew ${withdrawalForm.amount} ${withdrawalForm.assetType}. Block index: ${result.blockIndex}`;
        
        // Reset form
        withdrawalForm = {
          assetType: 'ICUSD',
          amount: 0,
          to: '',
          memo: ''
        };

        // Reload data
        await loadTreasuryData();
      } else {
        withdrawalError = result.error || 'Withdrawal failed';
      }
    } catch (err) {
      console.error('Error during withdrawal:', err);
      withdrawalError = err instanceof Error ? err.message : 'Unknown error occurred';
    } finally {
      withdrawalInProgress = false;
    }
  }

  function getAvailableBalance(assetType: string): number {
    if (!treasuryStatus) return 0;
    return treasuryStatus.balances[assetType] || 0;
  }

  onMount(() => {
    if (isConnected) {
      loadTreasuryData();
    }
  });

  // Watch for wallet connection changes
  $: if (isConnected) {
    loadTreasuryData();
  }
</script>

<svelte:head>
  <title>Treasury Management - RUMI Protocol</title>
</svelte:head>

<div class="container mx-auto px-4 max-w-6xl">
  <div class="mb-8">
    <h1 class="text-4xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-pink-400 to-purple-600">
      Treasury Management
    </h1>
    <p class="text-xl text-gray-300">
      View and manage protocol fee collections
    </p>
  </div>

  {#if !isConnected}
    <div class="glass-card p-8 text-center">
      <p class="text-lg text-gray-300 mb-4">Please connect your wallet to access treasury management</p>
    </div>
  {:else if isLoading}
    <div class="glass-card p-8 text-center">
      <div class="animate-spin w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full mx-auto mb-4"></div>
      <p class="text-gray-300">Loading treasury data...</p>
    </div>
  {:else if error}
    <div class="glass-card p-8 text-center bg-red-900/20 border-red-500/30">
      <p class="text-red-300 text-lg">{error}</p>
    </div>
  {:else if !isController}
    <div class="glass-card p-8 text-center bg-yellow-900/20 border-yellow-500/30">
      <p class="text-yellow-300 text-lg">Access denied. Only the treasury controller can access this page.</p>
    </div>
  {:else}
    <!-- Treasury Overview -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      <div class="glass-card">
        <h3 class="text-lg font-semibold mb-2 text-purple-300">Total Deposits</h3>
        <p class="text-3xl font-bold">{treasuryStatus.totalDeposits}</p>
        <p class="text-sm text-gray-400">Fee collections</p>
      </div>

      <div class="glass-card">
        <h3 class="text-lg font-semibold mb-2 text-green-300">Estimated Revenue</h3>
        <p class="text-3xl font-bold">${formatNumber(revenueEstimate?.totalUSD || 0)}</p>
        <p class="text-sm text-gray-400">USD equivalent</p>
      </div>

      <div class="glass-card">
        <h3 class="text-lg font-semibold mb-2 text-blue-300">ICP Price</h3>
        <p class="text-3xl font-bold">${formatNumber(icpPrice)}</p>
        <p class="text-sm text-gray-400">Current rate</p>
      </div>
    </div>

    <!-- Asset Balances -->
    <div class="glass-card mb-8">
      <h2 class="text-2xl font-semibold mb-6">Treasury Balances</h2>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        {#each Object.entries(treasuryStatus.balances) as [asset, balance]}
          <div class="bg-gray-800/50 p-4 rounded-lg">
            <div class="flex justify-between items-center mb-2">
              <span class="text-gray-300">{asset}</span>
              <span class="text-2xl font-bold text-white">{formatNumber(Number(balance))}</span>
            </div>
            {#if revenueEstimate?.breakdown[asset]}
              <p class="text-sm text-gray-400">≈ ${formatNumber(revenueEstimate.breakdown[asset])}</p>
            {/if}
          </div>
        {/each}
      </div>
    </div>

    <!-- Fee Breakdown -->
    <div class="glass-card mb-8">
      <h2 class="text-2xl font-semibold mb-6">Fee Breakdown</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        {#each Object.entries(feeSummary.totalByType) as [feeType, amount]}
          <div class="bg-gray-800/50 p-4 rounded-lg">
            <div class="flex justify-between items-center">
              <span class="text-gray-300">{feeType.replace('_', ' ')}</span>
              <span class="font-semibold">{formatNumber(Number(amount))}</span>
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- Recent Activity -->
    <div class="glass-card mb-8">
      <h2 class="text-2xl font-semibold mb-6">Recent Fee Collections</h2>
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-gray-700">
              <th class="text-left py-2">Type</th>
              <th class="text-left py-2">Asset</th>
              <th class="text-left py-2">Amount</th>
              <th class="text-left py-2">Date</th>
              <th class="text-left py-2">Block</th>
            </tr>
          </thead>
          <tbody>
            {#each feeSummary.recentActivity as activity}
              <tr class="border-b border-gray-800">
                <td class="py-2 text-sm">{activity.feeType}</td>
                <td class="py-2 text-sm">{activity.assetType}</td>
                <td class="py-2 text-sm font-mono">{formatNumber(activity.amount)}</td>
                <td class="py-2 text-sm">{activity.timestamp.toLocaleDateString()}</td>
                <td class="py-2 text-sm text-blue-400">{activity.blockIndex}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Withdrawal Form -->
    <div class="glass-card">
      <h2 class="text-2xl font-semibold mb-6">Withdraw Funds</h2>
      
      {#if withdrawalError}
        <div class="bg-red-900/30 border border-red-500 p-4 rounded-lg mb-4">
          <p class="text-red-300">{withdrawalError}</p>
        </div>
      {/if}

      {#if withdrawalSuccess}
        <div class="bg-green-900/30 border border-green-500 p-4 rounded-lg mb-4">
          <p class="text-green-300">{withdrawalSuccess}</p>
        </div>
      {/if}

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label for="asset-type" class="block text-sm font-medium text-gray-300 mb-2">
            Asset Type
          </label>
          <select 
            id="asset-type"
            bind:value={withdrawalForm.assetType}
            class="w-full bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-3 text-white"
            disabled={withdrawalInProgress}
          >
            <option value="ICUSD">icUSD</option>
            <option value="ICP">ICP</option>
            <option value="CKBTC">ckBTC</option>
          </select>
          <p class="text-sm text-gray-400 mt-1">
            Available: {formatNumber(getAvailableBalance(withdrawalForm.assetType))} {withdrawalForm.assetType}
          </p>
        </div>

        <div>
          <label for="amount" class="block text-sm font-medium text-gray-300 mb-2">
            Amount
          </label>
          <input
            id="amount"
            type="number"
            bind:value={withdrawalForm.amount}
            max={getAvailableBalance(withdrawalForm.assetType)}
            min="0"
            step="0.001"
            class="w-full bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-3 text-white"
            placeholder="0.00"
            disabled={withdrawalInProgress}
          />
        </div>

        <div class="md:col-span-2">
          <label for="to" class="block text-sm font-medium text-gray-300 mb-2">
            Destination Principal *
          </label>
          <input
            id="to"
            type="text"
            bind:value={withdrawalForm.to}
            class="w-full bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-3 text-white"
            placeholder="rrkah-fqaaa-aaaaa-aaaaq-cai"
            disabled={withdrawalInProgress}
          />
        </div>

        <div class="md:col-span-2">
          <label for="memo" class="block text-sm font-medium text-gray-300 mb-2">
            Memo (Optional)
          </label>
          <input
            id="memo"
            type="text"
            bind:value={withdrawalForm.memo}
            class="w-full bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-3 text-white"
            placeholder="Treasury withdrawal for operations"
            disabled={withdrawalInProgress}
          />
        </div>

        <div class="md:col-span-2">
          <button
            class="w-full py-3 px-6 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 rounded-lg text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            on:click={handleWithdrawal}
            disabled={withdrawalInProgress || !withdrawalForm.amount || !withdrawalForm.to}
          >
            {#if withdrawalInProgress}
              <div class="flex items-center justify-center gap-2">
                <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Processing Withdrawal...
              </div>
            {:else}
              Withdraw {withdrawalForm.amount} {withdrawalForm.assetType}
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .glass-card {
    background-color: rgba(31, 41, 55, 0.4);
    backdrop-filter: blur(16px);
    border: 1px solid rgba(75, 85, 99, 0.5);
    border-radius: 0.5rem;
    padding: 1.5rem;
  }
</style>