<script lang="ts">
  // Fix the import to use the correct case in the filename
  import { protocolService, ProtocolService } from "../../services/protocol";
  import { walletStore } from "../../stores/wallet";
  import { developerAccess } from '../../stores/developer';
  import { onDestroy } from 'svelte';
  import { vaultStore } from '../../stores/vaultStore';
  import { safeLog } from '../../utils/bigint';
  import { BackendDebugService } from '../../services/backendDebug';



  export let icpPrice: number;
  
  let collateralAmount = "";
  let isCreating = false;
  let error = "";
  let showPasskeyInput = true; // Changed to true to show by default
  let passkey = "";
  let passkeyError = "";
  let isProcessing = false;
  let processingTimeout: NodeJS.Timeout | null = null;
  let remainingTime = 0;
  let status = '';
  let retryCount = 0;
  let retryCountdown = 0;
  let retryTimer: NodeJS.Timeout | null = null;
  
  // Add timeout constants
  const TIMEOUT_WARNING = 40000; // 40 seconds
  const TIMEOUT_INFO = 20000; // 20 seconds
  
  // Add timeout handling
  let showExtendedTimeoutInfo = false;
  let timeoutWarning = false;
  let processingStartTime = 0;
  let elapsedTime = 0;
  let processingInterval: NodeJS.Timeout | null = null;

  // Add cancel and verification functionality
  let showCancelOption = false;
  let cancelCheckRunning = false;
  let vaultCheckMode = false;

  $: potentialUsdValue = Number(collateralAmount) * icpPrice;
  $: isConnected = $walletStore.isConnected;
  $: isDeveloper = $developerAccess;


  onDestroy(() => {
    if (processingTimeout) {
      clearTimeout(processingTimeout);
    }
    if (retryTimer) clearTimeout(retryTimer);
    if (processingInterval) clearInterval(processingInterval);
  });

  function handlePasskeySubmit() {
    const isValid = developerAccess.checkPasskey(passkey);
    if (!isValid) {
      passkeyError = "Invalid developer passkey";
    } else {
      showPasskeyInput = false;
      passkeyError = "";
    }
  }

  // Add status tracking
  function updateStatus(newStatus: string) {
    console.log('Status:', newStatus);
    status = newStatus;
  }

  // Function to start auto-retry countdown
  function startRetryCountdown(seconds: number) {
    if (retryTimer) clearTimeout(retryTimer);
    
    retryCountdown = seconds;
    
    const tick = () => {
      retryCountdown--;
      if (retryCountdown <= 0) {
        // When countdown finishes, retry vault creation
        handleCreateVault();
      } else {
        // Continue countdown
        retryTimer = setTimeout(tick, 1000);
      }
    };
    
    retryTimer = setTimeout(tick, 1000);
  }
  
  // Override error handler for specific types
  function handleError(err: any) {
    if (err instanceof Error) {
      error = err.message;
      
      // Handle specific error cases
      if (
        err.message.includes('invalid response from signer') || 
        err.message.includes('Failed to sign') || 
        err.message.includes('signer')
      ) {
        error = "Wallet signature error. Try refreshing your connection.";
        // Add a button to refresh wallet in the error UI
        showWalletRefreshOption = true;
      } else if (err.message.includes('already processing') || 
          err.message.includes('System is busy')) {
        // Auto-retry for AlreadyProcessing errors
        retryCount++;
        if (retryCount < 3) {
          const retryDelay = 5 * Math.pow(2, retryCount); // 5, 10, 20 seconds
          updateStatus(`Auto-retry in ${retryDelay} seconds... (Attempt ${retryCount + 1}/3)`);
          startRetryCountdown(retryDelay);
        } else {
          updateStatus('Maximum retries reached');
        }
      } else {
        updateStatus('Failed to create vault: ' + err.message);
      }
    } else {
      error = "Failed to create vault";
      updateStatus('Failed to create vault');
    }
  }
  
  async function checkWalletPrerequisites() {
    try {
      // Check if wallet is connected
      if (!$walletStore.isConnected) {
        error = "Wallet not connected";
        return false;
      }
      
      // Check if principal exists
      if (!$walletStore.principal) {
        error = "Wallet principal not available";
        return false;
      }
      
      // Check if wallet has sufficient balance
      const amount = Number(collateralAmount);
      if (isNaN(amount) || amount <= 0) {
        error = "Invalid collateral amount";
        return false;
      }
      
      // Check wallet balance
      updateStatus('Checking balance...');
      const hasBalance = await protocolService.checkIcpAllowance(amount.toString());
      if (!hasBalance) {
        error = `Insufficient ICP balance. Required: ${amount} ICP`;
        return false;
      }
      
      return true;
    } catch (err) {
      console.error('Wallet prerequisite check failed:', err);
      error = err instanceof Error ? err.message : "Failed to check wallet status";
      return false;
    }
  }
  
  // Add support for automatic cleanup of stale processes
  async function checkSystemStatus(): Promise<boolean> {
    try {
      updateStatus('Checking system status...');
      const status = await BackendDebugService.getSystemStatus();
      
      if (status.status && 'AlreadyProcessing' in status.status.mode) {
        // Check how old the processing state is
        const timestamp = Number(status.status.lastIcpTimestamp) / 1_000_000; // Convert to ms
        const now = Date.now();
        const ageInSeconds = Math.round((now - timestamp) / 1000);
        
        // If older than 90 seconds, try to force kill it
        if (ageInSeconds > 90) {
          updateStatus(`System has been stuck for ${ageInSeconds}s. Attempting automatic cleanup...`);
          
          // Try to force kill
          const killResult = await BackendDebugService.forceKillStaleProcess();
          
          if (killResult.success) {
            updateStatus(`Successfully cleared stale process: ${killResult.message}`);
            error = '';
            return true;
          } else {
            // Manual override needed
            error = `System has been processing for ${ageInSeconds}s. ` + 
                    `Automatic reset failed: ${killResult.message}`;
            updateStatus('System is busy - stale process needs manual reset');
            return false;
          }
        } else if (ageInSeconds > 60) {
          // Between 60-90s - warn but allow retry
          error = `System is busy (started ${ageInSeconds}s ago). Will auto-reset at 90s.`;
          updateStatus('System is busy - waiting for auto-reset opportunity');
          
          // We'll return true but set a retry timer
          setTimeout(() => {
            // Check again after 5 seconds
            if (isCreating) return; // Don't retry if already creating
            
            console.log(`Stale process timer reached, rechecking system status...`);
            checkSystemStatus().then(ok => {
              if (ok) {
                updateStatus('System ready after wait period');
                error = '';
                // Could auto-trigger creation here
              }
            });
          }, 5000);
          
          return false;
        } else {
          // Recently started process, wait
          error = `System is busy (started ${ageInSeconds}s ago). Please wait.`;
          updateStatus('System is busy - recent process');
          return false;
        }
      }
      
      return true;
    } catch (err) {
      console.error('Status check failed:', err);
      error = 'Failed to check system status';
      return false;
    }
  }
  
  async function handleCreateVault() {
    if (!collateralAmount || isCreating || !isConnected) return;
    
    // Clear existing timers
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    
    // First check prerequisites and system status
    const prerequisitesOk = await checkWalletPrerequisites();
    if (!prerequisitesOk) return;
    
    const systemOk = await checkSystemStatus();
    if (!systemOk) return;
    
    // Now proceed with vault creation
    try {
      isCreating = true;
      error = "";
      retryCountdown = 0;
      updateStatus('Starting vault creation...');
      
      // Start tracking elapsed time
      startProcessingTimer();
      
      // Broken down steps for better troubleshooting
      updateStatus('Requesting ICP approval...');
      
      // Convert amount
      const amount = Number(collateralAmount); 
      console.log('Creating vault with collateral:', amount);
      
      // Create vault with longer timeouts
      const result = await protocolService.openVault(amount);
      
      // Success handling
      console.log('Vault creation succeeded:', result);
      retryCount = 0;
      collateralAmount = "";
      updateStatus('Vault created successfully!');
      
      // Refresh data
      await Promise.all([
        walletStore.refreshBalance(),
        vaultStore.loadVaults()
      ]);
      
    } catch (err) {
      console.error('Vault creation error:', err);
      
      // Better error categorization
      if (err instanceof Error) {
        if (err.message.includes('approval timeout')) {
          error = "ICP approval timed out. Please try again.";
        } else if (err.message.includes('busy') || err.message.includes('AlreadyProcessing')) {
          error = "System is busy processing another request. Please wait and try again.";
          handleRetryLogic(err);
        } else {
          error = err.message;
        }
      } else {
        error = "Failed to create vault";
      }
      
      updateStatus('Failed to create vault');
    } finally {
      isCreating = false;
      stopProcessingTimer();
    }
  }
  
  function handleRetryLogic(err: Error) {
    retryCount++;
    if (retryCount < 3) {
      const retryDelay = 5 * Math.pow(2, retryCount);
      updateStatus(`Will retry in ${retryDelay} seconds... (Attempt ${retryCount + 1}/3)`);
      startRetryCountdown(retryDelay);
    } else {
      updateStatus('Maximum retries reached. Please try manually later.');
    }
  }
  
  // Add reset function to manually attempt to clear processing state
  async function resetProcessingState() {
    try {
      updateStatus('Attempting to reset system state...');
      await BackendDebugService.attemptProcessReset();
      updateStatus('System reset attempted');
      
      // Wait a moment and then check again
      await new Promise(resolve => setTimeout(resolve, 5000));
      const status = await BackendDebugService.getSystemStatus();
      
      if (status.status && 'AlreadyProcessing' in status.status.mode) {
        updateStatus('System still busy - please try again later');
      } else {
        updateStatus('System ready');
      }
    } catch (err) {
      console.error('Reset failed:', err);
      updateStatus('Failed to reset system state');
    }
  }


  function startProcessingTimer() {
    processingStartTime = Date.now();
    
    if (processingInterval) clearInterval(processingInterval);
    
    processingInterval = setInterval(() => {
      elapsedTime = Math.floor((Date.now() - processingStartTime) / 1000);
      
      // Enhanced timeout handling
      if (elapsedTime > 30 && !showExtendedTimeoutInfo) {
        showExtendedTimeoutInfo = true;
      }
      
      if (elapsedTime > 60 && !timeoutWarning) {
        timeoutWarning = true;
        updateStatus(`Creation taking longer than expected (${elapsedTime}s)... Please be patient.`);
      }
      
      if (elapsedTime > 120 && !showCancelOption) {
        startCancelWatch();
      }
      
      // Update status with time if warning is active
      if (timeoutWarning) {
        updateStatus(`Creation in progress (${elapsedTime}s)... Please be patient.`);
      }
    }, 1000);
  }
  
  function stopProcessingTimer() {
    if (processingInterval) {
      clearInterval(processingInterval);
      processingInterval = null;
    }
    showExtendedTimeoutInfo = false;
    timeoutWarning = false;
  }

  // Add a function to forcibly clear AlreadyProcessing state
  async function forceResetSystem() {
    try {
      updateStatus('Force resetting system state...');
      isCreating = true; // Show processing state
      
      const killResult = await BackendDebugService.forceKillStaleProcess();
      
      if (killResult.success) {
        updateStatus(`Successfully reset system: ${killResult.message}`);
        error = "";
        isCreating = false;
        return true;
      } else {
        updateStatus(`Reset failed: ${killResult.message}`);
        error = `Reset failed: ${killResult.message}`;
      }
    } catch (err) {
      console.error('Reset failed:', err);
      error = 'Failed to reset system';
      updateStatus('Reset failed');
    } finally {
      isCreating = false;
    }
    return false;
  }

  function startCancelWatch() {
    setTimeout(() => {
      showCancelOption = true;
    }, 120000); // After 2 minutes, show cancel option
  }

  async function cancelVaultCreation() {
    if (isCreating) {
      if (typeof window.cancelVaultCreation === 'function') {
        const message = window.cancelVaultCreation();
        updateStatus(message);
        vaultCheckMode = true;
      }
      
      // Try to check for created vaults
      await verifyVaultCreation();
    }
  }
  
  async function verifyVaultCreation() {
    updateStatus('Checking if vault was actually created...');
    cancelCheckRunning = true;
    
    try {
      // Wait a moment to ensure vault registration
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Check vaults
      await vaultStore.loadVaults();
      const vaults = $vaultStore.vaults;
      
      if (vaults.length > 0) {
        const mostRecentVault = vaults[vaults.length - 1];
        
        // Check if recent vault matches our request
        if (mostRecentVault && Date.now() - Number(mostRecentVault.timestamp) < 300000) {
          updateStatus('Vault was created successfully (verified)');
          isCreating = false;
          showCancelOption = false;
          collateralAmount = "";
          await walletStore.refreshBalance();
        } else {
          updateStatus('No recent vault found - creation might have failed');
        }
      } else {
        updateStatus('No vaults found after check');
      }
    } catch (err) {
      console.error('Verification error:', err);
      updateStatus('Failed to verify if vault was created');
    } finally {
      cancelCheckRunning = false;
    }
  }

  // Add a function to handle wallet refreshing
  async function handleWalletRefresh() {
    try {
      updateStatus('Refreshing wallet connection...');
      isCreating = true;
      await walletStore.refreshWallet();
      updateStatus('Wallet connection refreshed, retrying...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      await handleCreateVault();
    } catch (err) {
      console.error('Wallet refresh failed:', err);
      error = 'Failed to refresh wallet. Please reconnect manually.';
      updateStatus('Wallet refresh failed');
      isCreating = false;
    }
  }
  
  // Add state for wallet refresh option
  let showWalletRefreshOption = false;
</script>

<div class="p-6 bg-gray-900/50 rounded-lg shadow-lg backdrop-blur-sm">
  <!-- Always show developer passkey input if not authenticated -->
  {#if !$developerAccess}
    <div class="mb-6 p-4 bg-gray-800/50 rounded-lg">
      <h3 class="text-lg font-semibold mb-3">Developer Access Required</h3>
      <div class="flex flex-col gap-3">
        <input
          type="password"
          bind:value={passkey}
          placeholder="Enter developer passkey"
          class="w-full px-3 py-2 bg-gray-800 rounded border border-gray-700 focus:border-purple-500"
          data-testid="developer-passkey"
        />
        <button 
          class="w-full px-4 py-2 bg-purple-600 rounded hover:bg-purple-500 transition-colors"
          on:click={handlePasskeySubmit}
          data-testid="unlock-developer-mode"
        >
          Unlock Developer Mode
        </button>
        {#if passkeyError}
          <p class="text-red-500 text-sm" data-testid="passkey-error">{passkeyError}</p>
        {/if}
      </div>
    </div>
    <p class="text-center text-gray-400">Vault creation is currently in developer mode</p>
  {:else}
    <h2 class="text-2xl font-bold mb-4">Create New Vault</h2>
  
    <div class="space-y-4">
      <div>
        <label for="vault-label" class="block text-sm font-medium text-gray-300 mb-1">
          Collateral Amount (ICP)
        </label>
        <input
          id="vault-label"
          type="number"
          bind:value={collateralAmount}
          placeholder="Enter ICP amount"
          class="w-full px-3 py-2 bg-gray-800 rounded border border-gray-700 focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
          min="0"
          step="0.1"
          data-testid="icp-amount"
        />
        {#if collateralAmount}
          <p class="mt-1 text-sm text-gray-400">
            ≈ ${potentialUsdValue.toFixed(2)} USD
          </p>
        {/if}
      </div>

<button
  on:click={handleCreateVault}
  disabled={!collateralAmount }
  class="w-full px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-500 disabled:opacity-50"
  data-testid="create-vault-button" 
>
  Create Vault
</button>

      {#if error}
        <p class="text-red-400 text-sm mt-2" data-testid="error-message">
          {error}
          {#if isProcessing && remainingTime > 0}
            ({remainingTime}s remaining)
          {/if}
        </p>
        
        <!-- Add a wallet refresh option -->
        {#if showWalletRefreshOption}
          <div class="mt-2 p-3 bg-blue-900/30 border border-blue-700 rounded">
            <p class="text-sm text-blue-300 mb-2">
              Your wallet connection may need to be refreshed.
            </p>
            <button
              class="px-3 py-1 text-sm bg-blue-700 hover:bg-blue-600 rounded"
              on:click={handleWalletRefresh}
            >
              Refresh Wallet Connection
            </button>
          </div>
        {/if}
        
        <!-- Keep existing retry logic -->
        {#if error && (error.includes("already processing") || error.includes("busy"))}
          <div class="mt-2">
            {#if retryCountdown > 0}
              <p class="text-yellow-400">
                Auto-retry in {retryCountdown} seconds... (Attempt {retryCount}/3)
              </p>
            {:else if retryCount >= 3}
              <div class="flex flex-col gap-2">
                <p class="text-orange-400">
                  Maximum auto-retries reached. You can manually retry or reset the system state.
                </p>
                <div class="flex gap-2">
                  <button 
                    class="px-3 py-1 text-sm bg-purple-700 hover:bg-purple-600 rounded"
                    on:click={() => {
                      retryCount = 0;
                      handleCreateVault();
                    }}
                  >
                    Try Again
                  </button>
                  <button 
                    class="px-3 py-1 text-sm bg-orange-800 hover:bg-orange-700 rounded"
                    on:click={resetProcessingState}
                  >
                    Reset System State
                  </button>
                </div>
              </div>
            {/if}
          </div>
        {/if}
      {/if}

      {#if !isConnected}
        <p class="text-yellow-400 text-sm mt-2">
          Please connect your wallet first
        </p>
      {/if}
    </div>
  {/if}
  <div class="mt-4">
    {#if status}
      <p class="text-sm text-gray-400">{status}</p>
    {/if}
  </div>

  <!-- Add timeout messaging -->
  {#if isCreating}
    <div class="mt-4 text-sm">
      <div class="flex items-center gap-2 text-yellow-400">
        <div class="animate-spin h-4 w-4 border-2 border-yellow-400 rounded-full border-t-transparent"></div>
        <p>Processing request ({elapsedTime}s)</p>
      </div>
      
      {#if showExtendedTimeoutInfo}
        <p class="text-gray-400 text-xs mt-1">
          Vault creation can take up to 60 seconds. Please be patient.
        </p>
      {/if}
      
      {#if timeoutWarning}
        <p class="text-orange-400 text-xs mt-1">
          This is taking longer than expected. Continue waiting or try again later.
        </p>
      {/if}
    </div>
  {/if}

  <!-- Modify the force reset UI to show more information -->
  {#if error && error.includes("stale process")}
    <div class="mt-4 p-3 bg-yellow-900/50 border border-yellow-500 rounded">
      <p class="text-yellow-200 text-sm mb-2">System appears to be stuck in processing state</p>
      <div class="flex flex-col gap-2">
        <p class="text-xs text-gray-300">
          Processes older than 90 seconds will be automatically reset. You can also try a manual reset:
        </p>
        <button 
          class="px-4 py-2 bg-yellow-700 hover:bg-yellow-600 rounded text-sm"
          on:click={forceResetSystem}
        >
          Force Reset System State
        </button>
      </div>
    </div>
  {/if}

  <!-- Add cancel option when timeout gets excessive -->
  {#if isCreating && elapsedTime > 120 && showCancelOption}
    <div class="mt-4 p-4 bg-red-900/50 border border-red-500 rounded">
      <p class="text-white mb-3">
        Warning: Vault creation has been running for more than {Math.floor(elapsedTime / 60)} minutes.
        This is unusually long and may indicate a network issue.
      </p>
      
      <div class="flex justify-between gap-4">
        <button 
          class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
          on:click={verifyVaultCreation}
          disabled={cancelCheckRunning}
        >
          Check If Vault Was Created
        </button>
        
        <button 
          class="px-4 py-2 bg-red-700 hover:bg-red-600 rounded text-sm"
          on:click={cancelVaultCreation}
          disabled={cancelCheckRunning}
        >
          Emergency Cancel
        </button>
      </div>
      
      <p class="text-gray-300 text-xs mt-2">
        Note: Cancelling won't stop the blockchain operation.
        It will only stop waiting for a response.
      </p>
    </div>
  {/if}
</div>
