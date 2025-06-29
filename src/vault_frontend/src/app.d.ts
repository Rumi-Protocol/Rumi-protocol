// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
// src/app.d.ts
/// <reference types="@sveltejs/kit" />
import type { Principal } from '@dfinity/principal';

declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface Platform {}
  }
}

// Add plug-n-play types
declare module '@windoge98/plug-n-play' {
  export interface PNPWallet {
    id: string;
    name: string;
    logo: string;
  }

  export interface PNPConfig {
    hostUrl: string;
    isDev: boolean;
    delegationTargets?: Principal[];
    delegationTimeout?: bigint;
  }

  export interface PNP {
    connect: (walletId: string, enableDelegation?: boolean) => Promise<any>;
    disconnect: () => Promise<void>;
    isConnected: () => Promise<boolean>;
    getPrincipal: () => Promise<Principal>;
    getBalance: () => Promise<bigint>;
    getActor: (canisterId: string, idl: any) => Promise<any>;
  }

  export const createPNP: (config: PNPConfig) => PNP;
  export const walletsList: PNPWallet[];
}

export {};
	
