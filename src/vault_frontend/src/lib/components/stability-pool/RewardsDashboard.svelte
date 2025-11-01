<script lang="ts">
  import { stabilityPoolService } from '../../services/stabilityPoolService';
  
  export let userDeposit: any;
  export let liquidationHistory: any[] = [];
  
  let loading = false;
  let error = '';
  
  $: availableRewards = userDeposit ? stabilityPoolService.formatIcp(userDeposit.icp_rewards) : '0.0000';
  $: hasRewards = userDeposit && userDeposit.icp_rewards > 0n;
  
  // Calculate user's total rewards from liquidation history
  $: totalRewardsEarned = liquidationHistory.reduce((total, liquidation) => {
    return total + Number(liquidation.liquidation_bonus);
  }, 0);
  
  async function claimRewards() {
    if (!hasRewards) return;
    
    try {
      loading = true;
      error = '';
      
      await stabilityPoolService.claimRewards();
      
      // Emit event to parent to refresh data
      // Note: In a real implementation, you might want to emit this event
      
    } catch (err: any) {
      console.error('Failed to claim rewards:', err);
      error = err.message || 'Failed to claim rewards';
    } finally {
      loading = false;
    }
  }
</script>

<div class="rewards-dashboard">
  <div class="dashboard-header">
    <h3 class="dashboard-title">Rewards Dashboard</h3>
    <div class="reward-summary">
      <div class="reward-item">
        <span class="reward-label">Available to Claim:</span>
        <span class="reward-value highlight">{availableRewards} ICP</span>
      </div>
    </div>
  </div>

  <div class="dashboard-content">
    <div class="rewards-section">
      <div class="claim-card">
        <div class="claim-header">
          <div class="claim-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
          </div>
          <div class="claim-content">
            <h4 class="claim-title">ICP Rewards</h4>
            <p class="claim-description">Rewards earned from liquidation bonuses</p>
          </div>
        </div>
        
        <div class="claim-amount">
          <span class="amount-value">{availableRewards} ICP</span>
        </div>
        
        <button 
          class="claim-button"
          on:click={claimRewards}
          disabled={loading || !hasRewards}
        >
          {#if loading}
            <div class="loading-spinner"></div>
            Claiming...
          {:else if hasRewards}
            Claim Rewards
          {:else}
            No Rewards Available
          {/if}
        </button>
        
        {#if error}
          <div class="error-message">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            {error}
          </div>
        {/if}
      </div>
    </div>

    <div class="stats-section">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="2" x2="12" y2="6"/>
              <line x1="12" y1="18" x2="12" y2="22"/>
              <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/>
              <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
              <line x1="2" y1="12" x2="6" y2="12"/>
              <line x1="18" y1="12" x2="22" y2="12"/>
              <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/>
              <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
            </svg>
          </div>
          <div class="stat-content">
            <div class="stat-value">{liquidationHistory.length}</div>
            <div class="stat-label">Liquidations Participated</div>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </div>
          <div class="stat-content">
            <div class="stat-value">{stabilityPoolService.formatIcp(BigInt(totalRewardsEarned))}</div>
            <div class="stat-label">Total ICP Earned</div>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c2.39 0 4.58.93 6.21 2.44"/>
              <path d="M9 12l2 2 4-4"/>
            </svg>
          </div>
          <div class="stat-content">
            <div class="stat-value">10%</div>
            <div class="stat-label">Bonus Per Liquidation</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .rewards-dashboard {
    background: rgba(15, 23, 42, 0.8);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 1rem;
    padding: 1.5rem;
  }

  .dashboard-header {
    margin-bottom: 1.5rem;
  }

  .dashboard-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: white;
    margin-bottom: 0.75rem;
  }

  .reward-summary {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .reward-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .reward-label {
    color: #d1d5db;
    font-size: 0.875rem;
  }

  .reward-value {
    color: white;
    font-weight: 600;
    font-size: 0.875rem;
  }

  .reward-value.highlight {
    color: #f472b6;
  }

  .dashboard-content {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
  }

  .claim-card {
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.75rem;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .claim-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .claim-icon {
    width: 2rem;
    height: 2rem;
    color: #f472b6;
    flex-shrink: 0;
  }

  .claim-content {
    flex: 1;
  }

  .claim-title {
    color: white;
    font-size: 1rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
  }

  .claim-description {
    color: #d1d5db;
    font-size: 0.875rem;
  }

  .claim-amount {
    text-align: center;
    padding: 1rem;
    background: rgba(244, 114, 182, 0.1);
    border: 1px solid rgba(244, 114, 182, 0.2);
    border-radius: 0.5rem;
  }

  .amount-value {
    font-size: 1.5rem;
    font-weight: 700;
    color: #f472b6;
  }

  .claim-button {
    width: 100%;
    padding: 0.875rem;
    background: linear-gradient(135deg, #f472b6, #a855f7);
    border: none;
    border-radius: 0.5rem;
    color: white;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .claim-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .claim-button:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 10px 25px rgba(244, 114, 182, 0.3);
  }

  .loading-spinner {
    width: 1rem;
    height: 1rem;
    border: 2px solid transparent;
    border-top: 2px solid currentColor;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .error-message {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 0.5rem;
    color: #f87171;
    font-size: 0.875rem;
  }

  .error-message svg {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
  }

  .stats-section {
    display: flex;
    flex-direction: column;
  }

  .stats-grid {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .stat-card {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.5rem;
    transition: all 0.2s ease;
  }

  .stat-card:hover {
    border-color: rgba(244, 114, 182, 0.3);
    background: rgba(244, 114, 182, 0.05);
  }

  .stat-icon {
    width: 1.5rem;
    height: 1.5rem;
    color: #f472b6;
    flex-shrink: 0;
  }

  .stat-content {
    flex: 1;
  }

  .stat-value {
    font-size: 1.125rem;
    font-weight: 600;
    color: white;
    line-height: 1.2;
  }

  .stat-label {
    font-size: 0.75rem;
    color: #d1d5db;
    margin-top: 0.125rem;
  }

  /* Responsive Design */
  @media (max-width: 768px) {
    .dashboard-content {
      grid-template-columns: 1fr;
    }
    
    .reward-summary {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>