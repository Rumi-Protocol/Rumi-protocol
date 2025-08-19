use candid::{CandidType, Deserialize, Principal};
use serde::Serialize;

/// Types of deposits that can be made to the treasury
#[derive(CandidType, Serialize, Deserialize, Clone, Debug, PartialEq)]
pub enum DepositType {
    /// Fee collected when users mint icUSD
    MintingFee,
    /// Fee collected when users redeem icUSD
    RedemptionFee,
    /// Surplus collateral from liquidations
    LiquidationSurplus,
    /// Stability fees accrued over time
    StabilityFee,
}

/// Asset types that can be held in treasury
#[derive(CandidType, Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Hash)]
pub enum AssetType {
    /// icUSD stablecoin
    ICUSD,
    /// ICP collateral
    ICP,
    /// ckBTC collateral (for future Bitcoin support)
    CKBTC,
}

/// A record of a deposit to the treasury
#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
pub struct DepositRecord {
    /// Unique ID for this deposit
    pub id: u64,
    /// Type of deposit (minting fee, liquidation surplus, etc.)
    pub deposit_type: DepositType,
    /// Asset type (icUSD, ICP, ckBTC)
    pub asset_type: AssetType,
    /// Amount deposited (in e8s)
    pub amount: u64,
    /// Block index of the transfer that funded this deposit
    pub block_index: u64,
    /// Timestamp when deposit was made
    pub timestamp: u64,
    /// Optional memo/description
    pub memo: Option<String>,
}

/// Treasury balance for a specific asset
#[derive(CandidType, Serialize, Deserialize, Clone, Debug, Default)]
pub struct AssetBalance {
    /// Total amount of this asset
    pub total: u64,
    /// Amount reserved/locked
    pub reserved: u64,
    /// Amount available for withdrawal
    pub available: u64,
}

/// Treasury status overview
#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
pub struct TreasuryStatus {
    /// Total number of deposits
    pub total_deposits: u64,
    /// Balances by asset type
    pub balances: Vec<(AssetType, AssetBalance)>,
    /// Controller principal (pre-SNS) or governance canister (post-SNS)
    pub controller: Principal,
    /// Whether treasury is paused
    pub is_paused: bool,
}

/// Arguments for initializing treasury
#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
pub struct TreasuryInitArgs {
    /// Initial controller (usually protocol backend canister)
    pub controller: Principal,
    /// icUSD ledger principal
    pub icusd_ledger: Principal,
    /// ICP ledger principal  
    pub icp_ledger: Principal,
    /// ckBTC ledger principal (for future use)
    pub ckbtc_ledger: Option<Principal>,
}

/// Arguments for making a deposit
#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
pub struct DepositArgs {
    /// Type of deposit
    pub deposit_type: DepositType,
    /// Asset being deposited
    pub asset_type: AssetType,
    /// Amount to deposit (in e8s)
    pub amount: u64,
    /// Block index of the funding transfer
    pub block_index: u64,
    /// Optional memo
    pub memo: Option<String>,
}

/// Arguments for withdrawing from treasury
#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
pub struct WithdrawArgs {
    /// Asset to withdraw
    pub asset_type: AssetType,
    /// Amount to withdraw (in e8s)
    pub amount: u64,
    /// Destination principal
    pub to: Principal,
    /// Optional memo for the transfer
    pub memo: Option<String>,
}

/// Result of a successful withdrawal
#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
pub struct WithdrawResult {
    /// Block index of the transfer
    pub block_index: u64,
    /// Amount actually transferred (after fees)
    pub amount_transferred: u64,
    /// Fee deducted
    pub fee: u64,
}