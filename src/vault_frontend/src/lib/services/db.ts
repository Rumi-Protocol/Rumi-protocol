import { browser } from '$app/environment';

interface TokenBalance {
  wallet_id: string;
  canister_id: string;
  in_tokens: string;
  in_usd: string;
  timestamp: number;
}

class SimpleStorage {
  private storage: Map<string, any>;

  constructor() {
    this.storage = new Map();
  }

  async updateBalance(walletId: string, canisterId: string, balance: TokenBalance) {
    const key = `${walletId}-${canisterId}`;
    this.storage.set(key, balance);

    if (browser) {
      try {
        localStorage.setItem(key, JSON.stringify(balance));
      } catch (err) {
        console.error('Failed to store balance:', err);
      }
    }
  }

  async getBalance(walletId: string, canisterId: string) {
    const key = `${walletId}-${canisterId}`;
    let balance = this.storage.get(key);

    if (!balance && browser) {
      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          balance = JSON.parse(stored);
          this.storage.set(key, balance);
        }
      } catch (err) {
        console.error('Failed to retrieve balance:', err);
      }
    }

    return balance;
  }

  async clearBalances(walletId: string) {
    for (const [key] of this.storage) {
      if (key.startsWith(walletId)) {
        this.storage.delete(key);
        if (browser) {
          localStorage.removeItem(key);
        }
      }
    }
  }
}

export const vaultDB = new SimpleStorage();
