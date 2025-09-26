use candid::{CandidType, Deserialize, Principal};
use serde::Serialize;

/// Represents a user's deposit in the Stability Pool
#[derive(CandidType, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DepositInfo {
    pub icusd_amount: u64,           // Amount of icUSD deposited
    pub share_percentage: String,     // User's share as decimal string for precision
    pub pending_icp_gains: u64,      // Pending ICP gains from liquidations
    pub total_claimed_gains: u64,    // Total ICP claimed historically
    pub deposit_timestamp: u64,      // When the deposit was made
}

/// Represents a liquidation executed by the pool
#[derive(CandidType, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PoolLiquidationRecord {
    pub vault_id: u64,
    pub timestamp: u64,
    pub icusd_used: u64,            // Amount of icUSD used to repay debt
    pub icp_gained: u64,            // Amount of ICP received from liquidation
    pub liquidation_discount: String, // Discount received (as decimal string)
    pub depositors_count: u64,       // Number of depositors who shared gains
}

/// Current status of the Stability Pool
#[derive(CandidType, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StabilityPoolStatus {
    pub total_icusd_deposits: u64,
    pub total_depositors: u64,
    pub total_liquidations_executed: u64,
    pub total_icp_gains_distributed: u64,
    pub pool_utilization_ratio: String,     // Ratio of icUSD used vs available
    pub average_deposit_size: u64,
    pub current_apr_estimate: String,       // Estimated APR based on recent performance
}

/// Information about a specific user's position in the pool
#[derive(CandidType, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UserStabilityPosition {
    pub icusd_deposit: u64,
    pub share_percentage: String,
    pub pending_icp_gains: u64,
    pub total_claimed_gains: u64,
    pub deposit_timestamp: u64,
    pub estimated_daily_earnings: u64,      // Based on current pool performance
}

/// Detailed information about a liquidatable vault (from protocol perspective)
#[derive(CandidType, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LiquidatableVault {
    pub vault_id: u64,
    pub owner: Principal,
    pub collateral_amount: u64,      // ICP collateral
    pub debt_amount: u64,           // icUSD debt
    pub collateral_ratio: String,   // Current collateral ratio as decimal
    pub liquidation_discount: u64,  // Expected ICP gain from liquidation
    pub priority_score: u64,        // Higher = should liquidate first
}

/// Result of a liquidation execution
#[derive(CandidType, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LiquidationResult {
    pub vault_id: u64,
    pub icusd_used: u64,
    pub icp_gained: u64,
    pub success: bool,
    pub error_message: Option<String>,
    pub block_index: Option<u64>,
}

/// Arguments for initializing the Stability Pool
#[derive(CandidType, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StabilityPoolInitArgs {
    pub protocol_canister_id: Principal,
    pub icusd_ledger_id: Principal,
    pub icp_ledger_id: Principal,
    pub min_deposit_amount: u64,
    pub liquidation_discount: String,        // Expected discount (e.g., "0.1" for 10%)
}

/// Errors that can occur in Stability Pool operations
#[derive(CandidType, Debug, Clone, Deserialize)]
pub enum StabilityPoolError {
    // User errors
    InsufficientDeposit { required: u64, available: u64 },
    AmountTooLow { minimum_amount: u64 },
    NoDepositorFound,
    InsufficientPoolBalance,
    Unauthorized,

    // System errors
    ProtocolUnavailable { retry_after: u64 },
    LedgerTransferFailed { reason: String },
    InterCanisterCallFailed { target: String, method: String },

    // Liquidation errors
    NoLiquidatableVaults,
    LiquidationExecutionFailed { vault_id: u64, reason: String },
    VaultNotLiquidatable { vault_id: u64, current_ratio: String },

    // Critical errors
    StateCorruption { details: String },
    SystemBusy,
    TemporarilyUnavailable(String),
}

/// Configuration for the Stability Pool
#[derive(CandidType, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PoolConfiguration {
    pub min_deposit_amount: u64,             // Minimum deposit amount
    pub max_single_liquidation: u64,         // Maximum icUSD for single liquidation
    pub liquidation_scan_interval: u64,      // Seconds between vault scans
    pub max_liquidations_per_batch: u64,     // Max liquidations per batch
    pub emergency_pause: bool,               // Emergency pause flag
    pub authorized_admins: Vec<Principal>,   // Authorized admin principals
}

/// Represents a pending gain distribution to users
#[derive(CandidType, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PendingGainDistribution {
    pub vault_id: u64,
    pub total_icp_to_distribute: u64,
    pub snapshot_timestamp: u64,
    pub depositor_snapshots: Vec<(Principal, String)>, // (Principal, share_percentage)
}

/// Analytics data for the pool
#[derive(CandidType, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PoolAnalytics {
    pub total_volume_processed: u64,        // Total icUSD processed through liquidations
    pub average_liquidation_size: u64,      // Average icUSD per liquidation
    pub success_rate: String,               // Liquidation success rate as decimal
    pub total_profit_distributed: u64,      // Total ICP profits distributed
    pub active_depositors: u64,             // Depositors with non-zero balance
    pub pool_age_days: u64,                 // Days since pool creation
}