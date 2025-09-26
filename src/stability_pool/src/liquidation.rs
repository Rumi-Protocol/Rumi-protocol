// Liquidation execution functionality for the Stability Pool
// TODO: Implement in next phase

use ic_cdk_timers;
use std::time::Duration;
use ic_canister_log::log;
use ic_cdk::call;
use candid::Principal;

use crate::types::*;
use crate::state::read_state;
use crate::logs::INFO;

// Import CandidVault from the protocol backend
use rumi_protocol_backend::vault::CandidVault;

/// Execute liquidation of a specific vault
pub async fn execute_liquidation(vault_id: u64) -> Result<LiquidationResult, StabilityPoolError> {
    // Check if emergency paused
    if read_state(|s| s.configuration.emergency_pause) {
        return Err(StabilityPoolError::TemporarilyUnavailable(
            "Pool is emergency paused".to_string()
        ));
    }

    log!(INFO,
        "Liquidation request for vault: {}", vault_id);

    // TODO: Implement inter-canister call to protocol canister
    // TODO: Execute liquidation and receive results
    // TODO: Distribute gains to depositors

    Ok(LiquidationResult {
        vault_id,
        icusd_used: 0,
        icp_gained: 0,
        success: false,
        error_message: Some("Liquidation functionality not yet implemented".to_string()),
        block_index: None,
    })
}

/// Scan for liquidatable vaults and execute liquidations
pub async fn scan_and_liquidate() -> Result<Vec<LiquidationResult>, StabilityPoolError> {
    // Check if emergency paused
    if read_state(|s| s.configuration.emergency_pause) {
        return Err(StabilityPoolError::TemporarilyUnavailable(
            "Pool is emergency paused".to_string()
        ));
    }

    log!(INFO, "Starting vault scan and liquidation");

    // TODO: Get liquidatable vaults from protocol
    // TODO: Process liquidations in batches
    // TODO: Return results

    Ok(vec![])
}

/// Get list of liquidatable vaults from protocol
pub async fn get_liquidatable_vaults() -> Result<Vec<LiquidatableVault>, StabilityPoolError> {
    let protocol_canister_id = read_state(|s| s.protocol_canister_id);

    log!(INFO, "Calling protocol canister {} to get liquidatable vaults", protocol_canister_id);

    // Call the protocol's get_liquidatable_vaults endpoint
    let call_result: Result<(Vec<CandidVault>,), _> = call(
        protocol_canister_id,
        "get_liquidatable_vaults",
        ()
    ).await;

    match call_result {
        Ok((vaults,)) => {
            log!(INFO, "Successfully retrieved {} liquidatable vaults from protocol", vaults.len());

            // Convert CandidVault to LiquidatableVault format
            let liquidatable_vaults: Vec<LiquidatableVault> = vaults.into_iter().map(|vault| {
                // Calculate collateral ratio (simplified)
                let collateral_ratio = if vault.borrowed_icusd_amount > 0 {
                    let ratio = (vault.icp_margin_amount as f64) / (vault.borrowed_icusd_amount as f64);
                    format!("{:.4}", ratio)
                } else {
                    "∞".to_string()
                };

                // Calculate expected liquidation discount (10% of collateral value)
                let liquidation_discount = vault.icp_margin_amount / 10; // 10% discount

                LiquidatableVault {
                    vault_id: vault.vault_id,
                    owner: vault.owner,
                    debt_amount: vault.borrowed_icusd_amount,
                    collateral_amount: vault.icp_margin_amount,
                    collateral_ratio,
                    liquidation_discount,
                    priority_score: vault.borrowed_icusd_amount, // Higher debt = higher priority
                }
            }).collect();

            Ok(liquidatable_vaults)
        },
        Err(e) => {
            log!(INFO, "Failed to get liquidatable vaults from protocol: {:?}", e);
            Err(StabilityPoolError::TemporarilyUnavailable(
                format!("Failed to communicate with protocol canister: {:?}", e)
            ))
        }
    }
}

/// Set up automatic liquidation monitoring
pub fn setup_liquidation_monitoring() {
    let scan_interval = read_state(|s| s.configuration.liquidation_scan_interval);

    log!(INFO,
        "Setting up liquidation monitoring with {}s intervals", scan_interval);

    ic_cdk_timers::set_timer_interval(
        Duration::from_secs(scan_interval),
        || {
            ic_cdk::spawn(async {
                match scan_and_liquidate().await {
                    Ok(results) => {
                        if !results.is_empty() {
                            log!(INFO,
                                "Liquidation scan completed: {} vaults processed", results.len());
                        }
                    }
                    Err(error) => {
                        log!(INFO,
                            "Liquidation scan failed: {:?}", error);
                    }
                }
            })
        }
    );
}