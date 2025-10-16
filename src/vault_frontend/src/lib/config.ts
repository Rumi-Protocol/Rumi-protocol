import { idlFactory as rumi_backendIDL } from '../../../declarations/rumi_protocol_backend/rumi_protocol_backend.did.js';
import { idlFactory as icp_ledgerIDL } from '../../../declarations/icp_ledger/icp_ledger.did.js';
import { idlFactory as icusd_ledgerIDL } from '../../../declarations/icusd_ledger/icusd_ledger.did.js';

// Canister IDs for production (from canister_ids.json)
export const CANISTER_IDS = {
  PROTOCOL: "aakb7-rqaaa-aaaai-q3oua-cai",
  ICP_LEDGER: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  ICUSD_LEDGER: "4kejc-maaaa-aaaai-q3tqq-cai",
} as const;

// Canister IDs for local development
export const LOCAL_CANISTER_IDS = {
  PROTOCOL: "aakb7-rqaaa-aaaai-q3oua-cai",
  ICP_LEDGER: "ryjl3-tyaaa-aaaaa-aaaba-cai",
  ICUSD_LEDGER: "4kejc-maaaa-aaaai-q3tqq-cai",
} as const;

// Frontend canister ID
export const vault_frontend = "stm54-gyaaa-aaaai-q3ssa-cai";

// Add this to your config file if it doesn't exist
export const isDevelopment = process.env.NODE_ENV === 'development' || import.meta.env.DEV;

// Configuration for the application
export const CONFIG = {
  // Get the current canister ID from environment or use local default
  currentCanisterId: CANISTER_IDS.PROTOCOL,
  
  // Improved network detection - check multiple environment indicators
  get isLocal() {
    // Check server-side environment variables first
    if (typeof window === 'undefined') {
      return process.env.DFX_NETWORK === 'local' || 
             process.env.NODE_ENV === 'development';
    }
    
    // Client-side checks
    return process.env.DFX_NETWORK === 'local' || 
           import.meta.env.DEV || 
           window?.location?.hostname === 'localhost' ||
           window?.location?.hostname?.includes('127.0.0.1');
  },
  
  // Use proper ICP ledger ID based on network
  get currentIcpLedgerId() {
    return this.isLocal ? LOCAL_CANISTER_IDS.ICP_LEDGER : CANISTER_IDS.ICP_LEDGER;
  },
  
  // Use proper icUSD ledger ID based on network  
  get currentIcusdLedgerId() {
    return this.isLocal ? LOCAL_CANISTER_IDS.ICUSD_LEDGER : CANISTER_IDS.ICUSD_LEDGER;
  },
  
  // Configure the host based on environment
  get host() {
    if (this.isLocal) {
      return 'http://localhost:4943';
    }
    return 'https://icp0.io'; // Fixed: Use standard IC endpoint
  },
  
  // Flag for development mode
  devMode: import.meta.env.DEV,
  
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
