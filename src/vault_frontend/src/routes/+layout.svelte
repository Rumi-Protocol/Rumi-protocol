<script lang="ts">
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { walletStore as wallet } from "../lib/stores/wallet";
  import { permissionStore } from "../lib/stores/permissionStore";
  import WalletConnector from "../lib/components/wallet/WalletConnector.svelte";
  import PriceDebug from "../lib/components/debug/PriceDebug.svelte";
  import WalletDebug from "../lib/components/debug/WalletDebug.svelte";
  import "../app.css";
  import { protocolService } from "../lib/services/protocol";
  import { TokenService } from "../lib/services/tokenService";
  import { isDevelopment } from "../lib/config";
  import { developerAccess } from "../lib/stores/developer";

  let currentPath: string = '/';
  let permissionInitialized = false;
  let sidebarExpanded = false; // Start collapsed, only expand on hover
  
  $: ({ isConnected } = $wallet);
  
  // Use permissions from the store with proper fallbacks - include developer access
  $: isDeveloperMode = isDevelopment || ($permissionStore.initialized && $permissionStore.isDeveloper);
  $: canViewVaults = isDevelopment || $developerAccess || isConnected || ($permissionStore.initialized && $permissionStore.canViewVaults);

  // Handle wallet state changes to refresh permissions
  $: if (isConnected && !permissionInitialized) {
    // Initialize permissions when wallet connects
    console.log('Wallet connected, initializing permissions...');
    permissionStore.init().then((success) => {
      if (success) {
        permissionInitialized = true;
        console.log('Permission initialization completed successfully');
      } else {
        console.error('Permission initialization failed');
      }
    }).catch(err => {
      console.error('Failed to initialize permissions after wallet connection:', err);
      permissionInitialized = true; // Set to true to prevent infinite retry
    });
  } else if (!isConnected && permissionInitialized) {
    // Clear permissions when wallet disconnects
    console.log('Wallet disconnected, clearing permissions...');
    permissionStore.clear();
    permissionInitialized = false;
  }

  onMount(async () => {
    // Safe access to window object only in browser
    if (browser && typeof window !== 'undefined') {
      currentPath = window.location.pathname;
      window.addEventListener("popstate", () => {
        currentPath = window.location.pathname;
      });
    }
    
    // FIXED: Only initialize permissions if wallet is connected AND permissions not already being initialized
    if (isConnected && !permissionInitialized) {
      try {
        console.log('Mount: initializing permissions for connected wallet...');
        const success = await permissionStore.init();
        if (success) {
          permissionInitialized = true;
          console.log('Mount: permission initialization completed successfully');
        }
      } catch (err) {
        console.error('Failed to initialize permissions on mount:', err);
        permissionInitialized = true; // Prevent infinite loading
      }
    }
    
    // Pre-load the ICP price
    protocolService.getICPPrice()
      .then(price => console.log('Initial ICP price loaded:', price))
      .catch(err => console.error('Failed to load initial ICP price:', err));
  });
</script>

<!-- Floating Sidebar -->
<aside class="sidebar" class:expanded={sidebarExpanded}>
  <div class="sidebar-content">
    <!-- Logo & Brand -->
    <div class="sidebar-header">
      <a href="/" class="brand-link">
        <img src="/rumi-header-logo.png" alt="Rumi Labs Logo" class="brand-logo" />
        <span class="brand-text">RUMI</span>
      </a>
    </div>

    <!-- User Status Section -->
    {#if isConnected}
      <div class="user-status">
        <div class="wallet-info">
          <div class="status-indicator connected"></div>
          <span class="status-text">Connected</span>
        </div>
        <div class="balance-info">
          <span class="balance-label">Balance</span>
          <span class="balance-amount">{TokenService.formatBalance($wallet.balance)} ICP</span>
        </div>
      </div>
    {:else}
      <div class="user-status">
        <div class="wallet-info">
          <div class="status-indicator disconnected"></div>
          <span class="status-text">Not Connected</span>
        </div>
      </div>
    {/if}

    <!-- Navigation -->
    <nav class="sidebar-nav">
      <a href="/" class="nav-item" class:active={currentPath === '/'}>
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9,22 9,12 15,12 15,22"/>
        </svg>
        <span class="nav-text">Borrow icUSD</span>
      </a>

      {#if isConnected && canViewVaults}
        <a href="/vaults" class="nav-item" class:active={currentPath === '/vaults'}>
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <span class="nav-text">My Vaults</span>
        </a>
      {/if}

      <a href="/liquidations" class="nav-item" class:active={currentPath === '/liquidations'}>
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="1" x2="12" y2="23"/>
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
        </svg>
        <span class="nav-text">Liquidations</span>
      </a>

      <a href="/stability-pool" class="nav-item" class:active={currentPath === '/stability-pool'}>
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M12 1v6m0 6v6m11-7h-6m-6 0H1"/>
        </svg>
        <span class="nav-text">Stability Pool</span>
      </a>

      {#if isConnected && $permissionStore.isDeveloper}
        <a href="/treasury" class="nav-item" class:active={currentPath === '/treasury'}>
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/>
            <path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/>
            <path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>
          </svg>
          <span class="nav-text">Treasury</span>
        </a>
      {/if}

      <a href="/learn-more" class="nav-item" class:active={currentPath === '/learn-more'}>
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
        </svg>
        <span class="nav-text">Learn More</span>
      </a>
    </nav>

    <!-- Footer Actions -->
    <div class="sidebar-footer">
      <div class="icp-branding">
        <img src="/main-icp-logo.png" alt="ICP Logo" class="icp-logo-large" />
      </div>
    </div>
  </div>
</aside>

<!-- Mobile Top Bar -->
<header class="mobile-header">
  <a href="/" class="mobile-brand">
    <img src="/rumi-header-logo.png" alt="Rumi Labs Logo" class="w-8 h-8" />
    <span class="text-lg font-bold text-pink-300">RUMI PROTOCOL</span>
  </a>
  <WalletConnector />
</header>

<!-- Desktop Top Bar -->
<header class="desktop-header">
  <div class="desktop-header-content">
    <div class="header-spacer"></div>
    <div class="header-actions">
      <div class="header-social-links">
        <a href="mailto:team@rumilabs.xyz" class="header-social-link" aria-label="Email Us">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
            <polyline points="22,6 12,13 2,6"/>
          </svg>
        </a>

        <a href="https://x.com/rumilabsxyz" target="_blank" rel="noopener noreferrer" class="header-social-link" aria-label="Follow us on Twitter">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
          </svg>
        </a>
      </div>
      <div class="header-wallet">
        <WalletConnector />
      </div>
    </div>
  </div>
</header>

<!-- Main Content Area -->
<div class="main-layout" class:sidebar-expanded={sidebarExpanded}>
  <main class="main-content">
    <slot />
  </main>
</div>

<!-- Footer outside main layout to span full width -->
<footer class="app-footer">
  <div class="footer-content">
    <p>&copy; 2025 Rumi Labs LLC. All rights reserved.</p>
    {#if isConnected}
      <div class="connection-status">
        <div class="status-dot"></div>
        <span>Connected to IC Network</span>
      </div>
    {/if}
  </div>
</footer>

<!-- Sidebar Overlay for Mobile -->
{#if sidebarExpanded}
  <div 
    class="sidebar-overlay md:hidden" 
    on:click={() => sidebarExpanded = false}
    on:keydown={(e) => e.key === 'Escape' && (sidebarExpanded = false)}
  ></div>
{/if}

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

  /* Sidebar Styles */
  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    height: 100vh;
    width: 80px;
    background: rgba(15, 23, 42, 0.95);
    backdrop-filter: blur(20px);
    border-right: 1px solid rgba(255, 255, 255, 0.1);
    z-index: 1000;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    overflow: hidden;
  }

  .sidebar.expanded {
    width: 280px;
  }

  .sidebar-content {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 1.5rem 0;
    overflow-y: auto;
  }

  .sidebar-header {
    padding: 0 1.5rem;
    margin-bottom: 2rem;
  }

  .brand-link {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    text-decoration: none;
    transition: all 0.3s ease;
  }

  .brand-logo {
    width: 2.5rem;
    height: 2.5rem;
    flex-shrink: 0;
  }

  .brand-text {
    font-size: 1.5rem;
    font-weight: 700;
    color: #f472b6;
    opacity: 0;
    transform: translateX(-10px);
    transition: all 0.3s ease;
  }

  .sidebar.expanded .brand-text {
    opacity: 1;
    transform: translateX(0);
  }

  .user-status {
    padding: 0 1.5rem;
    margin-bottom: 2rem;
  }

  .wallet-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .status-indicator {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .status-indicator.connected {
    background: #10b981;
    box-shadow: 0 0 8px rgba(16, 185, 129, 0.5);
  }

  .status-indicator.disconnected {
    background: #ef4444;
  }

  .status-text {
    font-size: 0.875rem;
    color: #d1d5db;
    opacity: 0;
    transform: translateX(-10px);
    transition: all 0.3s ease;
  }

  .balance-info {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    opacity: 0;
    transform: translateX(-10px);
    transition: all 0.3s ease;
  }

  .balance-label {
    font-size: 0.75rem;
    color: #9ca3af;
  }

  .balance-amount {
    font-size: 0.875rem;
    font-weight: 600;
    color: #f472b6;
  }

  .sidebar.expanded .status-text,
  .sidebar.expanded .balance-info {
    opacity: 1;
    transform: translateX(0);
  }

  .sidebar-nav {
    flex: 1;
    padding: 0 1rem;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.875rem 0.75rem;
    margin-bottom: 0.5rem;
    text-decoration: none;
    color: #d1d5db;
    border-radius: 0.75rem;
    transition: all 0.3s ease;
    position: relative;
    overflow: hidden;
  }

  .nav-item:hover {
    background: rgba(124, 58, 237, 0.2);
    color: #ffffff;
    transform: translateX(4px);
  }

  .nav-item.active {
    background: linear-gradient(135deg, rgba(124, 58, 237, 0.3) 0%, rgba(219, 39, 119, 0.3) 100%);
    color: #ffffff;
    box-shadow: 0 4px 12px rgba(124, 58, 237, 0.3);
  }

  .nav-item.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    width: 3px;
    height: 100%;
    background: linear-gradient(180deg, #7c3aed 0%, #db2777 100%);
  }

  .nav-icon {
    width: 1.25rem;
    height: 1.25rem;
    flex-shrink: 0;
  }

  .nav-text {
    opacity: 0;
    transform: translateX(-10px);
    transition: all 0.3s ease;
    white-space: nowrap;
  }

  .sidebar.expanded .nav-text {
    opacity: 1;
    transform: translateX(0);
  }

  .sidebar-footer {
    padding: 0 1.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    padding-top: 1.5rem;
  }

  .icp-branding {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 1rem;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    transition: all 0.3s ease;
  }

  .icp-logo-large {
    width: 3rem;
    height: 3rem;
    flex-shrink: 0;
    transition: all 0.3s ease;
  }

  .icp-branding:hover {
    background: rgba(255, 255, 255, 0.1);
    transform: translateY(-2px);
  }

  /* Desktop Header */
  .desktop-header {
    position: fixed;
    top: 0;
    left: 80px; /* Start after collapsed sidebar */
    right: 0;
    height: 4rem;
    background: rgba(15, 23, 42, 0.95);
    backdrop-filter: blur(20px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    z-index: 900;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .main-layout.sidebar-expanded .desktop-header {
    left: 280px; /* Adjust when sidebar is expanded */
  }

  .desktop-header-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 100%;
    padding: 0 2rem;
  }

  .header-spacer {
    flex: 1;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .header-social-links {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .header-social-link {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 0.5rem;
    background: rgba(255, 255, 255, 0.1);
    color: #d1d5db;
    text-decoration: none;
    transition: all 0.3s ease;
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .header-social-link:hover {
    background: rgba(124, 58, 237, 0.3);
    color: #ffffff;
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(124, 58, 237, 0.3);
  }

  .header-social-link svg {
    width: 1rem;
    height: 1rem;
  }

  .header-wallet {
    display: flex;
    align-items: center;
  }

  /* Mobile Header */
  .mobile-header {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 4rem;
    background: rgba(15, 23, 42, 0.95);
    backdrop-filter: blur(20px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    z-index: 1000;
    display: none; /* Hidden by default on desktop */
    align-items: center;
    justify-content: space-between;
    padding: 0 1rem;
  }

  /* Show mobile header only on small screens */
  @media (max-width: 768px) {
    .mobile-header {
      display: flex;
    }

    .desktop-header {
      display: none;
    }
  }

  .mobile-brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    text-decoration: none;
  }

  /* Main Layout */
  .main-layout {
    margin-left: 80px;
    min-height: 100vh;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    display: flex;
    flex-direction: column;
  }

  .main-layout.sidebar-expanded {
    margin-left: 280px;
  }

  .main-content {
    flex: 1;
    padding: 8rem 2rem 2rem 2rem; /* Increased top padding for more space from header */
    max-width: 100%;

  }

  .app-footer {
    background: rgba(15, 23, 42, 0.5);
    backdrop-filter: blur(10px);
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    padding: 1.5rem 2rem;
    margin-top: 4rem;
  }

  .footer-content {
    display: flex;
    justify-content: center;
    align-items: center;
    max-width: 1200px;
    margin: 0 auto;
    width: 100%;
    gap: 2rem;
  }

  .footer-content p {
    margin: 0;
    flex-shrink: 0;
  }

  .connection-status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: #9ca3af;
  }

  .status-dot {
    width: 0.375rem;
    height: 0.375rem;
    background: #10b981;
    border-radius: 50%;
    box-shadow: 0 0 6px rgba(16, 185, 129, 0.5);
  }

  .sidebar-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 999;
  }

  /* Mobile Responsiveness */
  @media (max-width: 768px) {
    .main-layout {
      margin-left: 0;
      padding-top: 4rem;
    }

    .main-layout.sidebar-expanded {
      margin-left: 0;
    }

    .sidebar {
      transform: translateX(-100%);
    }

    .sidebar.expanded {
      transform: translateX(0);
      width: 280px;
    }

    .main-content {
      padding: 1rem;
      padding-top: 1rem;
    }

    .footer-content {
      flex-direction: column;
      gap: 1rem;
      text-align: center;
    }
  }

  /* Hover effect for desktop sidebar */
  @media (min-width: 769px) {
    .sidebar:hover {
      width: 280px;
    }

    .sidebar:hover .brand-text {
      opacity: 1;
      transform: translateX(0);
    }

    .sidebar:hover .status-text,
    .sidebar:hover .balance-info,
    .sidebar:hover .nav-text {
      opacity: 1;
      transform: translateX(0);
    }
  }
</style>


