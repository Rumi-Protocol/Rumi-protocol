<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { walletStore } from '../../stores/wallet';
  import { stabilityPoolService } from '../../services/stabilityPoolService';
  import { walletOperations } from '../../services/protocol/walletOperations';
  
  // poolData is passed but not used directly in this component
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export let poolData: any;
  export let userDeposit: any;
  
  const dispatch = createEventDispatcher();
  
  let depositAmount = '';
  let withdrawAmount = '';
  let loading = false;
  let error = '';
  let activeTab: 'deposit' | 'withdraw' = 'deposit';
  let icusdBalance = 0n;
  
  $: isConnected = $walletStore.isConnected;
  $: maxWithdrawable = userDeposit ? stabilityPoolService.formatIcusd(userDeposit.amount) : '0.00';
  
  // Load user's icUSD balance
  async function loadIcusdBalance() {
    if (!isConnected) return;
    
    try {
      const balance = await walletOperations.getIcusdBalance();
      icusdBalance = BigInt(Math.floor(balance * 100_000_000)); // Convert to smallest unit
    } catch (err) {
      console.error('Failed to load icUSD balance:', err);
    }
  }
  
  $: if (isConnected) {
    loadIcusdBalance();
  }
  
  async function handleDeposit() {
    if (!depositAmount || parseFloat(depositAmount) <= 0) {
      error = 'Please enter a valid deposit amount';
      return;
    }
    
    try {
      loading = true;
      error = '';
      
      const amount = stabilityPoolService.parseIcusdAmount(depositAmount);
      
      // Check if user has sufficient balance
      if (amount > icusdBalance) {
        error = 'Insufficient icUSD balance';
        return;
      }
      
      await stabilityPoolService.deposit(amount);
      dispatch('depositSuccess');
      depositAmount = '';
      
    } catch (err: any) {
      console.error('Deposit failed:', err);
      error = err.message || 'Failed to deposit';
    } finally {
      loading = false;
    }
  }
  
  async function handleWithdraw() {
    if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) {
      error = 'Please enter a valid withdrawal amount';
      return;
    }
    
    if (!userDeposit) {
      error = 'No deposit found';
      return;
    }
    
    try {
      loading = true;
      error = '';
      
      const amount = stabilityPoolService.parseIcusdAmount(withdrawAmount);
      
      // Check if user has sufficient deposit
      if (amount > userDeposit.amount) {
        error = 'Insufficient deposited amount';
        return;
      }
      
      await stabilityPoolService.withdraw(amount);
      dispatch('withdrawSuccess');
      withdrawAmount = '';
      
    } catch (err: any) {
      console.error('Withdrawal failed:', err);
      error = err.message || 'Failed to withdraw';
    } finally {
      loading = false;
    }
  }
  
  function setMaxDeposit() {
    depositAmount = stabilityPoolService.formatIcusd(icusdBalance);
  }
  
  function setMaxWithdraw() {
    if (userDeposit) {
      withdrawAmount = stabilityPoolService.formatIcusd(userDeposit.amount);
    }
  }
</script>

<div class="deposit-interface">
  <div class="interface-header">
    <h3 class="interface-title">Manage Position</h3>
    <div class="tab-buttons">
      <button 
        class="tab-button" 
        class:active={activeTab === 'deposit'}
        on:click={() => { activeTab = 'deposit'; error = ''; }}
      >
        Deposit
      </button>
      <button 
        class="tab-button" 
        class:active={activeTab === 'withdraw'}
        on:click={() => { activeTab = 'withdraw'; error = ''; }}
        disabled={!userDeposit}
      >
        Withdraw
      </button>
    </div>
  </div>

  {#if !isConnected}
    <div class="connect-prompt">
      <div class="prompt-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 12l2 2 4-4"/>
          <path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c2.39 0 4.58.93 6.21 2.44"/>
        </svg>
      </div>
      <p>Connect your wallet to deposit icUSD into the stability pool</p>
    </div>
  {:else}
    <div class="interface-content">
      {#if activeTab === 'deposit'}
        <div class="deposit-form">
          <div class="balance-info">
            <span class="balance-label">Available icUSD:</span>
            <span class="balance-amount">{stabilityPoolService.formatIcusd(icusdBalance)}</span>
          </div>
          
          <div class="input-group">
            <label for="deposit-amount" class="input-label">Deposit Amount</label>
            <div class="input-container">
              <input
                id="deposit-amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                bind:value={depositAmount}
                disabled={loading}
                class="amount-input"
              />
              <div class="input-suffix">
                <span class="currency">icUSD</span>
                <button class="max-button" on:click={setMaxDeposit} disabled={loading}>
                  MAX
                </button>
              </div>
            </div>
          </div>
          
          <button 
            class="action-button deposit-button"
            on:click={handleDeposit}
            disabled={loading || !depositAmount || parseFloat(depositAmount) <= 0}
          >
            {#if loading}
              <div class="loading-spinner"></div>
              Depositing...
            {:else}
              Deposit icUSD
            {/if}
          </button>
        </div>
      {:else}
        <div class="withdraw-form">
          <div class="balance-info">
            <span class="balance-label">Deposited Amount:</span>
            <span class="balance-amount">{maxWithdrawable} icUSD</span>
          </div>
          
          <div class="input-group">
            <label for="withdraw-amount" class="input-label">Withdrawal Amount</label>
            <div class="input-container">
              <input
                id="withdraw-amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                bind:value={withdrawAmount}
                disabled={loading}
                class="amount-input"
              />
              <div class="input-suffix">
                <span class="currency">icUSD</span>
                <button class="max-button" on:click={setMaxWithdraw} disabled={loading}>
                  MAX
                </button>
              </div>
            </div>
          </div>
          
          <button 
            class="action-button withdraw-button"
            on:click={handleWithdraw}
            disabled={loading || !withdrawAmount || parseFloat(withdrawAmount) <= 0}
          >
            {#if loading}
              <div class="loading-spinner"></div>
              Withdrawing...
            {:else}
              Withdraw icUSD
            {/if}
          </button>
        </div>
      {/if}
      
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
  {/if}
</div>

<style>
  .deposit-interface {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .interface-header {
    margin-bottom: 1.5rem;
  }

  .interface-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: white;
    margin-bottom: 1rem;
  }

  .tab-buttons {
    display: flex;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 0.5rem;
    padding: 0.25rem;
  }

  .tab-button {
    flex: 1;
    padding: 0.5rem 1rem;
    background: transparent;
    border: none;
    border-radius: 0.375rem;
    color: #d1d5db;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .tab-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .tab-button.active {
    background: linear-gradient(135deg, #f472b6, #a855f7);
    color: white;
  }

  .connect-prompt {
    text-align: center;
    padding: 2rem;
    color: #d1d5db;
  }

  .prompt-icon {
    width: 3rem;
    height: 3rem;
    color: #f472b6;
    margin: 0 auto 1rem;
  }

  .interface-content {
    flex: 1;
  }

  .balance-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    padding: 0.75rem;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 0.5rem;
  }

  .balance-label {
    color: #d1d5db;
    font-size: 0.875rem;
  }

  .balance-amount {
    color: white;
    font-weight: 600;
  }

  .input-group {
    margin-bottom: 1.5rem;
  }

  .input-label {
    display: block;
    color: #d1d5db;
    font-size: 0.875rem;
    font-weight: 500;
    margin-bottom: 0.5rem;
  }

  .input-container {
    position: relative;
    display: flex;
    align-items: center;
  }

  .amount-input {
    width: 100%;
    padding: 0.75rem 1rem;
    padding-right: 6rem;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.5rem;
    color: white;
    font-size: 1rem;
  }

  .amount-input:focus {
    outline: none;
    border-color: #f472b6;
    box-shadow: 0 0 0 3px rgba(244, 114, 182, 0.1);
  }

  .input-suffix {
    position: absolute;
    right: 0.75rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .currency {
    color: #d1d5db;
    font-size: 0.875rem;
  }

  .max-button {
    padding: 0.25rem 0.5rem;
    background: rgba(244, 114, 182, 0.2);
    border: 1px solid rgba(244, 114, 182, 0.3);
    border-radius: 0.25rem;
    color: #f472b6;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .max-button:hover:not(:disabled) {
    background: rgba(244, 114, 182, 0.3);
  }

  .max-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .action-button {
    width: 100%;
    padding: 0.875rem;
    border: none;
    border-radius: 0.5rem;
    font-weight: 600;
    font-size: 1rem;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .action-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .deposit-button {
    background: linear-gradient(135deg, #f472b6, #a855f7);
    color: white;
  }

  .deposit-button:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 10px 25px rgba(244, 114, 182, 0.3);
  }

  .withdraw-button {
    background: linear-gradient(135deg, #a855f7, #3b82f6);
    color: white;
  }

  .withdraw-button:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 10px 25px rgba(168, 85, 247, 0.3);
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
    margin-top: 1rem;
  }

  .error-message svg {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
  }
</style>