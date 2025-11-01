use candid::{CandidType, Deserialize, Principal};
use ic_stable_structures::{Storable, storable::Bound};
use serde::Serialize;
use std::cell::RefCell;
use std::collections::HashMap;
use std::borrow::Cow;

#[derive(CandidType, Deserialize, Serialize, Clone, Debug)]
pub struct UserDeposit {
    pub user: Principal,
    pub icusd_amount: u64,
    pub deposit_time: u64,
    pub pending_collateral: Vec<CollateralReward>,
}

impl Storable for UserDeposit {
    const BOUND: Bound = Bound::Unbounded;

    fn to_bytes(&self) -> Cow<[u8]> {
        let bytes = candid::encode_one(self).unwrap();
        Cow::Owned(bytes)
    }

    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        candid::decode_one(&bytes).unwrap()
    }
}

#[derive(CandidType, Deserialize, Serialize, Clone, Debug)]
pub struct CollateralReward {
    pub collateral_type: CollateralType,
    pub amount: u64,
    pub liquidation_id: u64,
}

#[derive(CandidType, Deserialize, Serialize, Clone, Debug)]
pub enum CollateralType {
    ICP,
    CkBTC,
}

#[derive(CandidType, Deserialize, Serialize, Clone, Debug)]
pub struct LiquidationRecord {
    pub liquidation_id: u64,
    pub vault_id: u64,
    pub liquidated_debt: u64,
    pub collateral_received: u64,
    pub collateral_type: CollateralType,
    pub liquidation_time: u64,
    pub pool_size_at_liquidation: u64,
}

impl Storable for LiquidationRecord {
    const BOUND: Bound = Bound::Unbounded;

    fn to_bytes(&self) -> Cow<[u8]> {
        let bytes = candid::encode_one(self).unwrap();
        Cow::Owned(bytes)
    }

    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        candid::decode_one(&bytes).unwrap()
    }
}

#[derive(CandidType, Deserialize, Serialize, Clone, Debug)]
pub struct PoolInfo {
    pub total_icusd_deposited: u64,
    pub total_depositors: u64,
    pub pool_utilization: f64,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct InitArgs {
    pub protocol_owner: Principal,
    pub liquidation_discount: u8, // Percentage (e.g., 10 for 10%)
    pub max_ltv_ratio: u8,        // Percentage (e.g., 80 for 80%)
}

#[derive(CandidType, Serialize, Clone, Debug)]
pub struct DepositResult {
    pub success: bool,
    pub new_balance: u64,
    pub message: String,
}

#[derive(CandidType, Serialize, Clone, Debug)]
pub struct WithdrawResult {
    pub success: bool,
    pub remaining_balance: u64,
    pub message: String,
}

#[derive(CandidType, Serialize, Clone, Debug)]
pub struct ClaimResult {
    pub success: bool,
    pub claimed_collateral: Vec<CollateralReward>,
    pub message: String,
}

#[derive(CandidType, Serialize, Clone, Debug)]
pub struct ManualLiquidationResult {
    pub success: bool,
    pub liquidations_executed: u64,
    pub message: String,
}

// Use simple in-memory storage for now
thread_local! {
    pub static DEPOSITS: RefCell<HashMap<Principal, UserDeposit>> = RefCell::new(HashMap::new());
    pub static LIQUIDATIONS: RefCell<HashMap<u64, LiquidationRecord>> = RefCell::new(HashMap::new());
    pub static STATE: RefCell<PoolState> = RefCell::new(PoolState::default());
}

#[derive(Clone, Debug, CandidType, Deserialize)]
pub struct PoolState {
    pub protocol_owner: Principal,
    pub liquidation_discount: u8,  // Percentage (e.g., 10 for 10%)
    pub max_ltv_ratio: u8,         // Percentage (e.g., 80 for 80%)
    pub next_liquidation_id: u64,
    pub paused: bool,
}

impl Default for PoolState {
    fn default() -> Self {
        Self {
            protocol_owner: Principal::anonymous(),
            liquidation_discount: 10,  // 10%
            max_ltv_ratio: 66,         // 66%
            next_liquidation_id: 1,
            paused: false,
        }
    }
}