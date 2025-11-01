<script lang="ts">
  import { onMount } from 'svelte';
  import { walletStore } from '../../lib/stores/wallet';
  import { stabilityPoolService } from '../../lib/services/stabilityPoolService';
  import PoolStats from '../../lib/components/stability-pool/PoolStats.svelte';
  import DepositInterface from '../../lib/components/stability-pool/DepositInterface.svelte';
  import UserAccount from '../../lib/components/stability-pool/UserAccount.svelte';
  import LiquidationMonitor from '../../lib/components/stability-pool/LiquidationMonitor.svelte';
  import RewardsDashboard from '../../lib/components/stability-pool/RewardsDashboard.svelte';
  import LoadingSpinner from '../../lib/components/common/LoadingSpinner.svelte';

  let loading = true;
  let error = '';
  let poolData: any = null;
  let userDeposit: any = null;
  let liquidationHistory: any[] = [];

  $: isConnected = $walletStore.isConnected;

  async function loadPoolData() {
    try {
      loading = true;
      error = '';
      
      // Load general pool information
      poolData = await stabilityPoolService.getPoolInfo();
      
      if (isConnected) {
        // Load user-specific data if wallet is connected
        userDeposit = await stabilityPoolService.getUserDeposit();
        liquidationHistory = await stabilityPoolService.getLiquidationHistory();
      }
    } catch (err) {
      console.error('Failed to load stability pool data:', err);
      error = 'Failed to load stability pool data. Please try again.';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadPoolData();
  });

  // Reload data when wallet connection changes
  $: if (isConnected !== undefined) {
    loadPoolData();
  }

  function handleDepositSuccess() {
    // Reload data after successful deposit
    loadPoolData();
  }

  function handleWithdrawSuccess() {
    // Reload data after successful withdrawal
    loadPoolData();
  }
</script>

<svelte:head>
  <title>Stability Pool - Rumi Protocol</title>
  <meta name="description" content="Earn rewards by providing icUSD to the stability pool and help secure the Rumi Protocol through automated liquidations." />
</svelte:head>

<div class="stability-pool-page">
  <div class="page-header">
    <div class="header-content">
      <div class="header-text">
        <h1 class="page-title">Stability Pool</h1>
        <p class="page-description">
          Earn rewards by providing icUSD liquidity to secure the protocol through automated liquidations.
          Depositors receive a 10% bonus from liquidated collateral.
        </p>
      </div>
      <div class="header-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M12 1v6m0 6v6m11-7h-6m-6 0H1"/>
        </svg>
      </div>
    </div>
  </div>

  {#if loading}
    <div class="loading-container">
      <LoadingSpinner />
      <p>Loading stability pool data...</p>
    </div>
  {:else if error}
    <div class="error-container">
      <div class="error-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>
      <p class="error-message">{error}</p>
      <button class="retry-button" on:click={loadPoolData}>
        Try Again
      </button>
    </div>
  {:else}
    <div class="pool-content">
      <!-- Pool Statistics -->
      <div class="stats-section">
        <PoolStats {poolData} />
      </div>

      <!-- Main Action Area -->
      <div class="main-section">
        <div class="action-panels">
          <!-- Deposit/Withdraw Interface -->
          <div class="panel deposit-panel">
            <DepositInterface 
              {poolData} 
              {userDeposit}
              on:depositSuccess={handleDepositSuccess}
              on:withdrawSuccess={handleWithdrawSuccess}
            />
          </div>

          <!-- User Account Summary -->
          {#if isConnected && userDeposit}
            <div class="panel account-panel">
              <UserAccount {userDeposit} {poolData} />
            </div>
          {/if}
        </div>

        <!-- Rewards Dashboard -->
        {#if isConnected && userDeposit}
          <div class="rewards-section">
            <RewardsDashboard {userDeposit} {liquidationHistory} />
          </div>
        {/if}
      </div>

      <!-- Liquidation Monitor -->
      <div class="monitor-section">
        <LiquidationMonitor {liquidationHistory} {poolData} />
      </div>

      <!-- Information Cards -->
      <div class="info-section">
        <div class="info-cards">
          <div class="info-card">
            <div class="info-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
            </div>
            <h3>Earn Liquidation Bonuses</h3>
            <p>Receive 10% bonus from liquidated ICP collateral when the pool is used for liquidations.</p>
          </div>

          <div class="info-card">
            <div class="info-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
            </div>
            <h3>Secure the Protocol</h3>
            <p>Your deposits help maintain protocol stability by providing instant liquidity for undercollateralized vaults.</p>
          </div>

          <div class="info-card">
            <div class="info-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="1" x2="12" y2="23"/>
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
              </svg>
            </div>
            <h3>Automated Operations</h3>
            <p>The stability pool operates automatically, monitoring vaults and executing liquidations without manual intervention.</p>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .stability-pool-page {
    min-height: calc(100vh - 80px);
    padding: 2rem;
    max-width: 1400px;
    margin: 0 auto;
  }

  .page-header {
    margin-bottom: 3rem;
  }

  .header-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2rem;
    background: rgba(15, 23, 42, 0.8);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 1rem;
  }

  .header-text {
    flex: 1;
  }

  .page-title {
    font-size: 2.5rem;
    font-weight: 700;
    background: linear-gradient(135deg, #f472b6, #a855f7);
    background-clip: text;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    margin-bottom: 0.5rem;
  }

  .page-description {
    font-size: 1.125rem;
    color: #d1d5db;
    line-height: 1.6;
    max-width: 600px;
  }

  .header-icon {
    width: 4rem;
    height: 4rem;
    color: #f472b6;
    flex-shrink: 0;
  }

  .loading-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4rem;
    text-align: center;
    color: #d1d5db;
  }

  .error-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4rem;
    text-align: center;
  }

  .error-icon {
    width: 3rem;
    height: 3rem;
    color: #ef4444;
    margin-bottom: 1rem;
  }

  .error-message {
    color: #ef4444;
    font-size: 1.125rem;
    margin-bottom: 1.5rem;
  }

  .retry-button {
    padding: 0.75rem 1.5rem;
    background: linear-gradient(135deg, #f472b6, #a855f7);
    color: white;
    border: none;
    border-radius: 0.5rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .retry-button:hover {
    transform: translateY(-1px);
    box-shadow: 0 10px 25px rgba(244, 114, 182, 0.3);
  }

  .pool-content {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .stats-section {
    width: 100%;
  }

  .main-section {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .action-panels {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2rem;
  }

  .panel {
    background: rgba(15, 23, 42, 0.8);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 1rem;
    padding: 1.5rem;
  }

  .rewards-section,
  .monitor-section {
    width: 100%;
  }

  .info-section {
    margin-top: 2rem;
  }

  .info-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 1.5rem;
  }

  .info-card {
    background: rgba(15, 23, 42, 0.6);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 1rem;
    padding: 1.5rem;
    text-align: center;
  }

  .info-icon {
    width: 2.5rem;
    height: 2.5rem;
    color: #f472b6;
    margin: 0 auto 1rem;
  }

  .info-card h3 {
    font-size: 1.25rem;
    font-weight: 600;
    color: white;
    margin-bottom: 0.5rem;
  }

  .info-card p {
    color: #d1d5db;
    line-height: 1.6;
  }

  /* Responsive Design */
  @media (max-width: 768px) {
    .stability-pool-page {
      padding: 1rem;
    }

    .page-title {
      font-size: 2rem;
    }

    .header-content {
      flex-direction: column;
      text-align: center;
      gap: 1rem;
    }

    .action-panels {
      grid-template-columns: 1fr;
    }

    .info-cards {
      grid-template-columns: 1fr;
    }
  }
</style>