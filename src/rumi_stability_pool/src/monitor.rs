use crate::types::*;
use ic_cdk::call;
use candid::Principal;

// Configuration for the stability pool monitor
pub struct StabilityPoolMonitor {
    pub protocol_backend_canister: Principal,
    pub enabled: bool,
    pub monitoring_interval_seconds: u64,
}

impl Default for StabilityPoolMonitor {
    fn default() -> Self {
        Self {
            protocol_backend_canister: Principal::anonymous(),
            enabled: false,
            monitoring_interval_seconds: 300, // 5 minutes
        }
    }
}

// Monitor for unhealthy vaults and execute liquidations
pub async fn monitor_and_liquidate() -> Result<u64, String> {
    let monitor_config = STATE.with(|state| {
        let state = state.borrow();
        StabilityPoolMonitor {
            protocol_backend_canister: state.protocol_owner, // Using protocol_owner as backend canister for now
            enabled: true,
            monitoring_interval_seconds: 300,
        }
    });

    if !monitor_config.enabled {
        return Ok(0);
    }

    // Get total pool size - only liquidate if we have sufficient funds
    let total_pool_icusd = crate::pool::get_total_pool_size();
    if total_pool_icusd < 1000_000_000 { // 1000 icUSD minimum
        return Ok(0);
    }

    // Get liquidatable vaults from protocol backend
    let liquidatable_vaults: Result<(Vec<LiquidatableVault>,), _> = call(
        monitor_config.protocol_backend_canister,
        "get_liquidatable_vaults",
        (),
    ).await;

    let vaults = match liquidatable_vaults {
        Ok((vaults,)) => vaults,
        Err(e) => {
            ic_cdk::print(&format!("Failed to get liquidatable vaults: {:?}", e));
            return Err("Failed to get liquidatable vaults".to_string());
        }
    };

    if vaults.is_empty() {
        return Ok(0);
    }

    let mut liquidated_count = 0;

    // Process each liquidatable vault
    for vault in vaults.iter().take(5) { // Process max 5 vaults per call
        // Calculate how much we can liquidate based on pool size
        let max_liquidatable = (total_pool_icusd as f64 * 0.5) as u64; // Use max 50% of pool per liquidation
        let debt_to_liquidate = vault.borrowed_icusd_amount.min(max_liquidatable);

        if debt_to_liquidate < 100_000_000 { // Skip if less than 100 icUSD
            continue;
        }

        // Call protocol backend to execute liquidation
        let liquidation_result: Result<(StabilityPoolLiquidationResult,), _> = call(
            monitor_config.protocol_backend_canister,
            "stability_pool_liquidate",
            (vault.vault_id, debt_to_liquidate),
        ).await;

        match liquidation_result {
            Ok((result,)) => {
                if result.success {
                    // Process the liquidation in our pool
                    let collateral_type = match result.collateral_type.as_str() {
                        "ICP" => CollateralType::ICP,
                        "CkBTC" => CollateralType::CkBTC,
                        _ => CollateralType::ICP, // Default
                    };

                    let success = crate::pool::process_liquidation(
                        result.vault_id,
                        result.liquidated_debt,
                        result.collateral_received,
                        collateral_type,
                    );

                    if success {
                        liquidated_count += 1;
                        ic_cdk::print(&format!(
                            "Successfully liquidated vault #{}: {} icUSD debt for {} collateral",
                            result.vault_id,
                            result.liquidated_debt,
                            result.collateral_received
                        ));
                    } else {
                        ic_cdk::print(&format!("Failed to process liquidation for vault #{}", result.vault_id));
                    }
                } else {
                    ic_cdk::print(&format!("Backend failed to liquidate vault #{}", vault.vault_id));
                }
            }
            Err(e) => {
                ic_cdk::print(&format!("Failed to call liquidation for vault #{}: {:?}", vault.vault_id, e));
            }
        }

        // Check if we still have enough pool funds for more liquidations
        let remaining_pool = crate::pool::get_total_pool_size();
        if remaining_pool < 500_000_000 { // Stop if pool drops below 500 icUSD
            break;
        }
    }

    Ok(liquidated_count)
}

// Start the monitoring timer
pub fn start_monitoring_timer() {
    let monitoring_interval = std::time::Duration::from_secs(300); // 5 minutes
    
    ic_cdk_timers::set_timer_interval(monitoring_interval, || {
        ic_cdk::spawn(async {
            match monitor_and_liquidate().await {
                Ok(count) => {
                    if count > 0 {
                        ic_cdk::print(&format!("Monitoring cycle completed: {} vaults liquidated", count));
                    }
                }
                Err(e) => {
                    ic_cdk::print(&format!("Monitoring cycle failed: {}", e));
                }
            }
        });
    });
}

// Types for communication with protocol backend
#[derive(candid::CandidType, serde::Deserialize, Clone, Debug)]
pub struct LiquidatableVault {
    pub vault_id: u64,
    pub owner: Principal,
    pub borrowed_icusd_amount: u64,
    pub icp_margin_amount: u64,
}

#[derive(candid::CandidType, serde::Deserialize, Clone, Debug)]
pub struct StabilityPoolLiquidationResult {
    pub success: bool,
    pub vault_id: u64,
    pub liquidated_debt: u64,
    pub collateral_received: u64,
    pub collateral_type: String,
    pub block_index: u64,
    pub fee: u64,
}