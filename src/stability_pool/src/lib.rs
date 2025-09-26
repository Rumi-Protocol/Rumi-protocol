use ic_cdk::{query, update, init, pre_upgrade, post_upgrade};
use candid::Principal;
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

// Constants from whitepaper specifications
pub const LIQUIDATION_DISCOUNT: &str = "0.1"; // 10% discount
pub const MIN_DEPOSIT_AMOUNT: u64 = 1_000_000; // 0.01 icUSD minimum

/// Initialize the Stability Pool canister
#[init]
fn init(args: StabilityPoolInitArgs) {
    mutate_state(|s| {
        s.initialize(args);
    });

    log!(INFO,
        "Stability Pool initialized with protocol canister: {}",
        read_state(|s| s.protocol_canister_id));
}

/// Deposit icUSD into the Stability Pool
#[update]
pub async fn deposit_icusd(amount: u64) -> Result<(), StabilityPoolError> {
    crate::deposits::deposit_icusd(amount).await
}

/// Withdraw icUSD from the Stability Pool
#[update]
pub async fn withdraw_icusd(amount: u64) -> Result<(), StabilityPoolError> {
    crate::deposits::withdraw_icusd(amount).await
}

/// Claim ICP gains from liquidations
#[update]
pub async fn claim_collateral_gains() -> Result<u64, StabilityPoolError> {
    crate::deposits::claim_collateral_gains().await
}

/// Execute liquidation of a specific vault
#[update]
pub async fn execute_liquidation(vault_id: u64) -> Result<LiquidationResult, StabilityPoolError> {
    crate::liquidation::execute_liquidation(vault_id).await
}

/// Automatically scan for liquidatable vaults and execute liquidations
#[update]
pub async fn scan_and_liquidate() -> Result<Vec<LiquidationResult>, StabilityPoolError> {
    crate::liquidation::scan_and_liquidate().await
}

/// Get current status of the Stability Pool
#[query]
pub fn get_pool_status() -> StabilityPoolStatus {
    read_state(|s| s.get_pool_status())
}

/// Get user's position in the Stability Pool
#[query]
pub fn get_user_position(user: Option<Principal>) -> Option<UserStabilityPosition> {
    let caller = user.unwrap_or_else(|| ic_cdk::api::caller());
    read_state(|s| s.get_depositor_info(caller))
}

/// Get recent liquidation history
#[query]
pub fn get_liquidation_history(limit: Option<u64>) -> Vec<PoolLiquidationRecord> {
    let limit = limit.unwrap_or(50).min(100); // Max 100 records
    read_state(|s| {
        s.liquidation_history
            .iter()
            .rev()
            .take(limit as usize)
            .cloned()
            .collect()
    })
}

/// Get list of liquidatable vaults from protocol
#[update]
pub async fn get_liquidatable_vaults() -> Result<Vec<LiquidatableVault>, StabilityPoolError> {
    crate::liquidation::get_liquidatable_vaults().await
}

/// Test function to verify protocol communication - get protocol status
#[update]
pub async fn test_protocol_connection() -> Result<String, StabilityPoolError> {
    use ic_cdk::call;
    use rumi_protocol_backend::StabilityPoolProtocolInfo;

    let protocol_canister_id = read_state(|s| s.protocol_canister_id);

    log!(INFO, "Testing connection to protocol canister: {}", protocol_canister_id);

    // Test our new get_stability_pool_info endpoint
    let call_result: Result<(StabilityPoolProtocolInfo,), _> = call(
        protocol_canister_id,
        "get_stability_pool_info",
        ()
    ).await;

    match call_result {
        Ok((info,)) => {
            let status = format!(
                "✅ Protocol connection successful!\nICP Rate: {:.4}\nMin Collateral Ratio: {:.2}%\nMode: {}\nTotal Debt: {} icUSD\nTotal Collateral: {} ICP",
                info.current_icp_rate,
                info.minimum_collateral_ratio * 100.0,
                info.mode,
                info.total_debt,
                info.total_collateral
            );
            log!(INFO, "Protocol status: {}", status);
            Ok(status)
        },
        Err(e) => {
            let error_msg = format!("❌ Protocol connection failed: {:?}", e);
            log!(INFO, "{}", error_msg);
            Err(StabilityPoolError::TemporarilyUnavailable(error_msg))
        }
    }
}

/// Check if the pool has sufficient funds for a given amount
#[query]
pub fn check_pool_capacity(required_amount: u64) -> bool {
    read_state(|s| s.has_sufficient_funds(ICUSD::from(required_amount)))
}

/// Get pool configuration (admin only)
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

/// Update pool configuration (admin only)
#[update]
pub fn update_pool_configuration(new_config: PoolConfiguration) -> Result<(), StabilityPoolError> {
    let caller = ic_cdk::api::caller();
    mutate_state(|s| {
        if s.configuration.authorized_admins.contains(&caller) {
            s.configuration = new_config;
            log!(INFO,
                "Pool configuration updated by admin: {}", caller);
            Ok(())
        } else {
            Err(StabilityPoolError::Unauthorized)
        }
    })
}

/// Emergency pause (admin only)
#[update]
pub fn emergency_pause() -> Result<(), StabilityPoolError> {
    let caller = ic_cdk::api::caller();
    mutate_state(|s| {
        if s.configuration.authorized_admins.contains(&caller) {
            s.configuration.emergency_pause = true;
            log!(INFO,
                "Emergency pause activated by admin: {}", caller);
            Ok(())
        } else {
            Err(StabilityPoolError::Unauthorized)
        }
    })
}

/// Resume operations (admin only)
#[update]
pub fn resume_operations() -> Result<(), StabilityPoolError> {
    let caller = ic_cdk::api::caller();
    mutate_state(|s| {
        if s.configuration.authorized_admins.contains(&caller) {
            s.configuration.emergency_pause = false;
            log!(INFO,
                "Operations resumed by admin: {}", caller);
            Ok(())
        } else {
            Err(StabilityPoolError::Unauthorized)
        }
    })
}

/// Get pool analytics data
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

        let success_rate = "1.0".to_string(); // TODO: Track failures

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

/// Validate pool state consistency (admin/debug function)
#[query]
pub fn validate_pool_state() -> Result<String, String> {
    read_state(|s| {
        s.validate_state().map(|_| "Pool state is consistent".to_string())
    })
}

// Canister upgrade hooks
#[pre_upgrade]
fn pre_upgrade() {
    log!(INFO, "Stability Pool pre-upgrade started");
    // State is automatically preserved by ic-stable-structures
}

#[post_upgrade]
fn post_upgrade() {
    log!(INFO, "Stability Pool post-upgrade completed");

    // Validate state after upgrade
    if let Err(error) = read_state(|s| s.validate_state()) {
        ic_cdk::trap(&format!("State validation failed after upgrade: {}", error));
    }

    // Resume liquidation monitoring if not paused
    if read_state(|s| !s.configuration.emergency_pause) {
        crate::liquidation::setup_liquidation_monitoring();
    }
}