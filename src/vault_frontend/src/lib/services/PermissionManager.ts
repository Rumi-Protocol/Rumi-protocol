import { browser } from '$app/environment';
import { writable, get } from 'svelte/store';
import { Principal } from '@dfinity/principal';
import type { Wallet } from '@windoge98/plug-n-play';
import { selectedWalletId } from '../services/auth';
import { pnp } from './pnp';

interface PermissionSessionState {
  walletId: string | null;
  principal: string | null;
  granted: boolean;
  pending: boolean;
  lastPrompt: number | null;
  error: string | null;
}

const DEFAULT_SESSION: PermissionSessionState = {
  walletId: null,
  principal: null,
  granted: false,
  pending: false,
  lastPrompt: null,
  error: null
};

const SESSION_STORAGE_KEY = 'rumi-permission-session-v2';

function toPrincipalText(owner: Principal | string): string {
  if (typeof owner === 'string') {
    return owner;
  }

  if (owner instanceof Principal) {
    return owner.toText();
  }

  if (typeof (owner as any)?.toText === 'function') {
    return (owner as Principal).toText();
  }

  return (owner as any)?.toString?.() ?? '';
}

function fromPrincipalText(text: string | null): Principal | null {
  try {
    return text ? Principal.fromText(text) : null;
  } catch {
    return null;
  }
}

export class PermissionManager {
  private readonly store = writable<PermissionSessionState>(DEFAULT_SESSION);
  private ongoingRequest: Promise<Wallet.Account | null> | null = null;

  constructor() {
    if (browser) {
      this.restoreFromSession();
    }
  }

  subscribe = this.store.subscribe;

  /**
   * Ensure permissions are granted for the active wallet. Returns true when permissions are available.
   */
  async ensurePermissions(walletId?: string): Promise<boolean> {
    try {
      const account = await this.connect(walletId);
      return Boolean(account?.owner);
    } catch (error) {
      console.error('Failed to ensure wallet permissions:', error);
      return false;
    }
  }

  /**
   * Establish a session with the wallet and guarantee a single upfront permission confirmation.
   * Returns the wallet account when successful.
   */
  async connect(walletId?: string): Promise<Wallet.Account | null> {
    const resolvedWalletId = this.resolveWalletId(walletId);

    if (!resolvedWalletId) {
      const message = 'Wallet not selected. Please choose a wallet before requesting permissions.';
      this.setState({
        walletId: null,
        principal: null,
        granted: false,
        pending: false,
        lastPrompt: Date.now(),
        error: message
      });
      throw new Error(message);
    }

    const existingAccount = this.reuseExistingSession(resolvedWalletId);
    if (existingAccount) {
      return existingAccount;
    }

    if (!this.ongoingRequest) {
      this.ongoingRequest = this.performConnection(resolvedWalletId);
    }

    try {
      const account = await this.ongoingRequest;
      return account;
    } finally {
      this.ongoingRequest = null;
    }
  }

  /**
   * Returns the last known permission state.
   */
  getState(): PermissionSessionState {
    return get(this.store);
  }

  /**
   * Indicates whether active permissions exist.
   */
  hasPermissions(): boolean {
    const state = this.getState();
    return state.granted && Boolean(state.principal);
  }

  /**
   * Provides the active principal, if any.
   */
  getActivePrincipal(): Principal | null {
    const state = this.getState();
    return fromPrincipalText(state.principal);
  }

  /**
   * Clears cached permission data. Should be called on disconnect or explicit reset.
   */
  clearCache(): void {
    this.resetState();
  }

  /**
   * Disconnects from the current wallet and clears cached permissions.
   */
  async disconnect(): Promise<void> {
    try {
      await pnp.disconnect();
    } catch (error) {
      console.warn('Failed to disconnect wallet provider cleanly:', error);
    } finally {
      this.resetState();
    }
  }

  /**
   * Legacy helpers retained for backwards compatibility with older call sites.
   */
  async requestAllPermissions(walletId?: string): Promise<boolean> {
    return this.ensurePermissions(walletId);
  }

  async checkPermissions(walletId?: string): Promise<boolean> {
    return this.ensurePermissions(walletId);
  }

  clearWalletCache(): void {
    this.resetState();
  }

  private async performConnection(walletId: string): Promise<Wallet.Account | null> {
    this.updateState((state) => ({
      ...state,
      walletId,
      pending: true,
      error: null
    }));

    try {
      const account = await pnp.connect(walletId);

      if (!account?.owner) {
        throw new Error('Wallet connection did not return a valid owner principal.');
      }

      const principalText = toPrincipalText(account.owner);

      const updated: PermissionSessionState = {
        walletId,
        principal: principalText,
        granted: true,
        pending: false,
        lastPrompt: Date.now(),
        error: null
      };

      this.setState(updated);
      selectedWalletId.set(walletId);

      return account;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.setState({
        walletId,
        principal: null,
        granted: false,
        pending: false,
        lastPrompt: Date.now(),
        error: message
      });

      throw error;
    }
  }

  private reuseExistingSession(walletId: string): Wallet.Account | null {
    const currentState = this.getState();
    const isPersistedMatch = currentState.granted && currentState.walletId === walletId;
  const pnpAccount = (pnp as any)?.account as Wallet.Account | null;
  const activeWalletId = (pnp as any)?.activeWallet?.id as string | undefined;
  const isActive = Boolean((pnp as any)?.isConnected?.()) && activeWalletId === walletId && pnpAccount?.owner;

    if (!isPersistedMatch && !isActive) {
      return null;
    }

    if (pnpAccount?.owner) {
      const principalText = toPrincipalText(pnpAccount.owner);
      this.setState({
        walletId,
        principal: principalText,
        granted: true,
        pending: false,
        lastPrompt: currentState.lastPrompt ?? Date.now(),
        error: null
      });
      return pnpAccount;
    }

    const restoredPrincipal = fromPrincipalText(currentState.principal);
    if (restoredPrincipal) {
      const syntheticAccount: Wallet.Account = {
        owner: restoredPrincipal,
        type: (pnp as any)?.activeWallet?.id ?? walletId
      } as Wallet.Account;

      this.setState({
        walletId,
        principal: restoredPrincipal.toText(),
        granted: true,
        pending: false,
        lastPrompt: currentState.lastPrompt ?? Date.now(),
        error: null
      });

      return syntheticAccount;
    }

    return null;
  }

  private resolveWalletId(explicitWalletId?: string): string | null {
    if (explicitWalletId) {
      return explicitWalletId;
    }

    const storeWallet = get(selectedWalletId);
    if (storeWallet) {
      return storeWallet;
    }

    if (browser) {
      const lastWallet = localStorage.getItem('rumi_last_wallet');
      if (lastWallet) {
        return lastWallet;
      }
    }

    const state = this.getState();
    return state.walletId;
  }

  private restoreFromSession(): void {
    try {
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as PermissionSessionState;
      const restoredPrincipal = fromPrincipalText(parsed.principal);

      if (parsed.walletId && restoredPrincipal) {
        this.store.set({
          walletId: parsed.walletId,
          principal: restoredPrincipal.toText(),
          granted: Boolean(parsed.granted),
          pending: false,
          lastPrompt: parsed.lastPrompt ?? null,
          error: null
        });
      }
    } catch (error) {
      console.warn('Failed to restore permission session from storage:', error);
      this.store.set(DEFAULT_SESSION);
    }
  }

  private persist(state: PermissionSessionState): void {
    if (!browser) return;

    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn('Unable to persist permission session state:', error);
    }
  }

  private setState(state: PermissionSessionState): void {
    this.store.set(state);
    this.persist(state);
  }

  private updateState(updater: (state: PermissionSessionState) => PermissionSessionState): void {
    this.store.update((current) => {
      const updated = updater(current);
      this.persist(updated);
      return updated;
    });
  }

  private resetState(): void {
    this.store.set(DEFAULT_SESSION);
    if (browser) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }
}

export const permissionManager = new PermissionManager();
