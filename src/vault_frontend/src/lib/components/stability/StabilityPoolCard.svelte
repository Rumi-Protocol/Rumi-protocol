<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { walletStore as wallet } from '../../stores/wallet';
  import { stabilityPoolService } from '../../services/stabilityPool';
  import { formatNumber } from '../../utils/format';
  import { walletOperations } from '../../services/protocol/walletOperations';
  import type { StabilityPoolStatus, UserStabilityPosition } from '../../../../../declarations/stability_pool/stability_pool.did';

  // Component state
  let poolStatus: StabilityPoolStatus | null = null;
  let userPosition: UserStabilityPosition | null = null;
  let icusdBalance = 0;
  let icpBalance = 0;
  let isLoading = true;
  let depositAmount = '';
  let withdrawAmount = '';
  let isDepositing = false;
  let isWithdrawing = false;
  let isClaiming = false;
  let isApprovingAllowance = false;
  let depositError = '';
  let withdrawError = '';
  let claimError = '';
  let successMessage = '';

  // Reactive variables
  $: isConnected = $wallet.isConnected;
  $: hasDeposit = userPosition && Number(userPosition.icusd_amount) > 0;
  $: hasPendingGains = userPosition && Number(userPosition.pending_icp_gains) > 0;

  // Load all data
  async function loadData() {
    if (!isConnected) return;

    isLoading = true;
    try {
      // Load pool status and user position in parallel
      const [status, position, icusdBal, icpBal] = await Promise.all([
        stabilityPoolService.getPoolStatus(),
        stabilityPoolService.getUserPosition(),
        walletOperations.getIcusdBalance(),
        walletOperations.getIcpBalance()
      ]);

      poolStatus = status;
      userPosition = position;
      icusdBalance = icusdBal;
      icpBalance = icpBal;

      console.log('Pool status:', status);
      console.log('User position:', position);
    } catch (error) {
      console.error('Failed to load stability pool data:', error);
    } finally {
      isLoading = false;
    }
  }

  // Deposit icUSD into stability pool
  async function depositIcusd() {
    if (!depositAmount || isDepositing) return;

    const amount = parseFloat(depositAmount);
    if (amount <= 0) {
      depositError = 'Amount must be greater than 0';
      return;
    }

    if (amount > icusdBalance) {
      depositError = `Insufficient balance. Available: ${formatNumber(icusdBalance)} icUSD`;
      return;
    }

    isDepositing = true;
    depositError = '';
    successMessage = '';

    try {
      // First approve the stability pool to spend icUSD
      isApprovingAllowance = true;
      const amountE8s = BigInt(Math.floor(amount * 100_000_000));
      const spenderCanisterId = import.meta.env.VITE_CANISTER_ID_STABILITY_POOL;

      // Add 10% buffer for fees
      const approvalAmount = amountE8s * BigInt(110) / BigInt(100);
      const approvalResult = await walletOperations.approveIcusdTransfer(
        approvalAmount,
        spenderCanisterId
      );

      if (!approvalResult.success) {
        depositError = approvalResult.error || 'Failed to approve icUSD transfer';
        return;
      }

      isApprovingAllowance = false;

      // Now deposit
      const result = await stabilityPoolService.depositIcusd(amount);
      if (result.success) {
        successMessage = `Successfully deposited ${formatNumber(amount)} icUSD to Stability Pool`;
        depositAmount = '';
        await loadData(); // Refresh data
      } else {
        depositError = result.error || 'Deposit failed';
      }
    } catch (error) {
      console.error('Deposit error:', error);
      depositError = 'Failed to deposit. Please try again.';
    } finally {
      isDepositing = false;
      isApprovingAllowance = false;
    }
  }

  // Withdraw icUSD from stability pool
  async function withdrawIcusd() {
    if (!withdrawAmount || isWithdrawing || !userPosition) return;

    const amount = parseFloat(withdrawAmount);
    const availableAmount = Number(userPosition.icusd_amount) / 100_000_000;

    if (amount <= 0) {
      withdrawError = 'Amount must be greater than 0';
      return;
    }

    if (amount > availableAmount) {
      withdrawError = `Insufficient deposit. Available: ${formatNumber(availableAmount)} icUSD`;
      return;
    }

    isWithdrawing = true;
    withdrawError = '';
    successMessage = '';

    try {
      const result = await stabilityPoolService.withdrawIcusd(amount);
      if (result.success) {
        successMessage = `Successfully withdrew ${formatNumber(amount)} icUSD from Stability Pool`;
        withdrawAmount = '';
        await loadData(); // Refresh data
      } else {
        withdrawError = result.error || 'Withdrawal failed';
      }
    } catch (error) {
      console.error('Withdrawal error:', error);
      withdrawError = 'Failed to withdraw. Please try again.';
    } finally {
      isWithdrawing = false;
    }
  }

  // Claim ICP gains from liquidations
  async function claimGains() {
    if (isClaiming || !userPosition) return;

    isClaiming = true;
    claimError = '';
    successMessage = '';

    try {
      const result = await stabilityPoolService.claimCollateralGains();
      if (result.success && result.amount) {
        successMessage = `Successfully claimed ${formatNumber(result.amount)} ICP in liquidation gains`;
        await loadData(); // Refresh data
      } else if (result.success && !result.amount) {
        claimError = 'No gains to claim';
      } else {
        claimError = result.error || 'Claim failed';
      }
    } catch (error) {
      console.error('Claim error:', error);
      claimError = 'Failed to claim gains. Please try again.';
    } finally {
      isClaiming = false;
    }
  }

  // Clear messages after some time
  $: if (successMessage) {
    setTimeout(() => { successMessage = ''; }, 5000);
  }

  // Initialize on mount
  onMount(() => {
    if (isConnected) {
      loadData();
    }

    // Set up refresh interval
    const interval = setInterval(() => {
      if (isConnected) {
        loadData();
      }
    }, 30000); // Refresh every 30 seconds

    return () => clearInterval(interval);
  });

  // Watch for wallet connection changes
  $: if (isConnected) {
    loadData();
  }
</script>

<div class="glass-card">
  <div class="flex justify-between items-center mb-6">
    <div>
      <h2 class="text-2xl font-semibold mb-2">Community Liquidation Pool</h2>
      <p class="text-gray-400 text-sm">
        Earn automated liquidation profits by providing icUSD to the pool
      </p>
    </div>
    <button
      class="px-3 py-1 bg-purple-600/30 text-purple-300 text-sm rounded hover:bg-purple-600/50 transition-colors"
      on:click={loadData}
      disabled={isLoading || !isConnected}
    >
      {isLoading ? 'Loading...' : 'Refresh'}
    </button>
  </div>

  {#if !isConnected}
    <div class="p-4 bg-yellow-900/30 border border-yellow-800 rounded-lg text-yellow-200 text-center">
      <p>Connect your wallet to participate in the Stability Pool</p>
    </div>
  {:else if isLoading}
    <div class="flex justify-center items-center py-8">
      <div class="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  {:else}
    <!-- Pool Status Section -->
    {#if poolStatus}
      <div class="mb-6 p-4 bg-gray-800/30 rounded-lg">
        <h3 class="text-lg font-medium mb-3">Pool Overview</h3>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p class="text-gray-400">Total Deposits</p>
            <p class="font-semibold text-lg">{formatNumber(Number(poolStatus.total_icusd_deposits) / 100_000_000)} icUSD</p>
          </div>
          <div>
            <p class="text-gray-400">Total Depositors</p>
            <p class="font-semibold text-lg">{poolStatus.total_depositors}</p>
          </div>
          <div>
            <p class="text-gray-400">Liquidations</p>
            <p class="font-semibold text-lg">{poolStatus.total_liquidations}</p>
          </div>
          <div>
            <p class="text-gray-400">ICP Distributed</p>
            <p class="font-semibold text-lg text-green-400">{formatNumber(Number(poolStatus.total_icp_distributed) / 100_000_000)} ICP</p>
          </div>
        </div>
      </div>
    {/if}

    <!-- User Position Section -->
    <div class="mb-6 p-4 bg-blue-900/20 rounded-lg border border-blue-800/50">
      <h3 class="text-lg font-medium mb-3">Your Position</h3>
      {#if userPosition && hasDeposit}
        <div class="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div>
            <p class="text-gray-400">Your Deposit</p>
            <p class="font-semibold text-lg">{formatNumber(Number(userPosition.icusd_amount) / 100_000_000)} icUSD</p>
          </div>
          <div>
            <p class="text-gray-400">Pool Share</p>
            <p class="font-semibold text-lg">{userPosition.share_percentage}%</p>
          </div>
          <div>
            <p class="text-gray-400">Pending Gains</p>
            <p class="font-semibold text-lg text-green-400">{formatNumber(Number(userPosition.pending_icp_gains) / 100_000_000)} ICP</p>
          </div>
        </div>
      {:else}
        <p class="text-gray-400">No active position in the pool</p>
      {/if}
    </div>

    <!-- Success/Error Messages -->
    {#if successMessage}
      <div class="p-3 mb-4 bg-green-900/30 border border-green-800 rounded-lg text-green-200 text-sm">
        {successMessage}
      </div>
    {/if}

    <!-- Action Buttons Section -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <!-- Deposit Section -->
      <div class="p-4 bg-gray-800/40 rounded-lg">
        <h4 class="font-medium mb-3">Deposit icUSD</h4>
        <div class="space-y-3">
          <div>
            <input
              type="number"
              placeholder="Amount to deposit"
              bind:value={depositAmount}
              class="w-full px-3 py-2 bg-gray-900/50 border border-gray-600 rounded text-white placeholder-gray-400 focus:border-purple-500 focus:outline-none"
              min="0"
              step="0.01"
            />
            <p class="text-xs text-gray-400 mt-1">
              Available: {formatNumber(icusdBalance)} icUSD
            </p>
          </div>

          {#if depositError}
            <p class="text-red-400 text-xs">{depositError}</p>
          {/if}

          <button
            on:click={depositIcusd}
            disabled={!depositAmount || isDepositing || isApprovingAllowance}
            class="w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {#if isApprovingAllowance}
              <span class="flex items-center justify-center gap-2">
                <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Approving...
              </span>
            {:else if isDepositing}
              <span class="flex items-center justify-center gap-2">
                <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Depositing...
              </span>
            {:else}
              Deposit
            {/if}
          </button>
        </div>
      </div>

      <!-- Withdraw Section -->
      <div class="p-4 bg-gray-800/40 rounded-lg">
        <h4 class="font-medium mb-3">Withdraw icUSD</h4>
        <div class="space-y-3">
          <div>
            <input
              type="number"
              placeholder="Amount to withdraw"
              bind:value={withdrawAmount}
              class="w-full px-3 py-2 bg-gray-900/50 border border-gray-600 rounded text-white placeholder-gray-400 focus:border-purple-500 focus:outline-none"
              min="0"
              step="0.01"
              disabled={!hasDeposit}
            />
            <p class="text-xs text-gray-400 mt-1">
              Available: {userPosition ? formatNumber(Number(userPosition.icusd_amount) / 100_000_000) : '0'} icUSD
            </p>
          </div>

          {#if withdrawError}
            <p class="text-red-400 text-xs">{withdrawError}</p>
          {/if}

          <button
            on:click={withdrawIcusd}
            disabled={!hasDeposit || !withdrawAmount || isWithdrawing}
            class="w-full px-4 py-2 bg-red-600 text-white rounded hover:bg-red-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {#if isWithdrawing}
              <span class="flex items-center justify-center gap-2">
                <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Withdrawing...
              </span>
            {:else}
              Withdraw
            {/if}
          </button>
        </div>
      </div>

      <!-- Claim Gains Section -->
      <div class="p-4 bg-gray-800/40 rounded-lg">
        <h4 class="font-medium mb-3">Claim ICP Gains</h4>
        <div class="space-y-3">
          <div class="text-center py-2">
            <p class="text-2xl font-bold text-green-400">
              {userPosition ? formatNumber(Number(userPosition.pending_icp_gains) / 100_000_000) : '0'}
            </p>
            <p class="text-xs text-gray-400">ICP available to claim</p>
          </div>

          {#if claimError}
            <p class="text-red-400 text-xs">{claimError}</p>
          {/if}

          <button
            on:click={claimGains}
            disabled={!hasPendingGains || isClaiming}
            class="w-full px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {#if isClaiming}
              <span class="flex items-center justify-center gap-2">
                <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Claiming...
              </span>
            {:else}
              Claim Gains
            {/if}
          </button>
        </div>
      </div>
    </div>

    <!-- How It Works Section -->
    <div class="mt-6 p-4 bg-purple-900/20 rounded-lg border border-purple-800/50">
      <h4 class="font-medium mb-2">How Community Liquidation Works</h4>
      <ul class="text-sm text-gray-300 space-y-1">
        <li>• Deposit icUSD to participate in automated liquidations</li>
        <li>• Earn 10% liquidation discount on every vault liquidated by the pool</li>
        <li>• Gains are distributed proportionally based on your share</li>
        <li>• Withdraw your deposits anytime (if sufficient pool balance)</li>
      </ul>
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