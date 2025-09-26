use std::collections::BTreeMap;
use std::cell::RefCell;
use candid::Principal;
use serde::{Serialize, Deserialize};
use rust_decimal::Decimal;
use rust_decimal::prelude::ToPrimitive;
use rust_decimal_macros::dec;
use rumi_protocol_backend::numeric::{ICUSD, ICP, Ratio};

use crate::types::*;

/// Main state structure for the Stability Pool canister
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StabilityPoolState {
    // Core pool data
    pub deposits: BTreeMap<Principal, DepositInfo>,
    pub total_icusd_deposits: ICUSD,
    pub total_icp_gains: ICP,

    // Liquidation tracking
    pub liquidation_history: Vec<PoolLiquidationRecord>,
    pub pending_gain_distributions: Vec<PendingGainDistribution>,

    // Configuration and references
    pub protocol_canister_id: Principal,
    pub icusd_ledger_id: Principal,
    pub icp_ledger_id: Principal,
    pub configuration: PoolConfiguration,

    // State tracking
    pub last_liquidation_scan: u64,
    pub total_liquidations_executed: u64,
    pub pool_creation_timestamp: u64,
    pub is_initialized: bool,
}

impl Default for StabilityPoolState {
    fn default() -> Self {
        Self {
            deposits: BTreeMap::new(),
            total_icusd_deposits: ICUSD::from(0),
            total_icp_gains: ICP::from(0),
            liquidation_history: Vec::new(),
            pending_gain_distributions: Vec::new(),
            protocol_canister_id: Principal::anonymous(),
            icusd_ledger_id: Principal::anonymous(),
            icp_ledger_id: Principal::anonymous(),
            configuration: PoolConfiguration {
                min_deposit_amount: 1_000_000,  // 0.01 icUSD
                max_single_liquidation: 1_000_000_000_000,  // 10,000 icUSD
                liquidation_scan_interval: 30,  // 30 seconds
                max_liquidations_per_batch: 5,
                emergency_pause: false,
                authorized_admins: Vec::new(),
            },
            last_liquidation_scan: 0,
            total_liquidations_executed: 0,
            pool_creation_timestamp: 0,
            is_initialized: false,
        }
    }
}

impl StabilityPoolState {
    /// Initialize the state with the given arguments
    pub fn initialize(&mut self, args: StabilityPoolInitArgs) {
        self.protocol_canister_id = args.protocol_canister_id;
        self.icusd_ledger_id = args.icusd_ledger_id;
        self.icp_ledger_id = args.icp_ledger_id;
        self.configuration.min_deposit_amount = args.min_deposit_amount;
        self.pool_creation_timestamp = ic_cdk::api::time();
        self.is_initialized = true;
    }

    /// Add a new deposit or increase existing deposit
    pub fn add_deposit(&mut self, user: Principal, amount: ICUSD, timestamp: u64) {
        self.total_icusd_deposits += amount;

        match self.deposits.get_mut(&user) {
            Some(existing_deposit) => {
                // Update existing deposit
                existing_deposit.icusd_amount += amount.to_u64();
            }
            None => {
                // Create new deposit
                self.deposits.insert(user, DepositInfo {
                    icusd_amount: amount.to_u64(),
                    share_percentage: "0".to_string(), // Will be recalculated
                    pending_icp_gains: 0,
                    total_claimed_gains: 0,
                    deposit_timestamp: timestamp,
                });
            }
        }

        // Recalculate all share percentages
        self.recalculate_shares();
    }

    /// Process a withdrawal from the pool
    pub fn process_withdrawal(&mut self, user: Principal, amount: ICUSD) -> Result<(), StabilityPoolError> {
        let deposit_info = self.deposits.get_mut(&user)
            .ok_or(StabilityPoolError::NoDepositorFound)?;

        if ICUSD::from(deposit_info.icusd_amount) < amount {
            return Err(StabilityPoolError::InsufficientDeposit {
                required: amount.to_u64(),
                available: deposit_info.icusd_amount,
            });
        }

        // Update deposit
        deposit_info.icusd_amount -= amount.to_u64();
        self.total_icusd_deposits -= amount;

        // Remove deposit if it becomes zero
        if deposit_info.icusd_amount == 0 {
            self.deposits.remove(&user);
        }

        // Recalculate share percentages
        self.recalculate_shares();
        Ok(())
    }

    /// Check if a user can withdraw the specified amount
    pub fn can_withdraw(&self, user: Principal, amount: ICUSD) -> bool {
        match self.deposits.get(&user) {
            Some(deposit_info) => ICUSD::from(deposit_info.icusd_amount) >= amount,
            None => false,
        }
    }

    /// Get pending ICP gains for a user
    pub fn get_pending_collateral_gains(&self, user: Principal) -> ICP {
        match self.deposits.get(&user) {
            Some(deposit_info) => ICP::from(deposit_info.pending_icp_gains),
            None => ICP::from(0),
        }
    }

    /// Mark gains as claimed for a user
    pub fn mark_gains_claimed(&mut self, user: Principal, amount: ICP) {
        if let Some(deposit_info) = self.deposits.get_mut(&user) {
            deposit_info.pending_icp_gains = deposit_info.pending_icp_gains.saturating_sub(amount.to_u64());
            deposit_info.total_claimed_gains += amount.to_u64();
        }
    }

    /// Process gains from a liquidation and distribute to depositors
    pub fn process_liquidation_gains(&mut self, vault_id: u64, icusd_used: ICUSD, icp_gained: ICP) {
        // Create liquidation record
        let liquidation_record = PoolLiquidationRecord {
            vault_id,
            timestamp: ic_cdk::api::time(),
            icusd_used: icusd_used.to_u64(),
            icp_gained: icp_gained.to_u64(),
            liquidation_discount: "0.1".to_string(), // 10% discount
            depositors_count: self.deposits.len() as u64,
        };

        self.liquidation_history.push(liquidation_record);
        self.total_liquidations_executed += 1;
        self.total_icp_gains += icp_gained;

        // Distribute gains proportionally to depositors
        if self.total_icusd_deposits > ICUSD::from(0) {
            for (_user, deposit_info) in self.deposits.iter_mut() {
                let user_share = Decimal::from_str_exact(&deposit_info.share_percentage)
                    .unwrap_or(dec!(0));
                let user_gain = icp_gained * Ratio::from(user_share);
                deposit_info.pending_icp_gains += user_gain.to_u64();
            }
        }

        // Update pool's icUSD since we used some for liquidation
        self.total_icusd_deposits = self.total_icusd_deposits.saturating_sub(icusd_used);
    }

    /// Recalculate share percentages for all depositors
    fn recalculate_shares(&mut self) {
        if self.total_icusd_deposits == ICUSD::from(0) {
            // No deposits, all shares are zero
            for deposit_info in self.deposits.values_mut() {
                deposit_info.share_percentage = "0".to_string();
            }
            return;
        }

        for deposit_info in self.deposits.values_mut() {
            let user_amount = Decimal::from(deposit_info.icusd_amount);
            let total_amount = Decimal::from(self.total_icusd_deposits.to_u64());
            let share_percentage = user_amount / total_amount;
            deposit_info.share_percentage = share_percentage.to_string();
        }
    }

    /// Get detailed information about a user's position
    pub fn get_depositor_info(&self, user: Principal) -> Option<UserStabilityPosition> {
        self.deposits.get(&user).map(|deposit_info| {
            UserStabilityPosition {
                icusd_deposit: deposit_info.icusd_amount,
                share_percentage: deposit_info.share_percentage.clone(),
                pending_icp_gains: deposit_info.pending_icp_gains,
                total_claimed_gains: deposit_info.total_claimed_gains,
                deposit_timestamp: deposit_info.deposit_timestamp,
                estimated_daily_earnings: self.estimate_daily_earnings(deposit_info),
            }
        })
    }

    /// Estimate daily earnings based on recent performance
    fn estimate_daily_earnings(&self, deposit_info: &DepositInfo) -> u64 {
        if self.liquidation_history.is_empty() {
            return 0;
        }

        // Simple estimation based on recent liquidations
        let recent_gains: u64 = self.liquidation_history.iter()
            .rev()
            .take(10) // Last 10 liquidations
            .map(|record| record.icp_gained)
            .sum();

        let user_share = Decimal::from_str_exact(&deposit_info.share_percentage)
            .unwrap_or(dec!(0));

        let estimated_daily = Decimal::from(recent_gains) * user_share;
        estimated_daily.to_u64().unwrap_or(0)
    }

    /// Get current pool status
    pub fn get_pool_status(&self) -> StabilityPoolStatus {
        let utilization_ratio = if self.total_icusd_deposits > ICUSD::from(0) {
            let total_processed: u64 = self.liquidation_history.iter()
                .map(|record| record.icusd_used)
                .sum();
            let ratio = Decimal::from(total_processed) / Decimal::from(self.total_icusd_deposits.to_u64());
            ratio.to_string()
        } else {
            "0".to_string()
        };

        let average_deposit_size = if self.deposits.is_empty() {
            0
        } else {
            self.total_icusd_deposits.to_u64() / self.deposits.len() as u64
        };

        StabilityPoolStatus {
            total_icusd_deposits: self.total_icusd_deposits.to_u64(),
            total_depositors: self.deposits.len() as u64,
            total_liquidations_executed: self.total_liquidations_executed,
            total_icp_gains_distributed: self.total_icp_gains.to_u64(),
            pool_utilization_ratio: utilization_ratio,
            average_deposit_size,
            current_apr_estimate: self.calculate_estimated_apr(),
        }
    }

    /// Calculate estimated APR based on recent performance
    fn calculate_estimated_apr(&self) -> String {
        if self.liquidation_history.is_empty() || self.total_icusd_deposits == ICUSD::from(0) {
            return "0".to_string();
        }

        // Simple APR estimation based on recent gains
        // This is a rough estimate and should be improved with more sophisticated calculations
        let days_active = ((ic_cdk::api::time() - self.pool_creation_timestamp) / (24 * 60 * 60 * 1_000_000_000)).max(1);
        let total_gains_value = Decimal::from(self.total_icp_gains.to_u64());
        let total_deposits_value = Decimal::from(self.total_icusd_deposits.to_u64());

        if total_deposits_value > dec!(0) {
            let daily_return_rate = total_gains_value / (total_deposits_value * Decimal::from(days_active));
            let annual_rate = daily_return_rate * dec!(365) * dec!(100); // Convert to percentage
            annual_rate.to_string()
        } else {
            "0".to_string()
        }
    }

    /// Check if the pool has sufficient funds for liquidation
    pub fn has_sufficient_funds(&self, required_amount: ICUSD) -> bool {
        self.total_icusd_deposits >= required_amount
    }

    /// Validate state consistency
    pub fn validate_state(&self) -> Result<(), String> {
        // Check that total deposits match sum of individual deposits
        let calculated_total: u64 = self.deposits.values()
            .map(|info| info.icusd_amount)
            .sum();

        if calculated_total != self.total_icusd_deposits.to_u64() {
            return Err(format!(
                "Deposit totals don't match: calculated={}, stored={}",
                calculated_total, self.total_icusd_deposits.to_u64()
            ));
        }

        // Check that all share percentages are valid
        for (user, deposit_info) in &self.deposits {
            if Decimal::from_str_exact(&deposit_info.share_percentage).is_err() {
                return Err(format!("Invalid share percentage for user {}: {}", user, deposit_info.share_percentage));
            }
        }

        Ok(())
    }
}

// Thread-local storage for the state
thread_local! {
    static STATE: RefCell<StabilityPoolState> = RefCell::new(StabilityPoolState::default());
}

/// Mutate the state using the provided function
pub fn mutate_state<F, R>(f: F) -> R
where
    F: FnOnce(&mut StabilityPoolState) -> R,
{
    STATE.with(|s| f(&mut s.borrow_mut()))
}

/// Read the state using the provided function
pub fn read_state<F, R>(f: F) -> R
where
    F: FnOnce(&StabilityPoolState) -> R,
{
    STATE.with(|s| f(&s.borrow()))
}

/// Replace the entire state (useful for upgrades)
pub fn replace_state(state: StabilityPoolState) {
    STATE.with(|s| {
        *s.borrow_mut() = state;
    });
}