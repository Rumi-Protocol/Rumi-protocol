<script>
  import { onMount } from "svelte";
  import NaviLink from '$lib/components/NaviLink.svelte';
  import "../app.css";
  
  let currentPath;
  
  onMount(() => {
    currentPath = window.location.pathname;
    window.addEventListener('popstate', () => {
      currentPath = window.location.pathname;
    });
  });
</script>

<div class="min-h-screen flex flex-col">
<header class="w-full p-4 md:p-6 bg-transparent text-white relative">
  <!-- Social Icons -->
  <div class="absolute top-4 right-4 md:top-6 md:right-8 flex space-x-4 md:space-x-7 z-20">

    <a href="mailto:team@rumilabs.xyz" class="hover:opacity-80 transition">
      <img src="/email.png" alt="Email Us" class="w-6 h-6 md:w-8 md:h-8" />
    </a>

    <a href="https://x.com/rumilabsxyz" target="_blank" class="hover:opacity-80 transition">
      <img src="/twitterIcon.png" alt="Follow us on Twitter" class="w-6 h-6 md:w-8 md:h-8" />
    </a>

  </div>

  <div class="max-w-7xl mx-auto flex flex-col items-center space-y-10 px-4">
    <!-- Logo and Name Container -->
    <div class="flex flex-col md:flex-row items-center justify-center md:space-x-6 space-y-4 md:space-y-0">
      <img src="/rumi-header-logo.png" alt="Rumi Labs Logo" 
           class="w-32 md:w-32 lg:w-40 h-auto" />
      <img src="/rumi-labs-without-BG.png" alt="Rumi Labs Name" 
           class="w-56 md:w-64 lg:w-80 h-auto" />
    </div>
    
    <!-- Navigation -->
    <nav class="flex flex-col md:flex-row justify-center items-center space-y-4 md:space-y-0 md:space-x-4 w-full">
      <NaviLink href="/" active={currentPath === '/'}>
        Home
      </NaviLink>
      
      <NaviLink href="/about" active={currentPath === '/about'}>
        About Rumi
      </NaviLink>
      
      <NaviLink href="/Rumi-Protocol-3rd-Version.pdf" isWhitepaper={true}>
        Whitepaper
      </NaviLink>
    </nav>
  </div>
</header>

<!-- Main Content -->
<main class="flex-1 px-4 md:px-6">
  <slot />
</main>

<!-- Footer -->
<footer class="w-full p-4 md:p-6 bg-black/70 backdrop-blur-sm text-white">
  <div class="max-w-7xl mx-auto">
    <p class="text-sm md:text-base text-center md:text-left">
      &copy; 2025 Rumi Labs LLC. All rights reserved.
    </p>
  </div>
</footer>
</div>

<!-- Create a NavLink component for reusability -->
<script context="module">
  const NavLink = {
    props: {
      href: String,
      active: Boolean,
      isWhitepaper: Boolean
    },
    render() {
      const baseClasses = "px-6 py-3 md:px-8 rounded-xl font-medium text-lg md:text-xl transition-all duration-200";
      const regularClasses = `${baseClasses} bg-purple-700/90 hover:bg-purple-600/80 ring-2 ring-purple-400/50`;
      const whitepaperClasses = `${baseClasses} bg-gradient-to-r from-purple-700 to-pink-500 hover:from-purple-600 hover:to-pink-400 ring-2 ring-purple-400/50 shadow-lg shadow-purple-500/20`;
      
      return this.isWhitepaper ? whitepaperClasses : regularClasses;
    }
  };
</script>


<style>
  :global(body) {
    background: linear-gradient(100deg,rgb(180, 69, 187),rgb(13, 139, 177));
    min-height: 100vh;
    margin: 0;
    font-family: 'Inter', system-ui, sans-serif;
  }
  
  :global(body) {
    background-size: 200% 200%;
    animation: gradientMove 10s ease infinite;
  }
  
  @keyframes gradientMove {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }
</style>