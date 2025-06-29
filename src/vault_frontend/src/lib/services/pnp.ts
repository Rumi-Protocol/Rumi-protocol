import { Principal } from "@dfinity/principal";
import { CONFIG, CANISTER_IDS, LOCAL_CANISTER_IDS, vault_frontend } from '../config';
import { idlFactory as rumi_backendIDL } from '../../../../declarations/rumi_protocol_backend/rumi_protocol_backend.did.js';
import { idlFactory as icp_ledgerIDL } from '../../../../declarations/icp_ledger/icp_ledger.did.js';
import { idlFactory as icusd_ledgerIDL } from '../../../../declarations/icusd_ledger/icusd_ledger.did.js';
import { createPNP, type PNP } from '@windoge98/plug-n-play';

// Define types for supported canisters
export type CanisterType =
  | "rumi_backend"
  | "icp_ledger"
  | "icusd_ledger";

// Collect all canister IDLs in one place
export const canisterIDLs = {
  rumi_backend: rumi_backendIDL,
  icp_ledger: icp_ledgerIDL,
  icusd_ledger: icusd_ledgerIDL,
};

let globalPnp: PNP | null = null;

export const REQUIRED_CANISTERS = {
  protocol: CONFIG.currentCanisterId,
  icpLedger: CONFIG.currentIcpLedgerId,
  icusdLedger: CONFIG.currentIcusdLedgerId
};

// CRITICAL FIX: Make initializePermissions check wallet type first
export async function initializePermissions(walletId?: string): Promise<boolean> {
  try {
    console.log('Initializing permissions for wallet:', walletId);
    
    // Only request Plug permissions if specifically using Plug wallet
    if (walletId === 'plug' || (!walletId && window.ic?.plug)) {
      console.log('Requesting Plug wallet permissions');
      
      if (!window.ic?.plug) {
        console.warn('Plug wallet not available in window.ic');
        return false;
      }
      
      // Request all permissions at once
      await window.ic.plug.requestConnect({
        whitelist: Object.values(REQUIRED_CANISTERS),
        host: window.location.origin
      });
      
      return await window.ic.plug.isConnected();
    }
    
    // For Internet Identity and other wallets, no permissions needed
    console.log('No explicit permissions needed for wallet:', walletId || 'unknown');
    return true;
  } catch (err) {
    console.error('Failed to initialize permissions:', err);
    return false;
  }
}

export function initializePNP(): PNP {
  try {
    if (globalPnp) {
      return globalPnp;
    }

    const protocolId = CONFIG.isLocal ? LOCAL_CANISTER_IDS.PROTOCOL : CANISTER_IDS.PROTOCOL;
    const delegationTargets = [Principal.fromText(protocolId)];

    const isDev = import.meta.env.DEV;
    const derivationOrigin = () => {
      if (isDev) {
        return "http://localhost:5173";
      }
      let httpPrefix = "https://";
      let icp0Suffix = ".icp0.io";
      if (process.env.DFX_NETWORK === "local") {
        return "http://bkyz2-fmaaa-aaaaa-qaaaq-cai.localhost:4943";

      }

      return httpPrefix + vault_frontend + icp0Suffix;
    };

    globalPnp = createPNP({
      hostUrl: CONFIG.isLocal
        ? "http://localhost:4943"
        : "https://icp0.io",
      isDev: CONFIG.isLocal,
      whitelist: [protocolId],
      fetchRootKeys: CONFIG.isLocal,
      timeout: 1000 * 60 * 60 * 4, // 4 hours
      verifyQuerySignatures: !CONFIG.isLocal,
      identityProvider: CONFIG.isLocal
        ? "http://rdmx6-jaaaa-aaaaa-aaadq-cai.localhost:4943"
        : "https://identity.ic0.app",
      persistSession: true,
      derivationOrigin: derivationOrigin(),
      delegationTimeout: BigInt(86400000000000), // 24 hours
      delegationTargets,
    });

    return globalPnp;
  } catch (error) {
    console.error("Error initializing PNP:", error);
    throw error;
  }
}

export function getPnpInstance(): PNP {
  if (!globalPnp) {
    return initializePNP();
  }
  return globalPnp;
}

export const pnp = getPnpInstance();












