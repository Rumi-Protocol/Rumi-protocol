<script lang="ts">
  import { stabilityPoolService } from '../../services/stabilityPoolService';
  
  export let userDeposit: any;
  export let poolData: any;
  
  $: depositedAmount = userDeposit ? stabilityPoolService.formatIcusd(userDeposit.amount) : '0.00';
  $: icpRewards = userDeposit ? stabilityPoolService.formatIcp(userDeposit.icp_rewards) : '0.0000';
  $: depositTime = userDeposit ? new Date(Number(userDeposit.deposit_time) / 1_000_000).toLocaleDateString() : 'N/A';
  
  // Calculate user's share of the pool
  $: poolShare = poolData && userDeposit && poolData.total_deposited > 0n 
    ? ((Number(userDeposit.amount) / Number(poolData.total_deposited)) * 100).toFixed(2)
    : '0.00';
</script>

<div class="user-account">
  <h3 class="account-title">Your Position</h3>
  
  <div class="account-stats">
    <div class="stat-item">
      <div class="stat-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="1" x2="12" y2="23"/>
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
        </svg>
      </div>
      <div class="stat-content">
        <div class="stat-value">{depositedAmount}</div>
        <div class="stat-label">icUSD Deposited</div>
      </div>
    </div>

    <div class="stat-item">
      <div class="stat-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
        </svg>
      </div>
      <div class="stat-content">
        <div class="stat-value">{icpRewards}</div>
        <div class="stat-label">ICP Rewards</div>
      </div>
    </div>

    <div class="stat-item">
      <div class="stat-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 6v6l4 2"/>
        </svg>
      </div>
      <div class="stat-content">
        <div class="stat-value">{depositTime}</div>
        <div class="stat-label">First Deposit</div>
      </div>
    </div>

    <div class="stat-item highlight">
      <div class="stat-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M12 1v6m0 6v6m11-7h-6m-6 0H1"/>
        </svg>
      </div>
      <div class="stat-content">
        <div class="stat-value">{poolShare}%</div>
        <div class="stat-label">Pool Share</div>
      </div>
    </div>
  </div>

  <div class="account-summary">
    <div class="summary-card">
      <h4 class="summary-title">Position Summary</h4>
      <div class="summary-content">
        <div class="summary-row">
          <span class="summary-label">Total Value:</span>
          <span class="summary-value">{depositedAmount} icUSD + {icpRewards} ICP</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">Share of Pool:</span>
          <span class="summary-value">{poolShare}%</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">Earning Rewards:</span>
          <span class="summary-value success">Active</span>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .user-account {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .account-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: white;
    margin-bottom: 1.5rem;
  }

  .account-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .stat-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.5rem;
    transition: all 0.2s ease;
  }

  .stat-item:hover {
    border-color: rgba(244, 114, 182, 0.3);
    background: rgba(244, 114, 182, 0.05);
  }

  .stat-item.highlight {
    border-color: rgba(244, 114, 182, 0.3);
    background: rgba(244, 114, 182, 0.1);
  }

  .stat-icon {
    width: 1.5rem;
    height: 1.5rem;
    color: #f472b6;
    flex-shrink: 0;
  }

  .stat-content {
    flex: 1;
    min-width: 0;
  }

  .stat-value {
    font-size: 0.875rem;
    font-weight: 600;
    color: white;
    line-height: 1.2;
    word-break: break-all;
  }

  .stat-label {
    font-size: 0.75rem;
    color: #d1d5db;
    margin-top: 0.125rem;
  }

  .account-summary {
    flex: 1;
  }

  .summary-card {
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.5rem;
    padding: 1rem;
  }

  .summary-title {
    font-size: 1rem;
    font-weight: 600;
    color: white;
    margin-bottom: 0.75rem;
  }

  .summary-content {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .summary-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .summary-label {
    color: #d1d5db;
    font-size: 0.875rem;
  }

  .summary-value {
    color: white;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .summary-value.success {
    color: #22c55e;
  }

  /* Responsive Design */
  @media (max-width: 768px) {
    .account-stats {
      grid-template-columns: 1fr;
    }
    
    .stat-item {
      padding: 0.75rem;
    }
  }
</style>