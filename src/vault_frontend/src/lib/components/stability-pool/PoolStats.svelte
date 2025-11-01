<script lang="ts">
  import { stabilityPoolService } from '../../services/stabilityPoolService';
  
  export let poolData: any;
  
  $: totalDeposited = poolData ? stabilityPoolService.formatIcusd(poolData.total_deposited) : '0.00';
  $: totalDepositors = poolData ? Number(poolData.total_depositors) : 0;
  $: totalIcpRewards = poolData ? stabilityPoolService.formatIcp(poolData.total_icp_rewards) : '0.0000';
  $: totalLiquidations = poolData ? Number(poolData.total_liquidations) : 0;
  
  // Calculate APY estimate based on recent liquidations (placeholder calculation)
  $: estimatedAPY = totalLiquidations > 0 ? '8-15%' : 'TBD';
</script>

<div class="pool-stats">
  <h2 class="stats-title">Pool Statistics</h2>
  
  <div class="stats-grid">
    <div class="stat-card primary">
      <div class="stat-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="1" x2="12" y2="23"/>
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
        </svg>
      </div>
      <div class="stat-content">
        <div class="stat-value">{totalDeposited}</div>
        <div class="stat-label">Total icUSD Deposited</div>
      </div>
    </div>

    <div class="stat-card">
      <div class="stat-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
      </div>
      <div class="stat-content">
        <div class="stat-value">{totalDepositors}</div>
        <div class="stat-label">Active Depositors</div>
      </div>
    </div>

    <div class="stat-card">
      <div class="stat-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
        </svg>
      </div>
      <div class="stat-content">
        <div class="stat-value">{totalIcpRewards}</div>
        <div class="stat-label">ICP Rewards Distributed</div>
      </div>
    </div>

    <div class="stat-card">
      <div class="stat-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 12l2 2 4-4"/>
          <circle cx="12" cy="12" r="10"/>
        </svg>
      </div>
      <div class="stat-content">
        <div class="stat-value">{totalLiquidations}</div>
        <div class="stat-label">Successful Liquidations</div>
      </div>
    </div>

    <div class="stat-card accent">
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
        <div class="stat-value">{estimatedAPY}</div>
        <div class="stat-label">Estimated APY</div>
      </div>
    </div>

    <div class="stat-card info">
      <div class="stat-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
      </div>
      <div class="stat-content">
        <div class="stat-value">10%</div>
        <div class="stat-label">Liquidation Bonus</div>
      </div>
    </div>
  </div>
</div>

<style>
  .pool-stats {
    width: 100%;
  }

  .stats-title {
    font-size: 1.5rem;
    font-weight: 600;
    color: white;
    margin-bottom: 1.5rem;
    text-align: center;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 1rem;
  }

  .stat-card {
    background: rgba(15, 23, 42, 0.8);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 1rem;
    padding: 1.5rem;
    display: flex;
    align-items: center;
    gap: 1rem;
    transition: all 0.3s ease;
  }

  .stat-card:hover {
    transform: translateY(-2px);
    border-color: rgba(244, 114, 182, 0.3);
    box-shadow: 0 10px 25px rgba(244, 114, 182, 0.1);
  }

  .stat-card.primary {
    border-color: rgba(244, 114, 182, 0.3);
    background: rgba(244, 114, 182, 0.05);
  }

  .stat-card.accent {
    border-color: rgba(168, 85, 247, 0.3);
    background: rgba(168, 85, 247, 0.05);
  }

  .stat-card.info {
    border-color: rgba(34, 197, 94, 0.3);
    background: rgba(34, 197, 94, 0.05);
  }

  .stat-icon {
    width: 2.5rem;
    height: 2.5rem;
    color: #f472b6;
    flex-shrink: 0;
  }

  .stat-card.primary .stat-icon {
    color: #f472b6;
  }

  .stat-card.accent .stat-icon {
    color: #a855f7;
  }

  .stat-card.info .stat-icon {
    color: #22c55e;
  }

  .stat-content {
    flex: 1;
  }

  .stat-value {
    font-size: 1.75rem;
    font-weight: 700;
    color: white;
    line-height: 1.2;
  }

  .stat-label {
    font-size: 0.875rem;
    color: #d1d5db;
    margin-top: 0.25rem;
  }

  /* Responsive Design */
  @media (max-width: 768px) {
    .stats-grid {
      grid-template-columns: 1fr;
    }
    
    .stat-card {
      padding: 1rem;
    }
    
    .stat-value {
      font-size: 1.5rem;
    }
  }
</style>