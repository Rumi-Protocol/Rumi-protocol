import { idlFactory as rumi_backendIDL } from '../../../declarations/test_rumi_protocol_backend/test_rumi_protocol_backend.did.js';
import { idlFactory as icp_ledgerIDL } from '../../../declarations/icp_ledger/icp_ledger.did.js';
import { idlFactory as icusd_ledgerIDL } from '../../../declarations/icusd_ledger/icusd_ledger.did.js';
import { idlFactory as ckbtc_ledgerIDL } from '../idls/ledger.idl.js';

// Canister IDs for production
export const CANISTER_IDS = {
  PROTOCOL: "aakb7-rqaaa-aaaai-q3oua-cai",
  ICP_LEDGER: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  ICUSD_LEDGER: "4kejc-maaaa-aaaai-q3tqq-cai",
  CKBTC_LEDGER: "mxzaz-hqaaa-aaaar-qaada-cai", // ckBTC mainnet ledger ID
} as const;

// Canister IDs for local development
export const LOCAL_CANISTER_IDS = {
  PROTOCOL: "aakb7-rqaaa-aaaai-q3oua-cai",
  ICP_LEDGER: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  ICUSD_LEDGER: "4kejc-maaaa-aaaai-q3tqq-cai",
  CKBTC_LEDGER: "mxzaz-hqaaa-aaaar-qaada-cai", // Use same for local development
} as const;

// Frontend canister ID
export const vault_frontend = "stm54-gyaaa-aaaai-q3ssa-cai";

// Add this to your config file if it doesn't exist
export const isDevelopment = process.env.NODE_ENV === 'development' || import.meta.env.DEV;

// Configuration for the application
export const CONFIG = {
  // Get the current canister ID from environment or use local default
  currentCanisterId: CANISTER_IDS.PROTOCOL || LOCAL_CANISTER_IDS.PROTOCOL,
  
  // FIX: Properly determine ICP ledger ID based on environment
  // Use mainnet ID when not in local mode, otherwise use local ID
  currentIcpLedgerId: process.env.DFX_NETWORK !== 'ic'
    ? LOCAL_CANISTER_IDS.ICP_LEDGER
    : CANISTER_IDS.ICP_LEDGER,
  
  // Apply same fix to icUSD ledger ID
  currentIcusdLedgerId: process.env.DFX_NETWORK !== 'ic'
    ? LOCAL_CANISTER_IDS.ICUSD_LEDGER
    : CANISTER_IDS.ICUSD_LEDGER,
  
  // ckBTC ledger ID configuration
  currentCkbtcLedgerId: process.env.DFX_NETWORK !== 'ic'
    ? LOCAL_CANISTER_IDS.CKBTC_LEDGER
    : CANISTER_IDS.CKBTC_LEDGER,
  
  // Configure the host based on environment
  host: process.env.DFX_NETWORK === 'ic' 
    ? 'https://icp0.io' 
    : 'http://localhost:4943',
  
  // Flag to determine if we're in local development
  isLocal: process.env.DFX_NETWORK !== 'ic',
  
  // Flag for development mode
  devMode: process.env.NODE_ENV === 'development',
  
  // Network configurations
  networks: {
    local: {
      host: 'http://localhost:4943',
    },
    ic: {
      host: 'https://icp0.io',
    }
  },
  
  // Application settings
  settings: {
    minCollateralRatio: 130, // 130%
    targetCollateralRatio: 175, // 175%
    liquidationThreshold: 125, // 125%
  },

  // Export IDLs through config for convenience
  rumi_backendIDL,
  icp_ledgerIDL,
  icusd_ledgerIDL,
  ckbtc_ledgerIDL
};
