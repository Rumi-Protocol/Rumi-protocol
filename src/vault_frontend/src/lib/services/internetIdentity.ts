import { AuthClient } from '@dfinity/auth-client';
import { HttpAgent, Actor } from '@dfinity/agent';
import type { Identity } from '@dfinity/agent';
import type { Principal } from '@dfinity/principal';
import { CONFIG } from '../config';

// Internet Identity canister ID
const II_CANISTER_ID = 'rdmx6-jaaaa-aaaaa-aaadq-cai';
const II_URL = CONFIG.isLocal
  ? `http://uxrrr-q7777-77774-qaaaq-cai.localhost:4943`
  : 'https://identity.ic0.app';

export interface IIAuthService {
  authClient: AuthClient | null;
  identity: Identity | null;
  principal: Principal | null;
  isAuthenticated: boolean;
}

class InternetIdentityService implements IIAuthService {
  authClient: AuthClient | null = null;
  identity: Identity | null = null;
  principal: Principal | null = null;
  isAuthenticated: boolean = false;
  private agent: HttpAgent | null = null;

  /**
   * Initialize the AuthClient
   */
  async init(): Promise<void> {
    try {
      this.authClient = await AuthClient.create();
      
      // Check if already authenticated
      const isAuthenticated = await this.authClient.isAuthenticated();
      
      if (isAuthenticated) {
        this.identity = this.authClient.getIdentity();
        this.principal = this.identity.getPrincipal();
        this.isAuthenticated = true;
        
        // Create agent with this identity
        await this.createAgent();
        
        console.log('II: Already authenticated', this.principal?.toText());
      }
    } catch (error) {
      console.error('Failed to initialize Internet Identity:', error);
      throw error;
    }
  }

  /**
   * Create an HTTP agent with the current identity
   */
  private async createAgent(): Promise<void> {
    if (!this.identity) {
      throw new Error('No identity available');
    }

    this.agent = new HttpAgent({
      identity: this.identity,
      host: CONFIG.isLocal ? 'http://localhost:4943' : 'https://ic0.app'
    });

    // Fetch root key for local development
    if (CONFIG.isLocal) {
      await this.agent.fetchRootKey();
    }
  }

  /**
   * Login with Internet Identity
   */
  async login(): Promise<{ owner: Principal } | null> {
    try {
      if (!this.authClient) {
        await this.init();
      }

      return new Promise((resolve, reject) => {
        this.authClient!.login({
          identityProvider: II_URL,
          maxTimeToLive: BigInt(7 * 24 * 60 * 60 * 1000 * 1000 * 1000), // 7 days in nanoseconds
          onSuccess: async () => {
            try {
              this.identity = this.authClient!.getIdentity();
              this.principal = this.identity.getPrincipal();
              this.isAuthenticated = true;

              // Create agent
              await this.createAgent();

              console.log('II: Login successful', this.principal?.toText());
              
              resolve({ owner: this.principal! });
            } catch (error) {
              console.error('II: Post-login setup failed', error);
              reject(error);
            }
          },
          onError: (error) => {
            console.error('II: Login failed', error);
            reject(error);
          }
        });
      });
    } catch (error) {
      console.error('II: Login error', error);
      throw error;
    }
  }

  /**
   * Logout from Internet Identity
   */
  async logout(): Promise<void> {
    try {
      if (this.authClient) {
        await this.authClient.logout();
      }
      
      this.identity = null;
      this.principal = null;
      this.isAuthenticated = false;
      this.agent = null;
      
      console.log('II: Logged out');
    } catch (error) {
      console.error('II: Logout failed', error);
      throw error;
    }
  }

  /**
   * Get an actor for a specific canister
   */
  async getActor<T>(canisterId: string, idlFactory: any): Promise<T> {
    if (!this.agent || !this.identity) {
      throw new Error('Not authenticated with Internet Identity');
    }

    try {
      const actor = Actor.createActor<T>(idlFactory, {
        agent: this.agent,
        canisterId
      });

      return actor;
    } catch (error) {
      console.error('Failed to create actor:', error);
      throw error;
    }
  }

  /**
   * Check if currently authenticated
   */
  async checkAuthentication(): Promise<boolean> {
    if (!this.authClient) {
      await this.init();
    }
    
    return this.authClient?.isAuthenticated() || false;
  }

  /**
   * Get the current principal
   */
  getPrincipal(): Principal | null {
    return this.principal;
  }

  /**
   * Get the current identity
   */
  getIdentity(): Identity | null {
    return this.identity;
  }

  /**
   * Get the HTTP agent
   */
  getAgent(): HttpAgent | null {
    return this.agent;
  }
}

// Export singleton instance
export const internetIdentity = new InternetIdentityService();