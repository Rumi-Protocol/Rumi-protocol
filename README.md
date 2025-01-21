# `rumi_protocol`
# icUSD Stablecoin Project

## Introduction
icUSD is a decentralized stablecoin developed on the Internet Computer Protocol (ICP), designed to provide a stable digital currency pegged to the US dollar. This repository contains the Rust-based backend canisters and a Svelte-powered frontend for interacting with the icUSD system.

## Features
- **Decentralized Stability**: icUSD maintains its peg through a collateralized mechanism, ensuring stable value against the US dollar.
- **Robust Liquidation Mechanism**: Automates the process of liquidating undercollateralized positions to maintain system health.
- **Real-time Price Oracles**: Implements oracles for accurate and timely price updates essential for system operations.
- **Dynamic Collateral Management**: Adapts to market conditions by adjusting collateral requirements.
- **Governance and Community Driven**: Empowers icUSD holders to participate in governance decisions impacting the protocol.

## Project Structure
- `src/rumi_protocol_backend`: Contains the Rust smart contracts handling the core logic of icUSD.
- `src/rumi_vault`: Manages the icUSD vault operations.
- `src/ledger`: Includes the canisters for handling ledger operations specific to icUSD and ICP interactions.
- `src/rumi_protocol_frontend`: Svelte application providing a user interface for interacting with icUSD.

## Getting Started
### Prerequisites
- Node.js (for frontend development and build)
- Rust and Cargo (for compiling backend canisters)
- DFX SDK (for deploying and managing Internet Computer canisters)

### Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/your-org/icUSD.git
cd icUSD
npm install # for the frontend
cargo build --release # for the backend canisters


## Running Locally
To start the local development environment, execute the following commands:

```bash
dfx start --clean
dfx deploy
cd src/rumi_protocol_frontend
npm run dev

