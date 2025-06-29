<script lang="ts">
  import { walletStore } from '../../stores/wallet';
  import { CONFIG, CANISTER_IDS } from '../../config';
  import { onMount } from 'svelte';
  import { TokenService } from '../../services/tokenService';
  
  let walletState = $walletStore;
  let directPlugBalance: unknown = null;
  let directCanisterBalance: number | null = null;
  let isChecking = false;
  let status = '';
  let canisterDebugInfo: string | null = null;
  
  walletStore.subscribe(state => {
    walletState = state;
  });
  
  async function refreshBalance() {
    try {
      status = 'Refreshing balance...';
      await walletStore.refreshBalance();
      status = 'Balance refreshed';
    } catch (err) {
      status = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
    }
  }
  
  async function hardRefresh() {
    try {
      status = 'Hard refreshing wallet connection...';
      await walletStore.refreshWallet();
      status = 'Wallet refreshed';
    } catch (err) {
      status = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
    }
  }
  
  async function checkDirectBalances() {
    if (!walletState.principal) return;
    
    isChecking = true;
    status = 'Checking direct balances...';
    
    try {
      // Try getting direct Plug balance
      if (window.ic?.plug) {
        try {
          const plugBalances = await window.ic.plug.requestBalance();
          directPlugBalance = plugBalances;
          console.log('Direct Plug balances:', plugBalances);
        } catch (err) {
          console.error('Direct Plug balance error:', err);
        }
      }
      
      // Try getting direct canister balance
      try {
        const balance = await TokenService.getTokenBalance(
          CONFIG.currentIcpLedgerId, 
          walletState.principal
        );
        directCanisterBalance = Number(balance) / 100_000_000;
        console.log('Direct canister balance:', directCanisterBalance);
      } catch (err) {
        console.error('Direct canister balance error:', err);
      }
      
      status = 'Direct balance check complete';
    } catch (err) {
      status = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
    } finally {
      isChecking = false;
    }
  }

  function showCanisterIds() {
    status = 'Current canister IDs:';
    
    const canisterInfo = {
      protocol: {
        current: CONFIG.currentCanisterId,
        isMainnet: CONFIG.currentCanisterId === CANISTER_IDS.PROTOCOL
      },
      icpLedger: {
        current: CONFIG.currentIcpLedgerId,
        mainnet: CANISTER_IDS.ICP_LEDGER,
        local: CONFIG.isLocal
      },
      icusdLedger: {
        current: CONFIG.currentIcusdLedgerId,
        mainnet: CANISTER_IDS.ICUSD_LEDGER
      }
    };
    
    console.log('Canister configuration:', canisterInfo);
    
    // Format the canister info for debug display
    const formattedInfo = JSON.stringify(canisterInfo, null, 2);
    canisterDebugInfo = formattedInfo;
  }
</script>

<div class="bg-gray-800/70 backdrop-blur-sm border border-gray-700 p-4 rounded-lg">
  <h3 class="text-lg font-semibold mb-2">Wallet Debug</h3>
  
  <div class="mb-4 text-sm">
    <div class="flex justify-between mb-1">
      <span>Connected:</span>
      <span class={walletState.isConnected ? 'text-green-400' : 'text-red-400'}>
        {walletState.isConnected ? 'Yes' : 'No'}
      </span>
    </div>
    
    <div class="flex justify-between mb-1">
      <span>Principal:</span>
      <span class="text-gray-300">{walletState.principal?.toString() || 'None'}</span>
    </div>
    
    <div class="flex justify-between mb-1">
      <span>ICP Balance:</span>
      <span class="text-gray-300">
        {walletState.tokenBalances?.ICP?.formatted || '0.0000'}
      </span>
    </div>
    
    <div class="flex justify-between mb-1">
      <span>icUSD Balance:</span>
      <span class="text-gray-300">
        {walletState.tokenBalances?.ICUSD?.formatted || '0.0000'}
      </span>
    </div>
  </div>
  
  <div class="space-x-2 mb-4">
    <button 
      class="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-white text-sm" 
      on:click={refreshBalance}
    >
      Refresh Balance
    </button>
    
    <button 
      class="px-3 py-1 bg-purple-600 hover:bg-purple-500 rounded text-white text-sm" 
      on:click={hardRefresh}
    >
      Hard Refresh
    </button>
    
    <button 
      class="px-3 py-1 bg-green-700 hover:bg-green-600 rounded text-white text-sm" 
      on:click={checkDirectBalances}
      disabled={isChecking || !walletState.principal}
    >
      Check Direct Balances
    </button>

    <button 
      class="px-3 py-1 bg-yellow-600 hover:bg-yellow-500 rounded text-white text-sm" 
      on:click={showCanisterIds}
    >
      Check Canister IDs
    </button>
  </div>
  
  {#if status}
    <p class="text-yellow-400 text-sm mb-2">{status}</p>
  {/if}
  
  {#if directPlugBalance}
    <div class="mb-4 p-3 bg-gray-700/50 rounded text-sm">
      <h4 class="font-medium mb-1">Direct Plug Balance:</h4>
      <pre class="text-xs overflow-auto max-h-24">
        {JSON.stringify(directPlugBalance, null, 2)}
      </pre>
    </div>
  {/if}
  
  {#if directCanisterBalance !== null}
    <div class="mb-4 p-3 bg-gray-700/50 rounded text-sm">
      <h4 class="font-medium mb-1">Direct Canister Balance:</h4>
      <p>{directCanisterBalance} ICP</p>
    </div>
  {/if}
  
  {#if canisterDebugInfo}
    <div class="mb-4 p-3 bg-gray-700/50 rounded text-sm">
      <h4 class="font-medium mb-1">Canister Configuration:</h4>
      <pre class="text-xs overflow-auto max-h-32">
        {canisterDebugInfo}
      </pre>
    </div>
  {/if}
  
  {#if walletState.error}
    <div class="p-3 bg-red-900/50 border border-red-700 rounded text-sm">
      <h4 class="font-medium mb-1">Error:</h4>
      <p class="text-red-300">{walletState.error}</p>
    </div>
  {/if}
</div>
