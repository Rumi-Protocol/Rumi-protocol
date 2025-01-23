<script>
  import { onMount } from "svelte";
  import "../app.css";
  
  // Track active route
  let currentPath;
  
  onMount(() => {
    currentPath = window.location.pathname;
    // Update active state on navigation
    window.addEventListener('popstate', () => {
      currentPath = window.location.pathname;
    });
  });
</script>


<header class="w-full p-1 bg-transparent text-white text-center p-20 pt-10 relative">

  <!-- Social Icons (Absolute Positioned) -->
  <div class="absolute top-6 right-8 flex space-x-7">
    <!-- Email Icon -->
    <a href="mailto:team@rumilabs.xyz" class="hover:opacity-80 transition">
      <img src="/email.png" alt="Email Us" class="w-8 h-8" />
    </a>

    <!-- Twitter Icon -->
    <a href="https://x.com/rumilabsxyz" target="_blank" class="hover:opacity-80 transition">
      <img src="/twitterIcon.png" alt="Follow us on Twitter" class="w-8 h-8" />
    </a>
  </div>


  <div class="max-w-7xl mx-auto w-full flex flex-wrap flex-col items-center mt-10 px-4 sm:px-6 md:px-8 lg:px-12">
    <!-- Logo and Name (as Image) in One Row -->
    <div class="flex items-center space-x-8 pb-7 sm:space-x-6">
      <img src="/rumi-header-logo.png" alt="Rumi Labs Logo" class="w-60 md:w-80 lg:w-56 h-auto" />
      <img src="/rumi-labs-without-BG.png" alt="Rumi Labs Name" class="w-60 md:w-80 lg:w-96 h-auto" />
    </div>
    
    <nav class="flex flex-wrap justify-center space-x-4 pt-5">
      <a 
        href="/" 
        class="px-10 py-4 rounded-xl font-medium text-2xl transition-all duration-200
               bg-purple-700/100 hover:bg-purple-600/30 
               ring-2 ring-purple-400
               {currentPath === '/' ? 'bg-purple-500/40 ring-2 ring-purple-400' : ''}
               backdrop-blur-sm"
      >
        Home
      </a>
      
      <a 
        href="/about"
        class="px-10 py-4 rounded-xl font-medium text-2xl transition-all duration-200
               bg-purple-700/100 hover:bg-purple-600/30
               ring-2 ring-purple-400
               {currentPath === '/about' ? 'bg-purple-500/40 ring-2 ring-purple-400' : ''}
               backdrop-blur-sm"
      >
        About Rumi
      </a>
      
      <a 
        href="/Rumi-Protocol-3rd-Version.pdf"
        target="_blank"
        class="px-12 py-4 rounded-xl font-medium text-2xl
               bg-gradient-to-r from-purple-700 to-pink-500
               ring-2 ring-purple-400
               hover:from-purple-500 hover:to-pink-500
               text-white transition-all duration-300 
               shadow-lg shadow-purple-500/20 hover:shadow-purple-500/40
               backdrop-blur-sm"
      >
        Rumi Protocol Whitepaper
      </a>
    </nav>
  </div>
</header>

<div class="flex flex-col min-h-screen">
  <main class="flex-grow">
    <slot />
  </main>

  <footer class="w-full p-6 bg-gray-900 text-white">
    <div class="max-w-7xl">
      <p class="text-white">&copy; 2025 Rumi Labs LLC. All rights reserved.</p>
    </div>
  </footer>
</div>


<style>
  :global(body) {
    background: linear-gradient(100deg, #5625c7, #c643c6);
    min-height: 100vh;
    margin: 0;
    font-family: 'Inter', system-ui, sans-serif;
    color: white;
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