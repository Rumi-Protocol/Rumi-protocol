<script lang="ts">
  import { onMount } from 'svelte';
  import { stabilityPoolService } from '../../services/stabilityPoolService';
  
  export let liquidationHistory: any[] = [];
  // poolData is passed but not used directly in this component
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export let poolData: any;
  
  let liquidatableVaults: any[] = [];
  let loading = false;
  let error = '';
  
  async function loadLiquidatableVaults() {
    try {
      loading = true;
      error = '';
      liquidatableVaults = await stabilityPoolService.getLiquidatableVaults();
    } catch (err: any) {
      console.error('Failed to load liquidatable vaults:', err);
      error = err.message || 'Failed to load liquidatable vaults';
    } finally {
      loading = false;
    }
  }
  
  async function triggerLiquidationCheck() {
    try {
      loading = true;
      error = '';
      const result = await stabilityPoolService.manualLiquidationCheck();
      console.log('Manual liquidation check result:', result);
      
      // Reload liquidatable vaults after check
      await loadLiquidatableVaults();
    } catch (err: any) {
      console.error('Failed to trigger liquidation check:', err);
      error = err.message || 'Failed to trigger liquidation check';
    } finally {
      loading = false;
    }
  }
  
  onMount(() => {
    loadLiquidatableVaults();
  });
  
  // Format timestamps for display
  function formatDate(timestamp: bigint): string {
    return new Date(Number(timestamp) / 1_000_000).toLocaleString();
  }
</script>

<div class="liquidation-monitor">
  <div class="monitor-header">
    <h3 class="monitor-title">Liquidation Monitor</h3>
    <button 
      class="refresh-button" 
      on:click={triggerLiquidationCheck}
      disabled={loading}
    >
      {#if loading}
        <div class="loading-spinner"></div>
        Checking...
      {:else}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
          <path d="M21 3v5h-5"/>
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
          <path d="M3 21v-5h5"/>
        </svg>
        Check Now
      {/if}
    </button>
  </div>

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

  <div class="monitor-content">
    <div class="monitor-section">
      <h4 class="section-title">
        Liquidatable Vaults ({liquidatableVaults.length})
      </h4>
      
      {#if liquidatableVaults.length === 0}
        <div class="empty-state">
          <div class="empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 12l2 2 4-4"/>
              <circle cx="12" cy="12" r="10"/>
            </svg>
          </div>
          <p>No vaults currently eligible for liquidation</p>
        </div>
      {:else}
        <div class="vaults-list">
          {#each liquidatableVaults as vault}
            <div class="vault-card">
              <div class="vault-header">
                <span class="vault-id">Vault #{Number(vault.id)}</span>
                <span class="vault-status critical">Liquidatable</span>
              </div>
              <div class="vault-details">
                <div class="vault-detail">
                  <span class="detail-label">Debt:</span>
                  <span class="detail-value">{stabilityPoolService.formatIcusd(vault.icusd_debt)} icUSD</span>
                </div>
                <div class="vault-detail">
                  <span class="detail-label">Collateral:</span>
                  <span class="detail-value">{stabilityPoolService.formatIcp(vault.icp_collateral)} ICP</span>
                </div>
                <div class="vault-detail">
                  <span class="detail-label">Ratio:</span>
                  <span class="detail-value critical">{((Number(vault.icp_collateral) / Number(vault.icusd_debt)) * 100).toFixed(1)}%</span>
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="monitor-section">
      <h4 class="section-title">
        Recent Liquidations ({liquidationHistory.length})
      </h4>
      
      {#if liquidationHistory.length === 0}
        <div class="empty-state">
          <div class="empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <p>No liquidations have occurred yet</p>
        </div>
      {:else}
        <div class="liquidations-list">
          {#each liquidationHistory.slice(0, 5) as liquidation}
            <div class="liquidation-card">
              <div class="liquidation-header">
                <span class="liquidation-vault">Vault #{Number(liquidation.vault_id)}</span>
                <span class="liquidation-time">{formatDate(liquidation.timestamp)}</span>
              </div>
              <div class="liquidation-details">
                <div class="liquidation-amounts">
                  <span class="amount-item">
                    <span class="amount-label">Debt:</span>
                    <span class="amount-value">{stabilityPoolService.formatIcusd(liquidation.icusd_amount)} icUSD</span>
                  </span>
                  <span class="amount-item">
                    <span class="amount-label">Collateral:</span>
                    <span class="amount-value">{stabilityPoolService.formatIcp(liquidation.icp_amount)} ICP</span>
                  </span>
                  <span class="amount-item bonus">
                    <span class="amount-label">Bonus:</span>
                    <span class="amount-value">{stabilityPoolService.formatIcp(liquidation.liquidation_bonus)} ICP</span>
                  </span>
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .liquidation-monitor {
    background: rgba(15, 23, 42, 0.8);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 1rem;
    padding: 1.5rem;
  }

  .monitor-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  .monitor-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: white;
  }

  .refresh-button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: rgba(244, 114, 182, 0.2);
    border: 1px solid rgba(244, 114, 182, 0.3);
    border-radius: 0.5rem;
    color: #f472b6;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .refresh-button:hover:not(:disabled) {
    background: rgba(244, 114, 182, 0.3);
  }

  .refresh-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .refresh-button svg {
    width: 1rem;
    height: 1rem;
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
    margin-bottom: 1rem;
  }

  .error-message svg {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
  }

  .monitor-content {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2rem;
  }

  .monitor-section {
    display: flex;
    flex-direction: column;
  }

  .section-title {
    font-size: 1rem;
    font-weight: 600;
    color: white;
    margin-bottom: 1rem;
  }

  .empty-state {
    text-align: center;
    padding: 2rem;
    color: #d1d5db;
  }

  .empty-icon {
    width: 3rem;
    height: 3rem;
    color: #9ca3af;
    margin: 0 auto 1rem;
  }

  .vaults-list,
  .liquidations-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .vault-card,
  .liquidation-card {
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.5rem;
    padding: 1rem;
  }

  .vault-header,
  .liquidation-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
  }

  .vault-id,
  .liquidation-vault {
    font-weight: 600;
    color: white;
  }

  .vault-status {
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .vault-status.critical {
    background: rgba(239, 68, 68, 0.2);
    color: #f87171;
  }

  .liquidation-time {
    font-size: 0.75rem;
    color: #d1d5db;
  }

  .vault-details {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .vault-detail {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .detail-label,
  .amount-label {
    color: #d1d5db;
    font-size: 0.875rem;
  }

  .detail-value,
  .amount-value {
    color: white;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .detail-value.critical {
    color: #f87171;
  }

  .liquidation-amounts {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .amount-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .amount-item.bonus .amount-value {
    color: #22c55e;
  }

  /* Responsive Design */
  @media (max-width: 768px) {
    .monitor-content {
      grid-template-columns: 1fr;
    }
    
    .monitor-header {
      flex-direction: column;
      gap: 1rem;
      align-items: stretch;
    }
  }
</style>