use candid::{CandidType, Deserialize, Principal};
use serde::Serialize;

#[derive(CandidType, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DepositInfo {
    pub icusd_amount: u64,           
    pub share_percentage: String,     
    pub pending_icp_gains: u64,      
    pub total_claimed_gains: u64,    
    pub deposit_timestamp: u64,      
}

#[derive(CandidType, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PoolLiquidationRecord {
    pub vault_id: u64,
    pub timestamp: u64,
    pub icusd_used: u64,            
    pub icp_gained: u64,            
    pub liquidation_discount: String, 
    pub depositors_count: u64,       
}

#[derive(CandidType, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StabilityPoolStatus {
    pub total_icusd_deposits: u64,
    pub total_depositors: u64,
    pub total_liquidations_executed: u64,
    pub total_icp_gains_distributed: u64,
    pub pool_utilization_ratio: String,     
    pub average_deposit_size: u64,
    pub current_apr_estimate: String,       
}

#[derive(CandidType, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UserStabilityPosition {
    pub icusd_deposit: u64,
    pub share_percentage: String,
    pub pending_icp_gains: u64,
    pub total_claimed_gains: u64,
    pub deposit_timestamp: u64,
    pub estimated_daily_earnings: u64,      
}

#[derive(CandidType, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LiquidatableVault {
    pub vault_id: u64,
    pub owner: Principal,
    pub collateral_amount: u64,      
    pub debt_amount: u64,           
    pub collateral_ratio: String,   
    pub liquidation_discount: u64,  
    pub priority_score: u64,        
}

#[derive(CandidType, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LiquidationResult {
    pub vault_id: u64,
    pub icusd_used: u64,
    pub icp_gained: u64,
    pub success: bool,
    pub error_message: Option<String>,
    pub block_index: Option<u64>,
}

#[derive(CandidType, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StabilityPoolInitArgs {
    pub protocol_canister_id: Principal,
    pub icusd_ledger_id: Principal,
    pub icp_ledger_id: Principal,
    pub min_deposit_amount: u64,
    pub liquidation_discount: String,        
}

#[derive(CandidType, Debug, Clone, Deserialize)]
pub enum StabilityPoolError {
    InsufficientDeposit { required: u64, available: u64 },
    AmountTooLow { minimum_amount: u64 },
    NoDepositorFound,
    InsufficientPoolBalance,
    Unauthorized,

    ProtocolUnavailable { retry_after: u64 },
    LedgerTransferFailed { reason: String },
    InterCanisterCallFailed { target: String, method: String },

    NoLiquidatableVaults,
    LiquidationExecutionFailed { vault_id: u64, reason: String },
    VaultNotLiquidatable { vault_id: u64, current_ratio: String },

    StateCorruption { details: String },
    SystemBusy,
    TemporarilyUnavailable(String),
}

#[derive(CandidType, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PoolConfiguration {
    pub min_deposit_amount: u64,             
    pub max_single_liquidation: u64,         
    pub liquidation_scan_interval: u64,      
    pub max_liquidations_per_batch: u64,     
    pub emergency_pause: bool,               
    pub authorized_admins: Vec<Principal>,   
}

#[derive(CandidType, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PendingGainDistribution {
    pub vault_id: u64,
    pub total_icp_to_distribute: u64,
    pub snapshot_timestamp: u64,
    pub depositor_snapshots: Vec<(Principal, String)>, 
}

#[derive(CandidType, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PoolAnalytics {
    pub total_volume_processed: u64,        
    pub average_liquidation_size: u64,      
    pub success_rate: String,               
    pub total_profit_distributed: u64,      
    pub active_depositors: u64,             
    pub pool_age_days: u64,                 
}