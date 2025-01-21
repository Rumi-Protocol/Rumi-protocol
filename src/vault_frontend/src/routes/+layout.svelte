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


  <div class="max-w-7xl mx-auto w-full pt-10">
    <h1 class="text-5xl font-bold bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-white mb-9">
      RUMI PROTOCOL
    </h1>
    
    
    
    <nav class="flex flex-wrap justify-center space-x-12 pt-5">
      
      <a 
        href="/"
        class="px-12 py-4 rounded-xl font-medium text-2xl 
               bg-gray-900 p-6 rounded-lg shadow-lg hover:bg-gray-700
               ring-2 ring-purple-400
               backdrop-blur-sm"
      >
        Mint Tokens
      </a>
      
      <a 
        href="/learn-more"
        class="px-12 py-4 rounded-xl font-medium text-2xl
               bg-gray-900 p-6 rounded-lg shadow-lg hover:bg-gray-700
               ring-2 ring-purple-400
               backdrop-blur-sm"
      >
        Learn More
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
    min-height: 100vh;
    margin: 0;
    font-family: 'Inter', system-ui, sans-serif;
    color: white;
  }
  
  :global(body) {
    background-size: 200% 200%;
  }
  
</style>