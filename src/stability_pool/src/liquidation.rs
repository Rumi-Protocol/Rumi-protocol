use ic_cdk_timers;
use std::time::Duration;
use ic_canister_log::log;
use ic_cdk::call;

use crate::types::*;
use crate::state::read_state;
use crate::logs::INFO;

use rumi_protocol_backend::vault::CandidVault;


pub async fn execute_liquidation(vault_id: u64) -> Result<LiquidationResult, StabilityPoolError> {
    if read_state(|s| s.configuration.emergency_pause) {
        return Err(StabilityPoolError::TemporarilyUnavailable(
            "Pool is emergency paused".to_string()
        ));
    }

    log!(INFO,
        "Liquidation request for vault: {}", vault_id);

    let protocol_canister_id = read_state(|s| s.protocol_canister_id);

    let vault_info_result: Result<(Result<rumi_protocol_backend::VaultLiquidationInfo, String>,), _> = call(
        protocol_canister_id,
        "get_vault_for_liquidation",
        (vault_id,)
    ).await;

    let vault_info = match vault_info_result {
        Ok((Ok(info),)) => info,
        Ok((Err(error_msg),)) => {
            log!(INFO, "Vault {} not found or not liquidatable: {}", vault_id, error_msg);
            return Ok(LiquidationResult {
                vault_id,
                icusd_used: 0,
                icp_gained: 0,
                success: false,
                error_message: Some(error_msg),
                block_index: None,
            });
        },
        Err(call_error) => {
            let error_msg = format!("Failed to get vault info: {:?}", call_error);
            log!(INFO, "{}", error_msg);
            return Err(StabilityPoolError::InterCanisterCallFailed {
                target: "Protocol".to_string(),
                method: "get_vault_for_liquidation".to_string()
            });
        }
    };

    if !vault_info.is_liquidatable {
        let error_msg = format!(
            "Vault {} is not liquidatable. Current ratio: {:.2}%, required: {:.2}%",
            vault_id, vault_info.current_collateral_ratio * 100.0, vault_info.minimum_collateral_ratio * 100.0
        );
        log!(INFO, "{}", error_msg);
        return Ok(LiquidationResult {
            vault_id,
            icusd_used: 0,
            icp_gained: 0,
            success: false,
            error_message: Some(error_msg),
            block_index: None,
        });
    }

    let debt_amount = rumi_protocol_backend::numeric::ICUSD::from(vault_info.borrowed_icusd);
    let pool_has_funds = read_state(|s| s.has_sufficient_funds(debt_amount));

    if !pool_has_funds {
        let error_msg = format!("Insufficient pool balance to liquidate vault {}. Required: {} icUSD", vault_id, vault_info.borrowed_icusd);
        log!(INFO, "{}", error_msg);
        return Err(StabilityPoolError::InsufficientPoolBalance);
    }

    log!(INFO, "Executing liquidation for vault {}: debt={} icUSD, collateral={} ICP",
         vault_id, vault_info.borrowed_icusd, vault_info.icp_collateral);

    let liquidation_result: Result<(Result<rumi_protocol_backend::SuccessWithFee, rumi_protocol_backend::ProtocolError>,), _> = call(
        protocol_canister_id,
        "liquidate_vault",
        (vault_id,)
    ).await;

    match liquidation_result {
        Ok((Ok(success_result),)) => {
            let block_index = success_result.block_index;
            let fee_paid = success_result.fee_amount_paid;

            let collateral_gained = rumi_protocol_backend::numeric::ICP::from(vault_info.icp_collateral);
            let liquidation_discount = collateral_gained * rumi_protocol_backend::numeric::Ratio::from(rust_decimal_macros::dec!(0.1)); 

            log!(INFO, "Liquidation successful! Block: {}, Fee: {}, Collateral gained: {} ICP",
                 block_index, fee_paid, liquidation_discount.to_u64());

            crate::state::mutate_state(|s| {
                s.process_liquidation_gains(vault_id, debt_amount, liquidation_discount);
            });

            log!(INFO, "Liquidation gains distributed to {} depositors", read_state(|s| s.deposits.len()));

            Ok(LiquidationResult {
                vault_id,
                icusd_used: vault_info.borrowed_icusd,
                icp_gained: liquidation_discount.to_u64(),
                success: true,
                error_message: None,
                block_index: Some(block_index),
            })
        },
        Ok((Err(protocol_error),)) => {
            let error_msg = format!("Protocol liquidation failed: {:?}", protocol_error);
            log!(INFO, "{}", error_msg);
            Ok(LiquidationResult {
                vault_id,
                icusd_used: 0,
                icp_gained: 0,
                success: false,
                error_message: Some(error_msg),
                block_index: None,
            })
        },
        Err(call_error) => {
            let error_msg = format!("Inter-canister call failed: {:?}", call_error);
            log!(INFO, "{}", error_msg);
            Err(StabilityPoolError::InterCanisterCallFailed {
                target: "Protocol".to_string(),
                method: "liquidate_vault".to_string()
            })
        }
    }
}

pub async fn scan_and_liquidate() -> Result<Vec<LiquidationResult>, StabilityPoolError> {
    if read_state(|s| s.configuration.emergency_pause) {
        return Err(StabilityPoolError::TemporarilyUnavailable(
            "Pool is emergency paused".to_string()
        ));
    }

    log!(INFO, "Starting vault scan and liquidation");

    let liquidatable_vaults = match get_liquidatable_vaults().await {
        Ok(vaults) => vaults,
        Err(e) => {
            log!(INFO, "Failed to get liquidatable vaults: {:?}", e);
            return Err(e);
        }
    };

    if liquidatable_vaults.is_empty() {
        log!(INFO, "No liquidatable vaults found");
        return Ok(vec![]);
    }

    log!(INFO, "Found {} liquidatable vaults", liquidatable_vaults.len());

    let max_liquidations = read_state(|s| s.configuration.max_liquidations_per_batch);
    let vaults_to_process = liquidatable_vaults.into_iter()
        .take(max_liquidations as usize)
        .collect::<Vec<_>>();

    log!(INFO, "Processing {} vaults in this batch", vaults_to_process.len());

    let mut results = Vec::new();
    for vault in vaults_to_process {
        log!(INFO, "Processing vault {}: debt={} icUSD, priority={}",
             vault.vault_id, vault.debt_amount, vault.priority_score);

        match execute_liquidation(vault.vault_id).await {
            Ok(result) => {
                if result.success {
                    log!(INFO, "✅ Successfully liquidated vault {}: gained {} ICP",
                         vault.vault_id, result.icp_gained);
                } else {
                    log!(INFO, "⚠️ Liquidation attempt failed for vault {}: {}",
                         vault.vault_id, result.error_message.as_deref().unwrap_or("Unknown error"));
                }
                results.push(result);
            },
            Err(e) => {
                log!(INFO, "❌ Error liquidating vault {}: {:?}", vault.vault_id, e);
                results.push(LiquidationResult {
                    vault_id: vault.vault_id,
                    icusd_used: 0,
                    icp_gained: 0,
                    success: false,
                    error_message: Some(format!("System error: {:?}", e)),
                    block_index: None,
                });
            }
        }

        ic_cdk_timers::set_timer(std::time::Duration::from_millis(100), || {});
    }

    let successful_liquidations = results.iter().filter(|r| r.success).count();
    let total_icp_gained: u64 = results.iter().map(|r| r.icp_gained).sum();

    log!(INFO, "Scan completed: {}/{} successful liquidations, {} ICP gained total",
         successful_liquidations, results.len(), total_icp_gained);

    Ok(results)
}

pub async fn get_liquidatable_vaults() -> Result<Vec<LiquidatableVault>, StabilityPoolError> {
    let protocol_canister_id = read_state(|s| s.protocol_canister_id);

    log!(INFO, "Calling protocol canister {} to get liquidatable vaults", protocol_canister_id);

    let call_result: Result<(Vec<CandidVault>,), _> = call(
        protocol_canister_id,
        "get_liquidatable_vaults",
        ()
    ).await;

    match call_result {
        Ok((vaults,)) => {
            log!(INFO, "Successfully retrieved {} liquidatable vaults from protocol", vaults.len());

            let liquidatable_vaults: Vec<LiquidatableVault> = vaults.into_iter().map(|vault| {
                let collateral_ratio = if vault.borrowed_icusd_amount > 0 {
                    let ratio = (vault.icp_margin_amount as f64) / (vault.borrowed_icusd_amount as f64);
                    format!("{:.4}", ratio)
                } else {
                    "∞".to_string()
                };

                let liquidation_discount = vault.icp_margin_amount / 10; 

                LiquidatableVault {
                    vault_id: vault.vault_id,
                    owner: vault.owner,
                    debt_amount: vault.borrowed_icusd_amount,
                    collateral_amount: vault.icp_margin_amount,
                    collateral_ratio,
                    liquidation_discount,
                    priority_score: vault.borrowed_icusd_amount, 
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