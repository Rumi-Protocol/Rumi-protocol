import type { Principal } from '@dfinity/principal';
import type { ActorSubclass } from '@dfinity/agent';

interface PlugWindow {
  disconnect(): unknown;
  requestBalance(): unknown;
  createActor: <T>(args: {
    canisterId: string;
    interfaceFactory: any;
  }) => Promise<ActorSubclass<T>>;
  requestConnect: (args: {
    whitelist?: string[];
    host?: string;
  }) => Promise<any>;
  isConnected: () => Promise<boolean>;
  agent: {
    getPrincipal: () => Promise<Principal>;
  };
}

declare global {
  interface Window {
    ic?: {
      plug?: PlugWindow;
    };
    cancelVaultCreation?: () => string;
  }
}
