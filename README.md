# `rumi_protocol`
# icUSD Stablecoin Project

## Introduction
icUSD is a decentralized stablecoin built on the Internet Computer Protocol (ICP), aimed at providing a stable digital currency pegged to the US dollar. It utilizes collateral in the form of ICP, ckBTC, and ckETH to maintain its stability and value. This repository contains all the necessary components for deploying, managing, and interacting with the icUSD system.

## Features
- **Decentralized Stablecoin**: Mint icUSD by locking ICP tokens as collateral in an over-collateralized system.
- **Robust Liquidation Mechanism**: Automatically liquidates undercollateralized positions to ensure system solvency.
- **Integrated Price Oracle**: Leverages HTTPS outcalls for real-time ICP price data, ensuring accurate collateral valuation.
- **Dynamic Collateral Management**: Adjusts collateral requirements based on market conditions to maintain stability.
- **Governance Model**: icUSD holders can participate in governance decisions, influencing key protocol parameters.

## Project Structure
- `src`: Smart contracts written in Motoko, powering the icUSD protocol.
- `frontend`: User interface developed with Svelte to interact with the icUSD system.
- `scripts`: Utility scripts for deployment and management of the canisters.

## Getting Started
### Prerequisites
- Node.js and npm installed.
- Internet Computer SDK (`dfx`) installed for managing canisters.

### Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/your-org/icUSD.git
cd icUSD
npm install

