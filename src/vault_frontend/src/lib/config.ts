import { idlFactory as rumi_backendIDL } from '../../../declarations/rumi_protocol_backend/rumi_protocol_backend.did.js';
import { idlFactory as icp_ledgerIDL } from '../../../declarations/icp_ledger/icp_ledger.did.js';
import { idlFactory as icusd_ledgerIDL } from '../../../declarations/icusd_ledger/icusd_ledger.did.js';

// Canister IDs for production
export const CANISTER_IDS = {
  PROTOCOL: "aakb7-rqaaa-aaaai-q3oua-cai",
  ICP_LEDGER: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  ICUSD_LEDGER: "4kejc-maaaa-aaaai-q3tqq-cai",
} as const;

// Canister IDs for local development
export const LOCAL_CANISTER_IDS = {
  PROTOCOL: "uzt4z-lp777-77774-qaabq-cai",       // Our deployed local protocol backend
  ICP_LEDGER: "uxrrr-q7777-77774-qaaaq-cai",    // Our deployed local ICP ledger
  ICUSD_LEDGER: "u6s2n-gx777-77774-qaaba-cai",  // Our deployed local icUSD ledger
} as const;

// Frontend canister ID
export const vault_frontend = "stm54-gyaaa-aaaai-q3ssa-cai";

// Add this to your config file if it doesn't exist
export const isDevelopment = import.meta.env.DEV || import.meta.env.MODE === 'development';

// Configuration for the application
export const CONFIG = {
  // Get the current canister ID based on environment
  currentCanisterId: import.meta.env.VITE_DFX_NETWORK !== 'ic'
    ? LOCAL_CANISTER_IDS.PROTOCOL
    : import.meta.env.VITE_CANISTER_ID_RUMI_PROTOCOL_BACKEND || CANISTER_IDS.PROTOCOL,

  // FIX: Properly determine ICP ledger ID based on environment
  // Use mainnet ID when not in local mode, otherwise use local ID
  currentIcpLedgerId: import.meta.env.VITE_DFX_NETWORK !== 'ic'
    ? import.meta.env.VITE_CANISTER_ID_ICP_LEDGER || LOCAL_CANISTER_IDS.ICP_LEDGER
    : CANISTER_IDS.ICP_LEDGER,

  // Apply same fix to icUSD ledger ID
  currentIcusdLedgerId: import.meta.env.VITE_DFX_NETWORK !== 'ic'
    ? import.meta.env.VITE_CANISTER_ID_ICUSD_LEDGER || LOCAL_CANISTER_IDS.ICUSD_LEDGER
    : CANISTER_IDS.ICUSD_LEDGER,

  // Configure the host based on environment
  host: import.meta.env.VITE_DFX_NETWORK === 'ic'
    ? 'https://icp0.io'
    : 'http://localhost:4943',

  // Flag to determine if we're in local development
  isLocal: import.meta.env.VITE_DFX_NETWORK !== 'ic',

  // Flag for development mode
  devMode: import.meta.env.DEV || import.meta.env.MODE === 'development',
  
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
  icusd_ledgerIDL
};
