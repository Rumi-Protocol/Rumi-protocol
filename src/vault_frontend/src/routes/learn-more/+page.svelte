<script lang="ts">
  const features = [
    {
      title: "Secure Collateral",
      description: "Your ICP collateral is securely stored in the protocol's smart contracts on the Internet Computer blockchain.",
      icon: "🔒"
    },
    {
      title: "Stable Value",
      description: "icUSD maintains a stable 1:1 ratio with USD, providing a reliable store of value on ICP.",
      icon: "💵"
    },
    {
      title: "Transparent",
      description: "All protocol operations are fully on-chain and verifiable through the Internet Computer blockchain.",
      icon: "🔍"
    },
    {
      title: "Decentralized",
      description: "Fully autonomous and decentralized protocol with no central authority or intermediaries.",
      icon: "🌐"
    }
  ];

  const howItWorks = [
    {
      step: 1,
      title: "Connect Your Wallet",
      description: "Use Plug wallet to connect to the Rumi Protocol dApp."
    },
    {
      step: 2,
      title: "Create a Vault",
      description: "Deposit ICP as collateral to create your vault."
    },
    {
      step: 3,
      title: "Mint icUSD",
      description: "Generate icUSD stablecoins against your ICP collateral."
    },
    {
      step: 4,
      title: "Manage Your Position",
      description: "Monitor your vault's health and adjust your position as needed."
    }
  ];

  import { onMount } from 'svelte';
  import { protocolService } from '$lib/services/protocol';
  import ProtocolStats from '$lib/components/dashboard/ProtocolStats.svelte';
  
  let protocolStatus = {
    mode: 'GeneralAvailability',
    totalIcpMargin: 0,
    totalIcusdBorrowed: 0,
    lastIcpRate: 0,
    lastIcpTimestamp: 0,
    totalCollateralRatio: 0
  };
  
  let isLoading = true;
  
  async function fetchData() {
    try {
      const status = await protocolService.getProtocolStatus();
      protocolStatus = status;
    } catch (error) {
      console.error('Error fetching protocol data:', error);
    } finally {
      isLoading = false;
    }
  }
  
  onMount(fetchData);
</script>

<svelte:head>
  <title>RUMI Protocol - Learn More</title>
</svelte:head>

<div class="max-w-6xl mx-auto px-4 py-12 pb-10">
  <!-- Hero Section -->
  <section class="text-center mb-20">
    <h1 class="text-4xl md:text-5xl font-bold mb-6 bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent">
      Understanding Rumi Protocol
    </h1>
    <p class="text-xl text-gray-300 max-w-3xl mx-auto">
      Rumi Protocol enables you to generate icUSD stablecoins using ICP as collateral, bringing DeFi stability to the Internet Computer ecosystem.
    </p>
  </section>

  <!-- Features Grid -->
  <section class="mb-20">
    <h2 class="text-3xl font-bold mb-8 text-center">Key Features</h2>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      {#each features as feature}
        <div class="bg-gray-900/50 p-6 rounded-lg backdrop-blur-sm ring-2 ring-purple-400 hover:ring-purple-300 transition-all">
          <div class="text-4xl mb-4">{feature.icon}</div>
          <h3 class="text-xl font-semibold mb-2 text-purple-400">{feature.title}</h3>
          <p class="text-gray-300">{feature.description}</p>
        </div>
      {/each}
    </div>
  </section>

  <!-- How It Works -->
  <section class="mb-20">
    <h2 class="text-3xl font-bold mb-8 text-center">How It Works</h2>
    <div class="space-y-8">
      {#each howItWorks as { step, title, description }}
        <div class="flex items-start gap-6">
          <div class="flex-shrink-0 w-12 h-12 bg-purple-600 rounded-full flex items-center justify-center text-xl font-bold">
            {step}
          </div>
          <div>
            <h3 class="text-xl font-semibold mb-2">{title}</h3>
            <p class="text-gray-300">{description}</p>
          </div>
        </div>
      {/each}
    </div>
  </section>

  <!-- Protocol Metrics -->
  <section>
    <h2 class="text-3xl font-bold mb-8 text-center">Protocol Security</h2>
    <div class="bg-gray-900/50 p-8 rounded-lg backdrop-blur-sm ring-2 ring-purple-400">
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        <div>
          <h3 class="text-lg font-medium text-gray-400 mb-1">Minimum Collateral Ratio</h3>
          <p class="text-2xl font-bold">150%</p>
        </div>
        <div>
          <h3 class="text-lg font-medium text-gray-400 mb-1">Liquidation Threshold</h3>
          <p class="text-2xl font-bold">130%</p>
        </div>
        <div>
          <h3 class="text-lg font-medium text-gray-400 mb-1">Protocol Fee</h3>
          <p class="text-2xl font-bold">0.5%</p>
        </div>
      </div>
    </div>
  </section>
</div>

<div class="container mx-auto px-4 max-w-5xl">
  <section class="mb-12">
    <div class="text-center mb-10">
      <h1 class="text-4xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-pink-400 to-purple-600">
        About RUMI Protocol
      </h1>
      <p class="text-xl text-gray-300 max-w-3xl mx-auto">
        A decentralized stablecoin system built on the Internet Computer
      </p>
    </div>
    
    <ProtocolStats />
  </section>
  
  <section class="mb-12">
    <div class="glass-card">
      <h2 class="text-3xl font-semibold mb-6">How RUMI Protocol Works</h2>
      
      <div class="prose prose-lg prose-invert max-w-none">
        <p>
          RUMI Protocol is a decentralized finance (DeFi) platform built on the Internet Computer that enables users to generate the icUSD stablecoin using ICP as collateral. The system maintains stability through overcollateralization and algorithmically managed parameters.
        </p>
        
        <h3>Key Components</h3>
        
        <h4>Vaults</h4>
        <p>
          Users can create vaults by depositing ICP tokens as collateral. Each vault must maintain a minimum collateralization ratio of 130%, meaning that the value of the collateral must be at least 1.3 times the value of the borrowed icUSD.
        </p>
        
        <h4>icUSD Stablecoin</h4>
        <p>
          icUSD (Internet Computer USD) is a stablecoin soft-pegged to the US Dollar. Users can borrow icUSD against their collateral, trade it, or use it in other DeFi applications within the Internet Computer ecosystem.
        </p>
        
        <h4>Liquidation</h4>
        <p>
          If a vault's collateralization ratio falls below 130% due to ICP price fluctuations, it becomes eligible for liquidation. During liquidation, the vault's collateral is used to repay the borrowed icUSD, plus a liquidation penalty.
        </p>
        
        <h4>Liquidity Pool</h4>
        <p>
          The protocol maintains a liquidity pool that facilitates redemptions and earns returns for liquidity providers. Users can provide ICP to the liquidity pool and earn a portion of the protocol fees proportional to
        </p>
      </div>
    </div>
  </section>
</div>

<style>
  /* Optional: Add a gradient line between sections */
  section:not(:last-child)::after {
    content: '';
    display: block;
    width: 200px;
    height: 2px;
    margin: 4rem auto;
    background: linear-gradient(90deg, transparent, #c084fc, transparent);
  }
</style>