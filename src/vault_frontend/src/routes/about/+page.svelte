<script>
  // Data structure for the content
  let aboutData = {
    title: "icUSD Protocol: A Decentralized Stablecoin System",
    vision: "The icUSD Protocol is a next-generation decentralized stablecoin system built on the Internet Computer Protocol (ICP). It aims to provide a fully on-chain, transparent, and algorithmically governed stablecoin designed to maintain a 1:1 peg with the US Dollar.",
    coreComponents: [
      {
        title: "Stablecoin (icUSD):",
        details: [
          "Overcollateralized: Users lock ICP tokens as collateral to mint icUSD.",
          "Collateralization Ratio (CR): Maintains a minimum CR of 150%.",
          "Burning Mechanism: Users can redeem ICP by burning icUSD.",
        ],
      },
      {
        title: "Vault System:",
        details: [
          "Manages user deposits and tracks collateralization.",
          "Automatically liquidates positions when CR falls below 150%.",
        ],
      },
      {
        title: "Price Oracle:",
        details: [
          "Fetches real-time ICP prices from multiple data sources (e.g., CoinGecko, Binance).",
          "Calculates the average price to ensure fair and accurate liquidation.",
        ],
      },
      {
        title: "Governance:",
        details: [
          "Community-driven updates to risk parameters such as liquidation penalties and CR requirements.",
          "Governance tokens grant voting rights.",
        ],
      },
    ],
    keyFeatures: [
      "Fully On-Chain: Both the stablecoin and its vault management operate entirely on ICP, ensuring decentralization.",
      "Efficient Liquidation: Automated liquidation sells undercollateralized positions to cover debts, maintaining system stability.",
      "Scalability: Designed to handle millions of transactions with minimal latency using ICP's high-throughput capabilities.",
      "Security: Smart contracts leverage ICP’s robust cryptographic features and chain-key cryptography for secure operations.",
      "Transparency: All transactions and governance decisions are verifiable on-chain.",
    ],
    workflow: [
      {
        title: "Minting icUSD:",
        details: [
          "Users deposit ICP into a vault.",
          "icUSD is minted based on the collateral value, ensuring a 150% CR.",
        ],
      },
      {
        title: "Liquidation:",
        details: [
          "If CR < 150%, collateral is sold to cover the issued icUSD.",
          "Liquidators purchase collateral at a discount.",
        ],
      },
      {
        title: "Redemption:",
        details: ["icUSD holders can burn tokens to redeem the equivalent ICP value."],
      },
    ],
    advantages: [
      "Fully Decentralized: Eliminates reliance on centralized assets or oracles.",
      "On-Chain Governance: Community governs updates and improvements.",
      "Native to ICP: Leverages the speed, scalability, and low costs of ICP for efficient operations.",
    ],
  };
</script>

<section class="flex flex-col items-center justify-center p-10 text-white text-center">
  <div class="flex justify-center items-center space-x-5 pb-10">
  <img src="/icUSD-logo.png" alt="Coin 3" class="w-40 h-36 md:w-48 md:h-48 bounce-normal" />
  <img src="/icUSD-logo.png" alt="Coin 1" class="w-40 h-36 md:w-48 md:h-48 bounce-higher" />
  <img src="/icUSD-logo.png" alt="Coin 3" class="w-40 h-36 md:w-48 md:h-48 bounce-normal" />
  </div>


    <div class="mt-10 grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-6xl pb-10">
    <div class="bg-gray-900 p-6 rounded-lg shadow-xl text-black">
      <h3 class="text-xl font-semibold text-purple-600">Security</h3>
      <p class="text-white mt-2">Built on ICP, ensuring high-speed transactions and trustless security mechanisms.</p>
    </div>
    
    <div class="bg-gray-900 p-6 rounded-lg shadow-xl text-black">
      <h3 class="text-xl font-semibold text-blue-600">Transparency</h3>
      <p class="text-white mt-2">Completely open-source and verifiable, ensuring full decentralization.</p>
    </div>
    
    <div class="bg-gray-900 p-6 rounded-lg shadow-xl text-black">
      <h3 class="text-xl font-semibold text-green-600">Stability</h3>
      <p class="text-white mt-2">Designed to maintain value through algorithmic mechanisms and collateralization.</p>
    </div>
    </div>

  <h2 class="text-4xl font-bold">{aboutData.title}</h2>
  <p class="mt-4 text-xl max-w-3xl">{aboutData.vision}</p>

  <h3 class="text-3xl font-semibold mt-8">Core Components</h3>
  <ul class="mt-4 text-left space-y-6 max-w-4xl">
    {#each aboutData.coreComponents as component}
      <li>
        <h4 class="text-xl font-bold">{component.title}</h4>
        <ul class="ml-6 list-disc">
          {#each component.details as detail}
            <li>{detail}</li>
          {/each}
        </ul>
      </li>
    {/each}
  </ul>

  <h3 class="text-3xl font-semibold mt-8">Key Features</h3>
  <ul class="mt-4 text-left space-y-4 max-w-4xl list-disc">
    {#each aboutData.keyFeatures as feature}
      <li>{feature}</li>
    {/each}
  </ul>

  <h3 class="text-3xl font-semibold mt-8">Workflow</h3>
  <ul class="mt-4 text-left space-y-6 max-w-4xl">
    {#each aboutData.workflow as step}
      <li>
        <h4 class="text-xl font-bold">{step.title}</h4>
        <ul class="ml-6 list-disc">
          {#each step.details as detail}
            <li>{detail}</li>
          {/each}
        </ul>
      </li>
    {/each}
  </ul>

  <h3 class="text-3xl font-semibold mt-8">Advantages Over Existing Stablecoins</h3>
  <ul class="mt-4 text-left space-y-4 max-w-4xl list-disc">
    {#each aboutData.advantages as advantage}
      <li>{advantage}</li>
    {/each}
  </ul>


</section>



<style>
  section {
    font-family: 'Inter', sans-serif;
    line-height: 1.8;
  }

  h2 {
    color:rgb(231, 255, 123);
  }

  h3 {
    color: #ffa500;
  }

  h4 {
    color: #ffd700;
  }

  ul {
    margin-left: 1rem;
  }
</style>
