import type { Principal } from "@dfinity/principal";
import type { ActorSubclass } from "@dfinity/agent";

// Extend the global Window interface to include the Plug wallet
declare global {
  interface Window {
    ic?: {
      plug?: {
        // Basic properties
        agent?: any;
        sessionManager?: any;
        principalId?: string;
        isConnected?: boolean;

        // Core methods
        getPrincipal?: () => Promise<Principal>;
        getAccountId?: () => string;

        // Connection methods
        requestConnect?: (options: {
          whitelist: string[];
          host?: string;
        }) => Promise<boolean>;
        disconnect?: () => Promise<void>;
        createActor?: <T>(options: {
          canisterId: string;
          interfaceFactory: any;
        }) => Promise<ActorSubclass<T>>;

        // Transaction methods
        requestTransfer?: (params: {
          to: string;
          amount: number | bigint;
          opts?: {
            fee?: number | bigint;
            memo?: number | bigint;
            from_subaccount?: number;
            created_at_time?: {
              timestamp_nanos: number | bigint;
            };
          };
        }) => Promise<{ height: number | bigint }>;
        
        // Approval methods
        requestTransferApproval?: (params: {
          token: string;
          amount: number | bigint;
          to: string;
        }) => Promise<any>;
      };
    };
  }
}

export {};
