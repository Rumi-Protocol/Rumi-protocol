<script>
  import FeatureCard from '$lib/components/FeatureCard.svelte';
  let description = "A decentralized stablecoin on ICP, bringing financial stability to Web3.";
</script>

<section class="flex flex-col items-center justify-center py-10 md:py-12 px-4 md:px-4">
  <!-- Animated Coins -->
  <div class="flex justify-center items-center space-x-2 md:space-x-4 mb-8 md:mb-12">
    <img src="/coin3.png" alt="Coin" class="w-24 h-24 md:w-32 md:h-32 lg:w-40 lg:h-40 bounce-normal" />
    <img src="/coin3.png" alt="Coin" class="w-24 h-24 md:w-32 md:h-32 lg:w-40 lg:h-40 bounce-higher" />
    <img src="/coin3.png" alt="Coin" class="w-24 h-24 md:w-32 md:h-32 lg:w-40 lg:h-40 bounce-normal" />
  </div>

  <!-- Title and Description -->
  <div class="text-center max-w-4xl mx-auto mb-12">
    <h1 class="text-3xl md:text-4xl lg:text-5xl font-bold gradient-outline mb-6 animate-title">
      icUSD - The Future of Stablecoin on ICP
    </h1>
    <p class="text-lg md:text-xl text-gray-300 animate-title" style="animation-delay: 0.3s">
      {description}
    </p>
  </div>

  <!-- Feature Cards -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 w-full max-w-5xl">
    <FeatureCard 
      title="Secure & Transparent"
      description="Built on ICP with full transparency and security."
      color="blue"
    />
    
    <FeatureCard 
      title="Fully on Chain"
      description="Easily integrate your wallet using Plug."
      color="purple"
    />
  </div>
</section>

<style>
  .animate-title {
    opacity: 0;
    animation: fadeSlideIn 1s ease-out forwards;
  }

  @keyframes fadeSlideIn {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>