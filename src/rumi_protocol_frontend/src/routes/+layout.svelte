<script lang="ts">
  import { onMount } from "svelte";
  import NaviLink from '$lib/components/NaviLink.svelte';
  import "../app.css";
  
  let currentPath: string;
  
  onMount(() => {
    currentPath = window.location.pathname;
    window.addEventListener('popstate', () => {
      currentPath = window.location.pathname;
    });
  });
</script>

<div class="min-h-screen flex flex-col">
  <header class="w-full px-6 py-4 glass-panel sticky top-0 z-50 mb-10">
    <div class="max-w-7xl mx-auto flex justify-between items-center">
      <!-- Logo section -->
      <div class="flex items-center gap-4">
        <img src="/rumi-header-logo.png" alt="Rumi Labs Logo" class="w-20 h-auto" />
        <img src="/rumi-labs-without-BG.png" alt="Rumi Labs Name" class="h-10 w-auto" />
      </div>
      
      <div class="flex items-center gap-8">
        <!-- Text-only navigation -->
        <nav class="hidden md:flex items-center gap-4">
          <div class="flex items-center gap-4 mr-6">
            <NaviLink href="/" active={currentPath === '/'} class="nav-text">Home</NaviLink>
            <NaviLink href="/about" active={currentPath === '/about'} class="nav-text">About Rumi</NaviLink>
            <NaviLink href="/Rumi-Protocol-3rd-Version.pdf" isWhitepaper={true} class="nav-text">Whitepaper</NaviLink>
          </div>
          
          <!-- Launch button remains styled -->
          <a href="https://rumiprotocol.io" 
             target="_blank" 
             class="launch-button">
            Launch Dapp
          </a>
        </nav>

        <!-- Social icons -->
        <div class="flex items-center gap-8">
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

  <main class="flex-grow px-4 md:px-6 py-8 relative z-10">
    <slot />
  </main>

  <footer class="w-full p-4 md:p-6 bg-black/40 backdrop-blur-xl text-white border-t border-white/10 mt-auto">
    <div class="max-w-7xl mx-auto flex justify-between items-center">
      <p class="text-sm md:text-base">
        &copy; 2025 Rumi Labs LLC. All rights reserved.
      </p>
      <a 
        href="https://rumiprotocol.io" 
        target="_blank" 
        class="text-sm md:text-base hover:text-purple-400 transition-colors">
        Launch Dapp →
      </a>
    </div>
  </footer>
</div>

<style>
  :global(body) {
    min-height: 100vh;
    margin: 0;
    font-family: 'Inter', system-ui, sans-serif;
    color: white;
    background: linear-gradient(135deg, #29024f 0%, #4a148c 50%, #1a237e 100%);
    background-size: 200% 200%;
    animation: gradientMove 15s ease infinite;
    display: flex;
    flex-direction: column;
  }

  @keyframes gradientMove {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }

  .glass-panel {
    @apply bg-black/20 backdrop-blur-md border-b border-white/10;
  }

  .nav-link {
    @apply px-4 py-2 rounded-lg text-gray-300 hover:text-white
           hover:bg-[#522785]/20 transition-all duration-200;
  }

  .nav-link.active {
    @apply bg-[#522785]/30 text-white;
  }

  /* Remove the large logo and name section */
  :global(.logo-section) {
    display: none;
  }

  :global(#app) {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  /* Add new styles for the launch button animation */
  a[href="https://rumiprotocol.io"] {
    position: relative;
    overflow: hidden;
  }

  a[href="https://rumiprotocol.io"]:after {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(
      90deg,
      transparent,
      rgba(255, 255, 255, 0.2),
      transparent
    );
    transition: 0.5s;
  }

  a[href="https://rumiprotocol.io"]:hover:after {
    left: 100%;
  }

  .nav-text {
    @apply text-gray-300 hover:text-white relative text-xl
           transition-all duration-200 font-semibold tracking-wide;
  }

  .nav-text::after {
    content: '';
    @apply absolute left-0 bottom-0 w-0 h-0.5 bg-purple-400
           transition-all duration-200;
  }

  .nav-text:hover::after {
    @apply w-full;
  }

  .nav-text.active {
    @apply text-white;
  }

  .nav-text.active::after {
    @apply w-full bg-purple-500;
  }

  .launch-button {
    @apply px-6 py-2 bg-gradient-to-r from-[#522785] to-[#29abe2] 
           rounded-lg font-medium text-white hover:opacity-90 
           transition-all duration-200 shadow-lg hover:shadow-xl 
           transform hover:-translate-y-0.5;
  }
</style>