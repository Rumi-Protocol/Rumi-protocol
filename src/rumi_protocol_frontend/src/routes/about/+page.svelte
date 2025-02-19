<script>
  let aboutContent = "Rumi Protocol is an innovative decentralized stablecoin solution built on Internet Computer (ICP). Our goal is to provide stability, security, and transparency in the Web3 ecosystem.";
</script>

<section class="flex flex-col items-center justify-center p-6 md:p-10 pt-10 text-white text-center">
  <div class="flex justify-center items-center space-x-5 pb-10">
    <img src="/icUSD-logo.png" alt="Coin 3" class="w-32 h-32 md:w-40 md:h-40 animate-float-1" />
    <img src="/icUSD-logo.png" alt="Coin 1" class="w-32 h-32 md:w-40 md:h-40 animate-float-2" />
    <img src="/icUSD-logo.png" alt="Coin 3" class="w-32 h-32 md:w-40 md:h-40 animate-float-3" />
  </div>

  <h2 class="text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-300 to-blue-300">
    About Rumi Protocol
  </h2>
  <p class="mt-6 text-lg max-w-3xl text-gray-200">{aboutContent}</p>

  <div class="mt-12 grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-6xl">
    <div class="bg-black/30 backdrop-blur-lg p-8 rounded-2xl shadow-xl border border-white/10 hover:border-purple-500/30 transition-all duration-300">
      <h3 class="text-2xl font-semibold text-purple-300">Security</h3>
      <p class="text-gray-300 mt-4">Built on ICP, ensuring high-speed transactions and trustless security mechanisms.</p>
    </div>
    
    <div class="bg-black/30 backdrop-blur-lg p-8 rounded-2xl shadow-xl border border-white/10 hover:border-purple-500/30 transition-all duration-300">
      <h3 class="text-2xl font-semibold text-blue-300">Transparency</h3>
      <p class="text-gray-300 mt-4">Completely open-source and verifiable, ensuring full decentralization.</p>
    </div>
    
    <div class="bg-black/30 backdrop-blur-lg p-8 rounded-2xl shadow-xl border border-white/10 hover:border-purple-500/30 transition-all duration-300">
      <h3 class="text-2xl font-semibold text-green-300">Stability</h3>
      <p class="text-gray-300 mt-4">Designed to maintain value through market incentives and collateralization.</p>
    </div>
  </div>
</section>

<style>
  .animate-float-1 { animation: float 6s ease-in-out infinite; }
  .animate-float-2 { animation: float 6s ease-in-out infinite 0.5s; }
  .animate-float-3 { animation: float 6s ease-in-out infinite 1s; }
  
  @keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-20px); }
  }
</style>
