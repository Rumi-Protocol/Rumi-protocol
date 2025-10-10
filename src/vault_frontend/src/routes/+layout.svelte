<script lang="ts">
  import { onMount } from "svelte";
  import { walletStore as wallet } from "../lib/stores/wallet";
  import { permissionStore } from "../lib/stores/permissionStore";
  import WalletSelector from "../lib/components/WalletSelector.svelte";
  import PriceDebug from "../lib/components/debug/PriceDebug.svelte";
  import WalletDebug from "../lib/components/debug/WalletDebug.svelte";
  import "../app.css";
  import { protocolService } from "../lib/services/protocol";
  import { isDevelopment } from "../lib/config";

  let currentPath: string;
  $: ({ isConnected } = $wallet);
  
  // Use permissions from the store instead of direct developerAccess
  $: isDeveloperMode = isDevelopment || $permissionStore.isDeveloper;
  $: canViewVaults = $permissionStore.canViewVaults;

  onMount(async () => {
    currentPath = window.location.pathname;
    window.addEventListener("popstate", () => {
      currentPath = window.location.pathname;
    });
    
    // Initialize permissions
    await permissionStore.init();
    
    // Pre-load the ICP price
    protocolService.getICPPrice()
      .then(price => console.log('Initial ICP price loaded:', price))
      .catch(err => console.error('Failed to load initial ICP price:', err));
  });
</script>

<header class="w-full px-6 py-4 glass-panel sticky top-0 z-50 mb-10">
  <div class="max-w-7xl mx-auto flex justify-between items-center">
    <a href="/" class="flex items-center gap-4 group">
      <img src="/rumi-header-logo.png" alt="Rumi Labs Logo" class="w-16 h-auto transition-transform group-hover:scale-105" />
      <h1 class="text-3xl font-bold text-pink-300 group-hover:text-pink-200 transition-colors">
        RUMI PROTOCOL
      </h1>
    </a>
    
    <div class="flex items-center gap-6">
      <nav class="hidden md:flex space-x-4">
        <a href="/" class="nav-link" class:active={currentPath === '/'}>Borrow icUSD</a>
        {#if isConnected && canViewVaults}
            <a href="/vaults" class="nav-link" class:active={currentPath === '/vaults'}>My Vaults</a>  
        {/if}
        <a href="/liquidations" class="nav-link" class:active={currentPath === '/liquidations'}>Liquidations</a>
        <a href="/learn-more" class="nav-link" class:active={currentPath === '/learn-more'}>Learn More</a>
      </nav>

      <div class="flex items-center gap-8">
        <WalletSelector />
        <a href="mailto:team@rumilabs.xyz" class="hover:opacity-80 transition" aria-label="Email Us">
          <img src="/message-outline-512.png" alt="Email" class="w-8 h-8" />
        </a>

        <a href="https://x.com/rumilabsxyz" target="_blank" rel="noopener noreferrer" class="hover:opacity-80 transition" aria-label="Follow us on Twitter">
          <img src="/twitter-x-256.png" alt="Twitter" class="w-8 h-8" />
        </a>
      </div>
    </div>
  </div>
</header>

<div class="flex flex-col min-h-screen">
  <main class="flex-grow">
    <slot />
  </main>

  <footer class="w-full p-6 bg-gray-900/50 backdrop-blur-sm text-white mt-40">
    <div class="max-w-7xl mx-auto flex justify-between items-center">
      <p class="text-white">&copy; 2025 Rumi Labs LLC. All rights reserved.</p>
      {#if isConnected}
        <div class="text-sm text-gray-400">Connected to Internet Computer Network</div>
      {/if}
    </div>
  </footer>
</div>

<!-- Only show the debug component in development mode -->
{#if isDevelopment}
  <div class="fixed bottom-4 right-4 z-50">
    <div class="flex flex-col gap-2">
      <PriceDebug />
      <WalletDebug />
    </div>
  </div>
{/if}

<style>
  :global(body) {
    min-height: 100vh;
    margin: 0;
    font-family: 'Inter', system-ui, sans-serif;
    color: white;
    background: linear-gradient(135deg, #29024f 0%, #4a148c 50%, #1a237e 100%);
    background-size: 200% 200%;
    color-scheme: dark;
  }

  :global(body) {
    background-size: 200% 200%;
    animation: gradientMove 15s ease infinite;
  }
  
  @keyframes gradientMove {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }

  .glass-panel {
    backdrop-filter: blur(20px);
  }

  .nav-link {
    padding: 0.5rem 1rem;
    border-radius: 0.5rem;
    color: rgba(209, 213, 219, var(--tw-text-opacity));
    transition-property: all;
    transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
    transition-duration: 200ms;
  }

  .nav-link:hover {
    color: rgba(255, 255, 255, var(--tw-text-opacity));
    background-color: rgba(82, 39, 133, 0.2);
  }

  .nav-link.active {
    background-color: rgba(82, 39, 133, 0.3);
    color: rgba(255, 255, 255, var(--tw-text-opacity));
  }
</style>


