use crate::types::{AssetBalance, AssetType, DepositRecord, TreasuryInitArgs};
use candid::Principal;
use ic_stable_structures::memory_manager::{MemoryId, MemoryManager, VirtualMemory};
use ic_stable_structures::{DefaultMemoryImpl, StableBTreeMap, StableCell};
use std::cell::RefCell;
use std::collections::HashMap;

type Memory = VirtualMemory<DefaultMemoryImpl>;

/// Treasury state that persists across upgrades
pub struct TreasuryState {
    /// All deposit records, indexed by deposit ID
    pub deposits: StableBTreeMap<u64, DepositRecord, Memory>,
    /// Current balances by asset type
    pub balances: HashMap<AssetType, AssetBalance>,
    /// Configuration data
    pub config: StableCell<TreasuryConfig, Memory>,
    /// Next available deposit ID
    pub next_deposit_id: u64,
}

/// Treasury configuration stored in stable memory
#[derive(candid::CandidType, serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct TreasuryConfig {
    /// Controller principal (pre-SNS backend, post-SNS governance)
    pub controller: Principal,
    /// icUSD ledger canister
    pub icusd_ledger: Principal,
    /// ICP ledger canister
    pub icp_ledger: Principal,
    /// ckBTC ledger canister (optional)
    pub ckbtc_ledger: Option<Principal>,
    /// Whether treasury accepts new deposits
    pub is_paused: bool,
}

// Storable implementation for TreasuryConfig
impl ic_stable_structures::Storable for TreasuryConfig {
    fn to_bytes(&self) -> std::borrow::Cow<[u8]> {
        std::borrow::Cow::Owned(candid::encode_one(self).unwrap())
    }

    fn from_bytes(bytes: std::borrow::Cow<[u8]>) -> Self {
        candid::decode_one(&bytes).unwrap()
    }

    const BOUND: ic_stable_structures::storable::Bound = ic_stable_structures::storable::Bound::Unbounded;
}

// Storable implementation for DepositRecord
impl ic_stable_structures::Storable for DepositRecord {
    fn to_bytes(&self) -> std::borrow::Cow<[u8]> {
        std::borrow::Cow::Owned(candid::encode_one(self).unwrap())
    }

    fn from_bytes(bytes: std::borrow::Cow<[u8]>) -> Self {
        candid::decode_one(&bytes).unwrap()
    }

    const BOUND: ic_stable_structures::storable::Bound = ic_stable_structures::storable::Bound::Unbounded;
}

thread_local! {
    static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> = 
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));
    
    static STATE: RefCell<Option<TreasuryState>> = RefCell::new(None);
}

impl TreasuryState {
    /// Initialize treasury state with given arguments
    pub fn init(args: TreasuryInitArgs) -> Self {
        MEMORY_MANAGER.with(|mm| {
            let memory_manager = mm.borrow();
            
            let config = TreasuryConfig {
                controller: args.controller,
                icusd_ledger: args.icusd_ledger,
                icp_ledger: args.icp_ledger,
                ckbtc_ledger: args.ckbtc_ledger,
                is_paused: false,
            };

            let mut balances = HashMap::new();
            balances.insert(AssetType::ICUSD, AssetBalance::default());
            balances.insert(AssetType::ICP, AssetBalance::default());
            balances.insert(AssetType::CKBTC, AssetBalance::default());

            Self {
                deposits: StableBTreeMap::init(memory_manager.get(MemoryId::new(0))),
                balances,
                config: StableCell::init(memory_manager.get(MemoryId::new(1)), config).unwrap(),
                next_deposit_id: 1,
            }
        })
    }

    /// Add a new deposit record and update balances
    pub fn add_deposit(&mut self, record: DepositRecord) -> u64 {
        let deposit_id = self.next_deposit_id;
        self.next_deposit_id += 1;

        // Update balance for this asset type
        if let Some(balance) = self.balances.get_mut(&record.asset_type) {
            balance.total += record.amount;
            balance.available += record.amount;
        }

        // Store the deposit record
        let mut final_record = record;
        final_record.id = deposit_id;
        self.deposits.insert(deposit_id, final_record);

        deposit_id
    }

    /// Withdraw funds (only controller can do this)
    pub fn withdraw(&mut self, asset_type: AssetType, amount: u64) -> Result<(), String> {
        let balance = self.balances.get_mut(&asset_type)
            .ok_or_else(|| format!("Unknown asset type: {:?}", asset_type))?;

        if balance.available < amount {
            return Err(format!(
                "Insufficient balance. Available: {}, requested: {}", 
                balance.available, amount
            ));
        }

        balance.total -= amount;
        balance.available -= amount;
        Ok(())
    }

    /// Get current configuration
    pub fn get_config(&self) -> TreasuryConfig {
        self.config.get().clone()
    }

    /// Update controller (for SNS transition)
    pub fn set_controller(&mut self, new_controller: Principal) -> Result<(), String> {
        let mut config = self.config.get().clone();
        config.controller = new_controller;
        self.config.set(config).map_err(|e| format!("Failed to update controller: {:?}", e))?;
        Ok(())
    }

    /// Pause/unpause treasury
    pub fn set_paused(&mut self, paused: bool) -> Result<(), String> {
        let mut config = self.config.get().clone();
        config.is_paused = paused;
        self.config.set(config).map_err(|e| format!("Failed to update pause state: {:?}", e))?;
        Ok(())
    }

    /// Get all deposits (paginated)
    pub fn get_deposits(&self, start: Option<u64>, limit: usize) -> Vec<DepositRecord> {
        let start_key = start.unwrap_or(0);
        self.deposits
            .range(start_key..)
            .take(limit)
            .map(|(_, record)| record)
            .collect()
    }

    /// Get total deposits count
    pub fn get_deposits_count(&self) -> u64 {
        self.deposits.len()
    }
}

/// Initialize the treasury state
pub fn init_state(args: TreasuryInitArgs) {
    STATE.with(|s| {
        *s.borrow_mut() = Some(TreasuryState::init(args));
    });
}

/// Read treasury state
pub fn with_state<R>(f: impl FnOnce(&TreasuryState) -> R) -> R {
    STATE.with(|s| {
        let state = s.borrow();
        let state = state.as_ref().expect("Treasury state not initialized");
        f(state)
    })
}

/// Mutate treasury state
pub fn with_state_mut<R>(f: impl FnOnce(&mut TreasuryState) -> R) -> R {
    STATE.with(|s| {
        let mut state = s.borrow_mut();
        let state = state.as_mut().expect("Treasury state not initialized");
        f(state)
    })
}