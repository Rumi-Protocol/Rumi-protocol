import { Principal } from "@dfinity/principal";
import { CONFIG, CANISTER_IDS, LOCAL_CANISTER_IDS, vault_frontend } from '../config';
import { idlFactory as rumi_backendIDL } from '../../../../declarations/rumi_protocol_backend/rumi_protocol_backend.did.js';
import { idlFactory as icp_ledgerIDL } from '../../../../declarations/icp_ledger/icp_ledger.did.js';
import { idlFactory as icusd_ledgerIDL } from '../../../../declarations/icusd_ledger/icusd_ledger.did.js';
import { idlFactory as stabilityPoolIDL } from '../../../../declarations/rumi_stability_pool/rumi_stability_pool.did.js';
import { createPNP, type PNP } from '@windoge98/plug-n-play';

// Define types for supported canisters
export type CanisterType =
  | "rumi_backend"
  | "icp_ledger"
  | "icusd_ledger"
  | "stability_pool";

// Collect all canister IDLs in one place
export const canisterIDLs = {
  rumi_backend: rumi_backendIDL,
  icp_ledger: icp_ledgerIDL,
  icusd_ledger: icusd_ledgerIDL,
  stability_pool: stabilityPoolIDL,
};

let globalPnp: PNP | null = null;

export const REQUIRED_CANISTERS = {
  protocol: CONFIG.currentCanisterId,
  icpLedger: CONFIG.currentIcpLedgerId,
  icusdLedger: CONFIG.currentIcusdLedgerId,
  stabilityPool: "jgwkf-3yaaa-aaaai-q34na-cai"
};

// COMPREHENSIVE PERMISSION SYSTEM - Request ALL permissions at once during wallet connection
// Custom connect function that ensures comprehensive permissions for Plug
export async function connectWithComprehensivePermissions(walletId: string): Promise<any> {
  try {
    console.log('🔐 Connecting with comprehensive permissions for:', walletId);
    
    // For Plug wallet, manually handle the comprehensive permission request
    if (walletId === 'plug' && window.ic?.plug) {
      console.log('🔧 Setting up comprehensive Plug permissions...');
      
      // Request ALL canister permissions upfront for Plug
      const comprehensivePermissions = {
        whitelist: [
          CONFIG.currentCanisterId,      // Protocol canister
          CONFIG.currentIcpLedgerId,     // ICP Ledger  
          CONFIG.currentIcusdLedgerId,   // icUSD Ledger
          "jgwkf-3yaaa-aaaai-q34na-cai"  // Stability Pool canister
        ],
        host: CONFIG.isLocal ? 'http://localhost:4943' : 'https://icp0.io',
        timeout: 60000
      };
      
      console.log('🔐 Requesting comprehensive Plug permissions:', comprehensivePermissions);
      
      // Use Plug's requestConnect with comprehensive whitelist
      const plugConnected = await window.ic.plug.requestConnect(comprehensivePermissions);
      if (!plugConnected) {
        throw new Error('Plug wallet connection denied');
      }
      
      // Get the account info from Plug directly
      const principal = await window.ic.plug.agent.getPrincipal();
      console.log('✅ Plug connected with comprehensive permissions:', principal.toText());
      
      return { owner: principal };
    }
    
    // For other wallets, use standard PNP connection
    return await globalPnp?.connect(walletId);
  } catch (err) {
    console.error('❌ Failed to connect with comprehensive permissions:', err);
    throw err;
  }
}

export async function requestAllPermissionsUpfront(walletId?: string): Promise<boolean> {
  // This function is kept for backward compatibility but is no longer used
  // Comprehensive permissions are now handled in connectWithComprehensivePermissions
  console.log('✅ Permission handling moved to connectWithComprehensivePermissions');
  return true;
}

export function initializePNP(): PNP {
  try {
    if (globalPnp) {
      return globalPnp;
    }

    const protocolId = CONFIG.isLocal ? LOCAL_CANISTER_IDS.PROTOCOL : CANISTER_IDS.PROTOCOL;
    
    console.log('🔍 Debug: protocolId being used for Principal.fromText:', protocolId);
    console.log('🔍 Debug: CONFIG.isLocal:', CONFIG.isLocal);
    
    try {
      const delegationTargets = [Principal.fromText(protocolId)];
    } catch (error) {
      console.error('❌ Error parsing protocolId as Principal:', error);
      console.error('❌ Problematic protocolId value:', protocolId);
      throw new Error(`Invalid protocolId for Principal parsing: ${protocolId}. Error: ${String(error)}`);
    }
    
    const delegationTargets = [Principal.fromText(protocolId)];

    const isDev = import.meta.env.DEV;
    const derivationOrigin = () => {
      if (isDev || CONFIG.isLocal) {
        return "http://localhost:5173";
      }
      
      // For IC deployment, use the proper canister URL
      return `https://${vault_frontend}.icp0.io`;
    };

    console.log('🔧 Initializing PNP with comprehensive configuration...');

    // Create PNP with comprehensive configuration for all wallets
    globalPnp = createPNP({
      hostUrl: CONFIG.isLocal
        ? "http://localhost:4943"
        : "https://icp0.io",
      isDev: CONFIG.isLocal,
      delegationTargets,
      delegationTimeout: BigInt(86400000000000), // 24 hours
      // Note: Individual wallet configurations (like Plug whitelist) are handled
      // by the PNP library during the connect() call based on wallet type
    });

    console.log('✅ PNP initialized with comprehensive permissions');
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

// Enhanced PNP wrapper that uses Plug directly when connected
export const pnp = {
  ...getPnpInstance(),
  
  // Override connect to use our comprehensive method
  connect: connectWithComprehensivePermissions,
  
  // Override getActor to use Plug directly when possible to avoid permission prompts
  async getActor(canisterId: string, idl: any) {
    try {
      // For Plug wallet, use the direct Plug API to avoid permission prompts
      if (window.ic?.plug && await window.ic.plug.isConnected()) {
        console.log('🔧 Using Plug direct API for actor:', canisterId);
        return await window.ic.plug.createActor({
          canisterId,
          interfaceFactory: idl
        });
      }
      
      // For other wallets, use standard PNP
      return await globalPnp?.getActor(canisterId, idl);
    } catch (err) {
      console.error('Error getting actor for canister', canisterId, err);
      throw err;
    }
  }
};












