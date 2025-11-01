// Import types from declarations
import type {
  _SERVICE,
  Vault as CanisterVault,
  ProtocolStatus as CanisterProtocolStatus,
  LiquidityStatus as CanisterLiquidityStatus,
  Fees,
  SuccessWithFee,
  ProtocolError,
  OpenVaultSuccess,
} from '../../../../declarations/rumi_protocol_backend/rumi_protocol_backend.did';

import { ApiClient} from './protocol/apiClient';
import { QueryOperations } from './protocol/queryOperations';
import { walletOperations } from './protocol/walletOperations';


// Constants from backend
const E8S = 100_000_000;
const MIN_ICP_AMOUNT = 100_000; // 0.001 ICP
const MIN_ICUSD_AMOUNT = 10_000_000; // 0.10 icUSD (10 cents)
const MINIMUM_COLLATERAL_RATIO = 1.33; // 133%
const RECOVERY_COLLATERAL_RATIO = 1.5; // 150%

/**
 * Protocol Service provides a consolidated API to interact with the protocol canister
 * This is the main entry point that delegates to specialized modules
 */
export class ProtocolService {
  // API Client utility methods
  static isAlreadyProcessingError = ApiClient.isAlreadyProcessingError;
  static isStaleProcessingState = ApiClient.isStaleProcessingState;

  // Query Operations - direct pass-through to QueryOperations for read-only operations
  static getProtocolStatus = QueryOperations.getProtocolStatus;
  static getICPPrice = QueryOperations.getICPPrice;
  static getFees = QueryOperations.getFees;
  static getPendingTransfers = QueryOperations.getPendingTransfers;
  static triggerPendingTransfers = ApiClient.triggerPendingTransfers;

  // Vault Operations - these go through ProtocolManager for proper error handling and queuing
  static openVault = ApiClient.openVault;
  static getUserVaults = ApiClient.getUserVaults;
  static getVaultById = ApiClient.getVaultById;
  static borrowFromVault = ApiClient.borrowFromVault;
  static addMarginToVault = ApiClient.addMarginToVault;
  static repayToVault = ApiClient.repayToVault;
  static closeVault = ApiClient.closeVault;
  static getVaultHistory = ApiClient.getVaultHistory;
  static redeemIcp = ApiClient.redeemIcp;
  static withdrawCollateral = ApiClient.withdrawCollateral;
  
  // Liquidity Operations - these go through ProtocolManager for proper error handling and queuing
  static getLiquidityStatus = ApiClient.getLiquidityStatus;
  static provideLiquidity = ApiClient.provideLiquidity;
  static withdrawLiquidity = ApiClient.withdrawLiquidity;
  static claimLiquidityReturns = ApiClient.claimLiquidityReturns;
  static withdrawCollateralAndCloseVault = ApiClient.withdrawCollateralAndCloseVault;
  static liquidate_vault = ApiClient.liquidateVault;
  static liquidate_vault_partial = ApiClient.liquidateVaultPartial;
  static getLiquidatableVaults = ApiClient.getLiquidatableVaults;



  // Wallet Operations
  static checkIcpAllowance = walletOperations.checkIcpAllowance;
  static checkIcusdAllowance = walletOperations.checkIcusdAllowance;
  static approveIcusdTransfer = walletOperations.approveIcusdTransfer;
  static approveIcpTransfer = walletOperations.approveIcpTransfer;
  static resetWalletSignerState = walletOperations.resetWalletSignerState;

}


/**
 * Public singleton for more convenient access
 */
export const protocolService = {
  // Query methods
  getProtocolStatus: ProtocolService.getProtocolStatus,
  getFees: ProtocolService.getFees,
  getICPPrice: ProtocolService.getICPPrice,
  getPendingTransfers: ProtocolService.getPendingTransfers,
  triggerPendingTransfers: ProtocolService.triggerPendingTransfers,
  
  // Vault operations
  openVault: ProtocolService.openVault,
  getUserVaults: ProtocolService.getUserVaults,
  borrowFromVault: ProtocolService.borrowFromVault,
  addMarginToVault: ProtocolService.addMarginToVault,
  repayToVault: ProtocolService.repayToVault,
  closeVault: ProtocolService.closeVault,
  getVaultHistory: ProtocolService.getVaultHistory,
  redeemIcp: ProtocolService.redeemIcp,
  getLiquidityStatus: ProtocolService.getLiquidityStatus,
  provideLiquidity: ProtocolService.provideLiquidity,
  withdrawLiquidity: ProtocolService.withdrawLiquidity,
  claimLiquidityReturns: ProtocolService.claimLiquidityReturns,
  withdrawCollateral: ProtocolService.withdrawCollateral,
  getVaultById: ProtocolService.getVaultById,
  getLiquidatableVaults: ProtocolService.getLiquidatableVaults,
  liquidateVault: ProtocolService.liquidate_vault,
  liquidateVaultPartial: ProtocolService.liquidate_vault_partial,
  
  // Add the new combined operation to the public API
  withdrawCollateralAndCloseVault: ProtocolService.withdrawCollateralAndCloseVault,

  // Wallet operations
  approveIcpTransfer: ProtocolService.approveIcpTransfer,
  resetWalletSignerState: ProtocolService.resetWalletSignerState,
  checkIcpAllowance: ProtocolService.checkIcpAllowance,
  checkIcusdAllowance: ProtocolService.checkIcusdAllowance,
  approveIcusdTransfer: ProtocolService.approveIcusdTransfer,
  
  // Error helpers
  isAlreadyProcessingError: ProtocolService.isAlreadyProcessingError,
  isStaleProcessingState: ProtocolService.isStaleProcessingState,
};



