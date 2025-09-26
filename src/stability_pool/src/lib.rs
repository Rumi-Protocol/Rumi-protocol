use ic_cdk::{query, update, init, pre_upgrade, post_upgrade};
use candid::{candid_method, Principal};
use rumi_protocol_backend::numeric::ICUSD;
use ic_canister_log::log;
use crate::logs::INFO;

pub mod types;
pub mod state;
pub mod deposits;
pub mod liquidation;
pub mod logs;

use crate::types::*;
use crate::state::{mutate_state, read_state};

pub const LIQUIDATION_DISCOUNT: &str = "0.1";
pub const MIN_DEPOSIT_AMOUNT: u64 = 1_000_000;

#[init]
fn init(args: StabilityPoolInitArgs) {
    mutate_state(|s| {
        s.initialize(args);
    });

    log!(INFO,
        "Stability Pool initialized with protocol canister: {}",
        read_state(|s| s.protocol_canister_id));

    crate::liquidation::setup_liquidation_monitoring();
}

#[candid_method]
#[update]
pub async fn deposit_icusd(amount: u64) -> Result<(), StabilityPoolError> {
    crate::deposits::deposit_icusd(amount).await
}

#[update]
pub async fn withdraw_icusd(amount: u64) -> Result<(), StabilityPoolError> {
    crate::deposits::withdraw_icusd(amount).await
}

#[update]
pub async fn claim_collateral_gains() -> Result<u64, StabilityPoolError> {
    crate::deposits::claim_collateral_gains().await
}

#[update]
pub async fn execute_liquidation(vault_id: u64) -> Result<LiquidationResult, StabilityPoolError> {
    crate::liquidation::execute_liquidation(vault_id).await
}

#[update]
pub async fn scan_and_liquidate() -> Result<Vec<LiquidationResult>, StabilityPoolError> {
    crate::liquidation::scan_and_liquidate().await
}

#[candid_method(query)]
#[query]
pub fn get_pool_status() -> StabilityPoolStatus {
    read_state(|s| s.get_pool_status())
}

#[query]
pub fn get_user_position(user: Option<Principal>) -> Option<UserStabilityPosition> {
    let caller = user.unwrap_or_else(|| ic_cdk::api::caller());
    read_state(|s| s.get_depositor_info(caller))
}

#[query]
pub fn get_liquidation_history(limit: Option<u64>) -> Vec<PoolLiquidationRecord> {
    let limit = limit.unwrap_or(50).min(100);
    read_state(|s| {
        s.liquidation_history
            .iter()
            .rev()
            .take(limit as usize)
            .cloned()
            .collect()
    })
}

#[update]
pub async fn get_liquidatable_vaults() -> Result<Vec<LiquidatableVault>, StabilityPoolError> {
    crate::liquidation::get_liquidatable_vaults().await
}


#[query]
pub fn check_pool_capacity(required_amount: u64) -> bool {
    read_state(|s| s.has_sufficient_funds(ICUSD::from(required_amount)))
}

#[query]
pub fn get_pool_configuration() -> Result<PoolConfiguration, StabilityPoolError> {
    let caller = ic_cdk::api::caller();
    read_state(|s| {
        if s.configuration.authorized_admins.contains(&caller) {
            Ok(s.configuration.clone())
        } else {
            Err(StabilityPoolError::Unauthorized)
        }
    })
}

#[update]
pub fn update_pool_configuration(new_config: PoolConfiguration) -> Result<(), StabilityPoolError> {
    let caller = ic_cdk::api::caller();
    mutate_state(|s| {
        if s.configuration.authorized_admins.contains(&caller) {
            s.configuration = new_config;
            log!(INFO, "Pool configuration updated by admin: {}", caller);
            Ok(())
        } else {
            Err(StabilityPoolError::Unauthorized)
        }
    })
}

#[update]
pub fn emergency_pause() -> Result<(), StabilityPoolError> {
    let caller = ic_cdk::api::caller();
    mutate_state(|s| {
        if s.configuration.authorized_admins.contains(&caller) {
            s.configuration.emergency_pause = true;
            log!(INFO, "Emergency pause activated by admin: {}", caller);
            Ok(())
        } else {
            Err(StabilityPoolError::Unauthorized)
        }
    })
}

#[update]
pub fn resume_operations() -> Result<(), StabilityPoolError> {
    let caller = ic_cdk::api::caller();
    mutate_state(|s| {
        if s.configuration.authorized_admins.contains(&caller) {
            s.configuration.emergency_pause = false;
            log!(INFO, "Operations resumed by admin: {}", caller);
            Ok(())
        } else {
            Err(StabilityPoolError::Unauthorized)
        }
    })
}

#[query]
pub fn get_pool_analytics() -> PoolAnalytics {
    read_state(|s| {
        let total_volume: u64 = s.liquidation_history.iter()
            .map(|record| record.icusd_used)
            .sum();

        let average_liquidation_size = if s.liquidation_history.is_empty() {
            0
        } else {
            total_volume / s.liquidation_history.len() as u64
        };

        let success_rate = "1.0".to_string();

        let total_profit: u64 = s.liquidation_history.iter()
            .map(|record| record.icp_gained)
            .sum();

        let active_depositors = s.deposits.iter()
            .filter(|(_, info)| info.icusd_amount > 0)
            .count() as u64;

        let pool_age_days = ((ic_cdk::api::time() - s.pool_creation_timestamp) / (24 * 60 * 60 * 1_000_000_000)).max(1);

        PoolAnalytics {
            total_volume_processed: total_volume,
            average_liquidation_size,
            success_rate,
            total_profit_distributed: total_profit,
            active_depositors,
            pool_age_days,
        }
    })
}

#[query]
pub fn validate_pool_state() -> Result<String, String> {
    read_state(|s| {
        s.validate_state().map(|_| "Pool state is consistent".to_string())
    })
}

#[pre_upgrade]
fn pre_upgrade() {
    log!(INFO, "Stability Pool pre-upgrade started");
}

#[post_upgrade]
fn post_upgrade() {
    log!(INFO, "Stability Pool post-upgrade completed");

    if let Err(error) = read_state(|s| s.validate_state()) {
        ic_cdk::trap(&format!("State validation failed after upgrade: {}", error));
    }

    if read_state(|s| !s.configuration.emergency_pause) {
        crate::liquidation::setup_liquidation_monitoring();
    }
}


