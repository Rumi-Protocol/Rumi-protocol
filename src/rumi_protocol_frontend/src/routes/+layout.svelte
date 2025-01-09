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

<header class="w-full p-14 bg-transparent text-white text-center">
  <div class="max-w-7xl mx-auto w-full">
    <h1 class="text-5xl font-bold bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-white mb-9">
      Rumi Protocol
    </h1>
    
    <nav class="flex justify-center space-x-6">
       <a 
        href="/" 
        class="px-10 py-4 rounded-xl font-medium text-2xl transition-all duration-200
               bg-purple-900/50 hover:bg-purple-600/30
               {currentPath === '/' ? 'bg-purple-500/40 ring-2 ring-purple-400' : ''}
               backdrop-blur-sm"
      >
        Home
      </a>
      
      <a 
        href="/about"
        class="px-10 py-4 rounded-xl font-medium text-2xl transition-all duration-200
               bg-purple-900/50 hover:bg-purple-600/30
               {currentPath === '/about' ? 'bg-purple-500/40 ring-2 ring-purple-400' : ''}
               backdrop-blur-sm"
      >
        About
      </a>
      
      <a 
        href="/Rumi-Protocol-Whitepaper.pdf"
        target="_blank"
        class="px-12 py-4 rounded-xl font-medium text-2xl
               bg-gradient-to-r from-purple-700 to-pink-700
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

<main>
  <slot />
</main>

<footer class="w-full p-6 bg-gray-900 text-white">
  <div class="max-w-7xl mx-auto">
    <p class="text-gray-400">&copy; 2025 Rumi Labs LLC. All rights reserved.</p>
  </div>
</footer>

<style>
  :global(body) {
    background: linear-gradient(135deg, #9b5de5 0%, #f15bb5 100%);
    min-height: 100vh;
    margin: 0;
    font-family: 'Inter', system-ui, sans-serif;
    color: white;
  }
  
  /* Smooth transition for gradient background */
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