import type { Principal } from '@dfinity/principal';

const E8S = 100_000_000;

// Liquidity provider status
export interface LiquidityStatus {
  liquidityProvided: number;
  totalLiquidityProvided: number;
  liquidityPoolShare: number;
  availableLiquidityReward: number;
}

// Fee information returned by the protocol
export interface FeesInfo {
  borrowingFee: number;
  redemptionFee: number;
}

// Results from vault operations
export interface VaultOperationResult {
  success: boolean;
  vaultId?: number;
  error?: string;
  blockIndex?: number;
  feePaid?: number;
  message?: string;
}

export interface VaultHistoryEvent {
  type: string;
  timestamp: number;
  amount: number;
  details: Record<string, any>;
}

export interface UserBalances {
  icp: number;
  icusd: number;
}

// Fees returned to the frontend
export interface FeesDTO {
  borrowingFee: number;
  redemptionFee: number;
}

// Vault as returned to the frontend
export interface VaultDTO {
  vaultId: number;
  owner: string;
  icpMargin: number;
  borrowedIcusd: number;
  timestamp?: number;
}

/**
 * Interface for CandidVault as returned by the backend
 */
export interface CandidVault {
  vault_id: number;
  owner: string;
  borrowed_icusd_amount: number;
  icp_margin_amount: number;
}

// Liquidity status as returned to the frontend
export interface LiquidityStatusDTO {
  liquidity_provided: bigint;
  total_liquidity_provided: bigint;
  liquidity_pool_share: number;
  available_liquidity_reward: bigint;
  total_available_returns: bigint;
}

// Alias for compatibility with existing code
export type Vault = VaultDTO;

export interface ProtocolStatusDTO {
  mode: any;
  totalIcpMargin: number;
  totalIcusdBorrowed: number;
  lastIcpRate: number;
  lastIcpTimestamp: number;
  totalCollateralRatio: number;
}

export type ProtocolStatus = ProtocolStatusDTO;

export interface EnhancedVault {
  vaultId: number;
  owner: string;
  icpMargin: number;
  borrowedIcusd: number;
  timestamp: number;
  lastUpdated: number;
  collateralRatio?: number;
  collateralValueUSD?: number;
  maxBorrowable?: number;
  status?: 'healthy' | 'warning' | 'danger';
}