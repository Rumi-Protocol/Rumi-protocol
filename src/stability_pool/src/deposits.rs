// Deposit and withdrawal functionality for the Stability Pool
// TODO: Implement in next phase

use rumi_protocol_backend::numeric::{ICUSD, ICP};
use ic_canister_log::log;
use crate::logs::INFO;

use crate::types::*;
use crate::state::read_state;

/// Deposit icUSD into the Stability Pool
pub async fn deposit_icusd(amount: u64) -> Result<(), StabilityPoolError> {
    let caller = ic_cdk::api::caller();
    let deposit_amount = ICUSD::from(amount);

    // Basic validation
    if deposit_amount.to_u64() < crate::MIN_DEPOSIT_AMOUNT {
        return Err(StabilityPoolError::AmountTooLow {
            minimum_amount: crate::MIN_DEPOSIT_AMOUNT,
        });
    }

    // Check if emergency paused
    if read_state(|s| s.configuration.emergency_pause) {
        return Err(StabilityPoolError::TemporarilyUnavailable(
            "Pool is emergency paused".to_string()
        ));
    }

    log!(INFO,
        "Deposit request: {} icUSD from {}", amount, caller);

    // TODO: Implement ICRC-2 transfer_from to receive icUSD from user
    // TODO: Update state with new deposit
    // TODO: Recalculate shares

    Err(StabilityPoolError::TemporarilyUnavailable(
        "Deposit functionality not yet implemented".to_string()
    ))
}

/// Withdraw icUSD from the Stability Pool
pub async fn withdraw_icusd(amount: u64) -> Result<(), StabilityPoolError> {
    let caller = ic_cdk::api::caller();
    let withdraw_amount = ICUSD::from(amount);

    // Check if emergency paused
    if read_state(|s| s.configuration.emergency_pause) {
        return Err(StabilityPoolError::TemporarilyUnavailable(
            "Pool is emergency paused".to_string()
        ));
    }

    // Validate user has sufficient deposit
    let can_withdraw = read_state(|s| s.can_withdraw(caller, withdraw_amount));
    if !can_withdraw {
        return Err(StabilityPoolError::InsufficientDeposit {
            required: amount,
            available: read_state(|s| {
                s.deposits.get(&caller)
                    .map(|info| info.icusd_amount)
                    .unwrap_or(0)
            }),
        });
    }

    log!(INFO,
        "Withdrawal request: {} icUSD from {}", amount, caller);

    // TODO: Implement ICRC-1 transfer to send icUSD to user
    // TODO: Update state after withdrawal
    // TODO: Recalculate shares

    Err(StabilityPoolError::TemporarilyUnavailable(
        "Withdrawal functionality not yet implemented".to_string()
    ))
}

/// Claim ICP gains from liquidations
pub async fn claim_collateral_gains() -> Result<u64, StabilityPoolError> {
    let caller = ic_cdk::api::caller();

    // Check if emergency paused
    if read_state(|s| s.configuration.emergency_pause) {
        return Err(StabilityPoolError::TemporarilyUnavailable(
            "Pool is emergency paused".to_string()
        ));
    }

    let pending_gains = read_state(|s| s.get_pending_collateral_gains(caller));

    if pending_gains == ICP::from(0) {
        return Ok(0);
    }

    log!(INFO,
        "Claim request: {} ICP from {}", pending_gains.to_u64(), caller);

    // TODO: Implement ICRC-1 transfer to send ICP to user
    // TODO: Update state to mark gains as claimed

    Err(StabilityPoolError::TemporarilyUnavailable(
        "Claim functionality not yet implemented".to_string()
    ))
}