<script lang="ts">
  import { auth, selectedWalletType, connectionError } from '$lib/services/auth';
  import { walletStore } from '$lib/stores/wallet';
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();

  let isConnecting = false;
  let showOptions = false;

  $: isConnected = $walletStore.isConnected || $auth.isConnected;
  $: walletType = $selectedWalletType || $auth.walletType;
  $: error = $connectionError;

  // Debug reactive statements
  $: console.log('WalletSelector state:', {
    isConnected,
    walletType,
    walletStoreConnected: $walletStore.isConnected,
    authConnected: $auth.isConnected,
    authWalletType: $auth.walletType
  });

  async function connectWithPlug() {
    isConnecting = true;
    try {
      await walletStore.connect('plug');
      showOptions = false;
      dispatch('connected', { type: 'plug' });
    } catch (err) {
      console.error('Plug connection failed:', err);
    } finally {
      isConnecting = false;
    }
  }

  async function connectWithII() {
    isConnecting = true;
    try {
      console.log('WalletSelector: Starting II connection...');
      const result = await auth.connectInternetIdentity();
      console.log('WalletSelector: II connection result:', result);
      console.log('WalletSelector: Auth state after connection:', $auth);
      showOptions = false;
      dispatch('connected', { type: 'internet-identity' });
    } catch (err) {
      console.error('Internet Identity connection failed:', err);
    } finally {
      isConnecting = false;
    }
  }

  async function disconnect() {
    try {
      // Disconnect based on wallet type
      if ($selectedWalletType === 'internet-identity') {
        await auth.disconnect();
      } else {
        await walletStore.disconnect();
      }
      dispatch('disconnected');
    } catch (err) {
      console.error('Disconnect failed:', err);
    }
  }

  function toggleOptions() {
    showOptions = !showOptions;
  }
</script>

<div class="wallet-selector">
  {#if !isConnected}
    <div class="relative">
      <button
        class="connect-button"
        on:click={toggleOptions}
        disabled={isConnecting}
      >
        {isConnecting ? 'Connecting...' : 'Connect Wallet'}
      </button>

      {#if showOptions}
        <div class="wallet-options">
          <button class="wallet-option" on:click={connectWithPlug}>
            <div class="wallet-option-content">
              <span class="wallet-icon">🔌</span>
              <div>
                <div class="wallet-name">Plug Wallet</div>
                <div class="wallet-description">Browser extension wallet</div>
              </div>
            </div>
          </button>

          <button class="wallet-option" on:click={connectWithII}>
            <div class="wallet-option-content">
              <span class="wallet-icon">🆔</span>
              <div>
                <div class="wallet-name">Internet Identity</div>
                <div class="wallet-description">Native ICP authentication</div>
              </div>
            </div>
          </button>
        </div>
      {/if}
    </div>

    {#if error}
      <div class="error-message">
        {error}
      </div>
    {/if}
  {:else}
    <div class="connected-info">
      <span class="status-indicator"></span>
      <span class="wallet-type">
        {walletType === 'internet-identity' ? 'Internet Identity' : 'Plug Wallet'}
      </span>
      <button class="disconnect-button" on:click={disconnect}>
        Disconnect
      </button>
    </div>
  {/if}
</div>

<style>
  .wallet-selector {
    position: relative;
  }

  .connect-button {
    background: linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%);
    color: white;
    padding: 0.75rem 1.5rem;
    border-radius: 0.5rem;
    font-weight: 600;
    border: none;
    cursor: pointer;
    transition: all 0.3s ease;
  }

  .connect-button:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 10px 20px rgba(236, 72, 153, 0.3);
  }

  .connect-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .wallet-options {
    position: absolute;
    top: calc(100% + 0.5rem);
    left: 0;
    right: 0;
    background: rgba(31, 41, 55, 0.95);
    backdrop-filter: blur(16px);
    border: 1px solid rgba(139, 92, 246, 0.3);
    border-radius: 0.75rem;
    padding: 0.5rem;
    z-index: 50;
    min-width: 280px;
  }

  .wallet-option {
    width: 100%;
    background: transparent;
    border: 1px solid rgba(75, 85, 99, 0.3);
    padding: 1rem;
    border-radius: 0.5rem;
    cursor: pointer;
    transition: all 0.2s ease;
    margin-bottom: 0.5rem;
  }

  .wallet-option:last-child {
    margin-bottom: 0;
  }

  .wallet-option:hover {
    background: rgba(139, 92, 246, 0.1);
    border-color: rgba(139, 92, 246, 0.5);
  }

  .wallet-option-content {
    display: flex;
    align-items: center;
    gap: 1rem;
    text-align: left;
  }

  .wallet-icon {
    font-size: 2rem;
  }

  .wallet-name {
    font-weight: 600;
    color: white;
    margin-bottom: 0.25rem;
  }

  .wallet-description {
    font-size: 0.75rem;
    color: rgba(156, 163, 175, 1);
  }

  .connected-info {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: rgba(31, 41, 55, 0.6);
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(139, 92, 246, 0.3);
  }

  .status-indicator {
    width: 8px;
    height: 8px;
    background: #10b981;
    border-radius: 50%;
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .wallet-type {
    color: white;
    font-weight: 500;
    flex: 1;
  }

  .disconnect-button {
    background: rgba(239, 68, 68, 0.2);
    color: #ef4444;
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
    border: 1px solid rgba(239, 68, 68, 0.3);
    cursor: pointer;
    font-size: 0.875rem;
    transition: all 0.2s ease;
  }

  .disconnect-button:hover {
    background: rgba(239, 68, 68, 0.3);
  }

  .error-message {
    margin-top: 0.5rem;
    padding: 0.75rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 0.5rem;
    color: #fca5a5;
    font-size: 0.875rem;
  }
</style>
