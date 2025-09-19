use crate::event::{
    record_add_margin_to_vault, record_borrow_from_vault, record_open_vault,
    record_redemption_on_vaults, record_repayed_to_vault,
};
use ic_cdk::update;
use crate::guard::GuardPrincipal;
use crate::GuardError;
use crate::logs::INFO;
use crate::management::{mint_icusd, transfer_icp_from, transfer_icusd_from};
use crate::numeric::{ICUSD, ICP};
use crate::{
    mutate_state, read_state, ProtocolError, SuccessWithFee, MIN_ICP_AMOUNT, MIN_ICUSD_AMOUNT,
    MIN_PARTIAL_REPAY_AMOUNT, MIN_PARTIAL_LIQUIDATION_AMOUNT, DUST_THRESHOLD,
};
use candid::{CandidType, Deserialize, Principal};
use ic_canister_log::log;
use icrc_ledger_types::icrc2::transfer_from::TransferFromError;
use serde::Serialize;
use crate::DEBUG;
use crate::management;
use crate::PendingMarginTransfer;
use rust_decimal_macros::dec;
use crate::Ratio;
use crate::compute_collateral_ratio;



#[derive(CandidType, Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct OpenVaultSuccess {
    pub vault_id: u64,
    pub block_index: u64,
}

#[derive(CandidType, Deserialize)]
pub struct VaultArg {
    pub vault_id: u64,
    pub amount: u64,
}

#[derive(CandidType, Clone, Debug, PartialEq, Eq, Deserialize, Serialize, PartialOrd, Ord)]
pub struct Vault {
    pub owner: Principal,
    pub borrowed_icusd_amount: ICUSD,
    pub icp_margin_amount: ICP,
    pub vault_id: u64,
}

#[derive(CandidType, Serialize, Deserialize, Debug)]
pub struct CandidVault {
    pub owner: Principal,
    pub borrowed_icusd_amount: u64,
    pub icp_margin_amount: u64,
    pub vault_id: u64,
}

impl From<Vault> for CandidVault {
    fn from(vault: Vault) -> Self {
        Self {
            owner: vault.owner,
            borrowed_icusd_amount: vault.borrowed_icusd_amount.to_u64(),
            icp_margin_amount: vault.icp_margin_amount.to_u64(),
            vault_id: vault.vault_id,
        }
    }
}

pub async fn redeem_icp(_icusd_amount: u64) -> Result<SuccessWithFee, ProtocolError> {
    let caller = ic_cdk::api::caller();
    let _guard_principal = GuardPrincipal::new(caller, "redeem_icp")?;

    let icusd_amount: ICUSD = _icusd_amount.into();

    if icusd_amount < MIN_ICUSD_AMOUNT {
        return Err(ProtocolError::AmountTooLow {
            minimum_amount: MIN_ICUSD_AMOUNT.to_u64(),
        });
    }

    let current_icp_rate = read_state(|s| s.last_icp_rate.expect("no ICP rate entry"));

    match transfer_icusd_from(icusd_amount, caller).await {
        Ok(block_index) => {
            let fee_amount = mutate_state(|s| {
                let base_fee = s.get_redemption_fee(icusd_amount);
                s.current_base_rate = base_fee;
                s.last_redemption_time = ic_cdk::api::time();
                let fee_amount = icusd_amount * base_fee;

                record_redemption_on_vaults(
                    s,
                    caller,
                    icusd_amount - fee_amount,
                    fee_amount,
                    current_icp_rate,
                    block_index,
                );
                fee_amount
            });
            ic_cdk_timers::set_timer(std::time::Duration::from_secs(0), || {
                ic_cdk::spawn(crate::process_pending_transfer())
            });
            Ok(SuccessWithFee {
                block_index,
                fee_amount_paid: fee_amount.to_u64(),
            })
        }
        Err(transfer_from_error) => Err(ProtocolError::TransferFromError(
            transfer_from_error,
            icusd_amount.to_u64(),
        )),
    }
}

pub async fn open_vault(icp_margin: u64) -> Result<OpenVaultSuccess, ProtocolError> {
    let caller = ic_cdk::api::caller();
    // Pass operation name to guard for better tracking
    let guard_principal = match GuardPrincipal::new(caller, "open_vault") {
        Ok(guard) => guard,
        Err(GuardError::AlreadyProcessing) => {
            log!(INFO, "[open_vault] Principal {:?} already has an ongoing operation", caller);
            return Err(ProtocolError::AlreadyProcessing);
        },
        Err(GuardError::StaleOperation) => {
            log!(INFO, "[open_vault] Principal {:?} has a stale operation that's being cleaned up", caller);
            return Err(ProtocolError::TemporarilyUnavailable(
                "Previous operation is being cleaned up. Please try again in a few seconds.".to_string()
            ));
        },
        Err(err) => return Err(err.into()),
    };

    let icp_margin_amount = icp_margin.into();

    if icp_margin_amount < MIN_ICP_AMOUNT {
        // Mark operation as failed since it didn't meet requirements
        guard_principal.fail();
        return Err(ProtocolError::AmountTooLow {
            minimum_amount: MIN_ICP_AMOUNT.to_u64(),
        });
    }

    match transfer_icp_from(icp_margin_amount, caller).await {
        Ok(block_index) => {
            let vault_id = mutate_state(|s| {
                let vault_id = s.increment_vault_id();
                record_open_vault(
                    s,
                    Vault {
                        owner: caller,
                        borrowed_icusd_amount: 0.into(),
                        icp_margin_amount,
                        vault_id,
                    },
                    block_index,
                );
                vault_id
            });
            log!(INFO, "[open_vault] opened vault with id: {vault_id}");
            
            // Mark operation as successfully completed
            guard_principal.complete();
            
            Ok(OpenVaultSuccess {
                vault_id,
                block_index,
            })
        }
        Err(transfer_from_error) => {
            // Explicitly mark as failed when an error occurs
            guard_principal.fail();
            
            if let TransferFromError::BadFee { expected_fee } = transfer_from_error.clone() {
                mutate_state(|s| {
                    let expected_fee: u64 = expected_fee
                        .0
                        .try_into()
                        .expect("failed to convert Nat to u64");
                    s.icp_ledger_fee = ICP::from(expected_fee);
                });
            };
            Err(ProtocolError::TransferFromError(
                transfer_from_error,
                icp_margin_amount.to_u64(),
            ))
        }
    }
}

pub async fn borrow_from_vault(arg: VaultArg) -> Result<SuccessWithFee, ProtocolError> {
    let caller = ic_cdk::api::caller();
    let guard_principal = match GuardPrincipal::new(caller, &format!("borrow_vault_{}", arg.vault_id)) {
        Ok(guard) => guard,
        Err(GuardError::AlreadyProcessing) => {
            log!(INFO, "[borrow_from_vault] Principal {:?} already has an ongoing operation", caller);
            return Err(ProtocolError::AlreadyProcessing);
        },
        Err(err) => return Err(err.into()),
    };
    
    let amount: ICUSD = arg.amount.into();

    if amount < MIN_ICUSD_AMOUNT {
        guard_principal.fail();
        return Err(ProtocolError::AmountTooLow {
            minimum_amount: MIN_ICUSD_AMOUNT.to_u64(),
        });
    }

    let (vault, icp_rate) = match read_state(|s| {
        match s.vault_id_to_vaults.get(&arg.vault_id) {
            Some(vault) => Ok((
                vault.clone(),
                s.last_icp_rate.expect("no icp rate"),
            )),
            None => {
                // Let's find if vault exists with a friendly error
                Err("Vault not found. Please check the vault ID.")
            }
        }
    }) {
        Ok(result) => result,
        Err(msg) => {
            guard_principal.fail();
            return Err(ProtocolError::GenericError(msg.to_string()));
        }
    };

    if caller != vault.owner {
        guard_principal.fail();
        return Err(ProtocolError::CallerNotOwner);
    }

    let max_borrowable_amount = vault.icp_margin_amount * icp_rate
        / read_state(|s| s.mode.get_minimum_liquidation_collateral_ratio());

    if vault.borrowed_icusd_amount + amount > max_borrowable_amount {
        guard_principal.fail();
        return Err(ProtocolError::GenericError(format!(
            "failed to borrow from vault, max borrowable: {max_borrowable_amount}, borrowed: {}, requested: {amount}",
            vault.borrowed_icusd_amount
        )));
    }

    let fee: ICUSD = read_state(|s| amount * s.get_borrowing_fee());

    match mint_icusd(amount - fee, caller).await {
        Ok(block_index) => {
            mutate_state(|s| {
                record_borrow_from_vault(s, arg.vault_id, amount, fee, block_index);
            });
            
            guard_principal.complete();
            
            Ok(SuccessWithFee {
                block_index,
                fee_amount_paid: fee.to_u64(),
            })
        }
        Err(mint_error) => {
            guard_principal.fail();
            Err(ProtocolError::TransferError(mint_error))
        }
    }
}

pub async fn repay_to_vault(arg: VaultArg) -> Result<u64, ProtocolError> {
    let caller = ic_cdk::api::caller();
    let guard_principal = GuardPrincipal::new(caller, &format!("repay_vault_{}", arg.vault_id))?;
    let amount: ICUSD = arg.amount.into();
    let vault = read_state(|s| s.vault_id_to_vaults.get(&arg.vault_id).cloned().unwrap());

    if caller != vault.owner {
        guard_principal.fail();
        return Err(ProtocolError::CallerNotOwner);
    }

    if amount < MIN_ICUSD_AMOUNT {
        guard_principal.fail();
        return Err(ProtocolError::AmountTooLow {
            minimum_amount: MIN_ICUSD_AMOUNT.to_u64(),
        });
    }

    if vault.borrowed_icusd_amount < amount {
        guard_principal.fail();
        return Err(ProtocolError::GenericError(format!(
            "cannot repay more than borrowed: {} ICUSD, repay: {} ICUSD",
            vault.borrowed_icusd_amount, amount
        )));
    }

    match transfer_icusd_from(amount, caller).await {
        Ok(block_index) => {
            mutate_state(|s| record_repayed_to_vault(s, arg.vault_id, amount, block_index));
            guard_principal.complete(); // Mark as completed
            Ok(block_index)
        }
        Err(transfer_from_error) => {
            guard_principal.fail(); // Mark as failed
            Err(ProtocolError::TransferFromError(
                transfer_from_error,
                amount.to_u64(),
            ))
        }
    }
}

pub async fn add_margin_to_vault(arg: VaultArg) -> Result<u64, ProtocolError> {
    let caller = ic_cdk::api::caller();
    let _guard_principal = GuardPrincipal::new(caller, &format!("add_margin_vault_{}", arg.vault_id))?;
    let amount: ICP = arg.amount.into();

    if amount < MIN_ICP_AMOUNT {
        return Err(ProtocolError::AmountTooLow {
            minimum_amount: MIN_ICP_AMOUNT.to_u64(),
        });
    }

    let vault = read_state(|s| s.vault_id_to_vaults.get(&arg.vault_id).cloned().unwrap());
    if caller != vault.owner {
        return Err(ProtocolError::CallerNotOwner);
    }

    match transfer_icp_from(amount, caller).await {
        Ok(block_index) => {
            mutate_state(|s| record_add_margin_to_vault(s, arg.vault_id, amount, block_index));
            Ok(block_index)
        }
        Err(error) => {
            if let TransferFromError::BadFee { expected_fee } = error.clone() {
                mutate_state(|s| {
                    let expected_fee: u64 = expected_fee
                        .0
                        .try_into()
                        .expect("failed to convert Nat to u64");
                    s.icp_ledger_fee = ICP::from(expected_fee);
                });
            };
            Err(ProtocolError::TransferFromError(error, amount.to_u64()))
        }
    }
}

pub async fn close_vault(vault_id: u64) -> Result<Option<u64>, ProtocolError> {
    let caller = ic_cdk::caller();
    let _guard_principal = GuardPrincipal::new(caller, &format!("close_vault_{}", vault_id))?;
    
    // Check rate limits first
    mutate_state(|s| s.check_close_vault_rate_limit(caller))?;
    
    // Record the close request for rate limiting
    mutate_state(|s| s.record_close_vault_request(caller));
    
    // Check if the vault exists first
    let vault_exists = read_state(|s| s.vault_id_to_vaults.contains_key(&vault_id));
    
    if !vault_exists {
        mutate_state(|s| s.complete_close_vault_request());
        log!(
            INFO,
            "[close_vault] Vault #{} not found for principal {}",
            vault_id,
            caller
        );
        return Err(ProtocolError::GenericError(format!("Vault #{} not found", vault_id)));
    }
    
    // Get the vault
    let vault = read_state(|s| {
        s.vault_id_to_vaults
            .get(&vault_id)
            .cloned()
            .ok_or(ProtocolError::GenericError("Vault not found".to_string()))
    })?;

    // Verify caller is the owner
    if caller != vault.owner {
        mutate_state(|s| s.complete_close_vault_request());
        log!(
            INFO,
            "[close_vault] Principal {} is not the owner of vault #{}",
            caller,
            vault_id
        );
        return Err(ProtocolError::CallerNotOwner);
    }

    // Handle dust amounts - if debt is very small, forgive it
    if vault.borrowed_icusd_amount <= DUST_THRESHOLD {
        log!(
            INFO,
            "[close_vault] Forgiving dust debt of {} icUSD for vault #{}",
            vault.borrowed_icusd_amount,
            vault_id
        );
        
        // Record dust forgiveness
        mutate_state(|s| {
            s.dust_forgiven_total += vault.borrowed_icusd_amount;
            s.repay_to_vault(vault_id, vault.borrowed_icusd_amount);
        });
        
        // Record dust forgiveness event
        crate::storage::record_event(&crate::event::Event::DustForgiven {
            vault_id,
            amount: vault.borrowed_icusd_amount,
        });
    } else if vault.borrowed_icusd_amount > ICUSD::new(0) {
        mutate_state(|s| s.complete_close_vault_request());
        log!(
            INFO,
            "[close_vault] Cannot close vault #{} with outstanding debt: {}",
            vault_id,
            vault.borrowed_icusd_amount
        );
        return Err(ProtocolError::GenericError(
            "Cannot close vault with outstanding debt. Repay all debt first.".to_string()
        ));
    }

    // Verify there's no remaining collateral
    if vault.icp_margin_amount > ICP::new(0) {
        mutate_state(|s| s.complete_close_vault_request());
        log!(
            INFO,
            "[close_vault] Cannot close vault #{} with remaining collateral: {}",
            vault_id,
            vault.icp_margin_amount
        );
        return Err(ProtocolError::GenericError(
            "Cannot close vault with remaining collateral. Withdraw collateral first.".to_string()
        ));
    }

    // Simply close the vault - no transfers needed
    mutate_state(|s| {
        // Make sure vault exists before attempting to remove
        if s.vault_id_to_vaults.contains_key(&vault_id) {
            // Remove from vault_id_to_vaults map
            s.vault_id_to_vaults.remove(&vault_id);
            
            // Remove from principal_to_vault_ids map
            if let Some(vault_ids) = s.principal_to_vault_ids.get_mut(&vault.owner) {
                vault_ids.remove(&vault_id);
                // If this was the user's last vault, remove the principal entry
                if vault_ids.is_empty() {
                    s.principal_to_vault_ids.remove(&vault.owner);
                }
            }
            
            // Record the close vault event
            crate::event::record_close_vault(s, vault_id, None);
            
            // Complete the close request
            s.complete_close_vault_request();
            
            log!(
                INFO,
                "[close_vault] Successfully closed vault #{} for principal {}",
                vault_id,
                caller
            );
        } else {
            // Log that we tried to close a vault that was already gone
            log!(
                INFO,
                "[close_vault] Attempted to close vault #{} that was already removed",
                vault_id
            );
            s.complete_close_vault_request();
        }
    });
    
    // Return success with no block index (since no transfer was made)
    Ok(None)
}

pub async fn withdraw_collateral(vault_id: u64) -> Result<u64, ProtocolError> {
    let caller = ic_cdk::caller();
    let _guard_principal = GuardPrincipal::new(caller, &format!("withdraw_collateral_{}", vault_id))?;
    
    log!(
        INFO,
        "[withdraw_collateral] Request to withdraw collateral from vault #{} by principal {}",
        vault_id,
        caller
    );
    
    // Check vault exists and caller is owner
    let vault = read_state(|state| {
        state.vault_id_to_vaults
            .get(&vault_id)
            .cloned()
            .ok_or(ProtocolError::GenericError("Vault not found".to_string()))
    })?;
    
    if caller != vault.owner {
        log!(
            INFO,
            "[withdraw_collateral] Caller {} is not the owner of vault #{}",
            caller,
            vault_id
        );
        return Err(ProtocolError::CallerNotOwner);
    }
    
    // Check there's no debt
    if vault.borrowed_icusd_amount > ICUSD::new(0) {
        log!(
            INFO,
            "[withdraw_collateral] Vault #{} has outstanding debt of {} icUSD",
            vault_id,
            vault.borrowed_icusd_amount
        );
        return Err(ProtocolError::GenericError(format!(
            "Vault has {} icUSD debt. You must repay all debt before withdrawing collateral.",
            vault.borrowed_icusd_amount
        )));
    }
    
    // Check there's collateral to withdraw
    if vault.icp_margin_amount == ICP::new(0) {
        log!(
            INFO,
            "[withdraw_collateral] Vault #{} has no collateral to withdraw",
            vault_id
        );
        return Err(ProtocolError::GenericError("No collateral to withdraw".to_string()));
    }
    
    // Get the amount to transfer
    let amount_to_transfer = vault.icp_margin_amount;
    log!(
        INFO,
        "[withdraw_collateral] Withdrawing {} ICP from vault #{}",
        amount_to_transfer,
        vault_id
    );
    
    // Set margin to zero in vault BEFORE transferring to avoid reentrancy issues
    mutate_state(|state| {
        if let Some(vault) = state.vault_id_to_vaults.get_mut(&vault_id) {
            vault.icp_margin_amount = ICP::new(0);
        }
    });
    
    // Make the ICP transfer with appropriate fee deduction
    let ledger_fee = read_state(|s| s.icp_ledger_fee);
    let transfer_amount = amount_to_transfer - ledger_fee;
    
    log!(
        INFO,
        "[withdraw_collateral] Transferring {} ICP (after fee deduction) to {}",
        transfer_amount,
        caller
    );
    
    match management::transfer_icp(transfer_amount, caller).await {
        Ok(block_index) => {
            // Fix for the lifetime issue - we need to use a separate mutate_state call
            // Rather than passing a mutable reference to the state
            mutate_state(|s| crate::event::record_collateral_withdrawn(s, vault_id, amount_to_transfer, block_index));
            
            log!(
                INFO,
                "[withdraw_collateral] Successfully withdrew {} ICP from vault #{}, transfer block_index: {}",
                amount_to_transfer,
                vault_id,
                block_index
            );
            
            Ok(block_index)
        },
        Err(error) => {
            // If the transfer fails, we need to restore the collateral in the vault
            mutate_state(|state| {
                if let Some(vault) = state.vault_id_to_vaults.get_mut(&vault_id) {
                    vault.icp_margin_amount = amount_to_transfer;
                }
            });
            
            log!(
                DEBUG,
                "[withdraw_collateral] Failed to transfer {} ICP to {}, error: {}",
                transfer_amount,
                caller,
                error
            );
            
            Err(ProtocolError::TransferError(error))
        }
    }
}

pub async fn withdraw_and_close_vault(vault_id: u64) -> Result<Option<u64>, ProtocolError> {
    let caller = ic_cdk::caller();
    // Use a specific name for better tracking
    let _guard_principal = GuardPrincipal::new(caller, &format!("withdraw_and_close_{}", vault_id))?;
    
    log!(
        INFO,
        "[withdraw_and_close] Request for vault #{} by principal {}",
        vault_id,
        caller
    );
    
    // Check if the vault exists first
    let vault = read_state(|s| {
        s.vault_id_to_vaults
            .get(&vault_id)
            .cloned()
            .ok_or(ProtocolError::GenericError(format!("Vault #{} not found", vault_id)))
    })?;
    
    // Verify caller is the owner
    if caller != vault.owner {
        log!(
            INFO,
            "[withdraw_and_close] Principal {} is not the owner of vault #{}",
            caller,
            vault_id
        );
        return Err(ProtocolError::CallerNotOwner);
    }
    
    // Check there's no debt
    if vault.borrowed_icusd_amount > ICUSD::new(0) {
        log!(
            INFO,
            "[withdraw_and_close] Vault #{} has outstanding debt of {} icUSD",
            vault_id,
            vault.borrowed_icusd_amount
        );
        return Err(ProtocolError::GenericError(format!(
            "Vault has {} icUSD debt. You must repay all debt before withdrawing and closing.",
            vault.borrowed_icusd_amount
        )));
    }
    
    // If there's collateral, withdraw it first
    let mut block_index: Option<u64> = None;
    let amount_to_transfer = vault.icp_margin_amount; // Get the amount even if zero
    
    if amount_to_transfer > ICP::new(0) {
        log!(
            INFO,
            "[withdraw_and_close] Withdrawing {} ICP from vault #{}",
            amount_to_transfer,
            vault_id
        );
        
        // Set margin to zero in vault BEFORE transferring to avoid reentrancy issues
        mutate_state(|state| {
            if let Some(vault) = state.vault_id_to_vaults.get_mut(&vault_id) {
                vault.icp_margin_amount = ICP::new(0);
            }
        });
        
        // Make the ICP transfer with appropriate fee deduction
        let ledger_fee = read_state(|s| s.icp_ledger_fee);
        let transfer_amount = amount_to_transfer - ledger_fee;
        
        log!(
            INFO,
            "[withdraw_and_close] Transferring {} ICP (after fee deduction) to {}",
            transfer_amount,
            caller
        );
        
        match management::transfer_icp(transfer_amount, caller).await {
            Ok(idx) => {
                // Record the withdrawal event
                mutate_state(|s| crate::event::record_collateral_withdrawn(s, vault_id, amount_to_transfer, idx));
                
                log!(
                    INFO,
                    "[withdraw_and_close] Successfully withdrew {} ICP from vault #{}, block_index: {}",
                    amount_to_transfer,
                    vault_id,
                    idx
                );
                
                block_index = Some(idx);
            },
            Err(error) => {
                // CRITICAL: If the transfer fails, restore the collateral and exit WITHOUT closing the vault
                mutate_state(|state| {
                    if let Some(vault) = state.vault_id_to_vaults.get_mut(&vault_id) {
                        vault.icp_margin_amount = amount_to_transfer;
                    }
                });
                
                log!(
                    DEBUG,
                    "[withdraw_and_close] Failed to transfer {} ICP to {}, error: {}",
                    transfer_amount,
                    caller,
                    error
                );
                
                return Err(ProtocolError::TransferError(error));
            }
        }
    } else {
        log!(INFO, "[withdraw_and_close] Vault #{} has no collateral to withdraw", vault_id);
    };
    
    // Now close the vault - only if we've successfully transferred any funds
    // or if there were no funds to transfer
    mutate_state(|s| {
        // Make sure vault exists before attempting to remove
        if s.vault_id_to_vaults.contains_key(&vault_id) {
            // Record the combined withdraw and close event
            crate::event::record_withdraw_and_close_vault(s, vault_id, amount_to_transfer, block_index);
            
            log!(
                INFO,
                "[withdraw_and_close] Successfully closed vault #{} for principal {}",
                vault_id,
                caller
            );
        } else {
            // Log that we tried to close a vault that was already gone
            log!(
                INFO,
                "[withdraw_and_close] Attempted to close vault #{} that was already removed",
                vault_id
            );
        }
    });
    
    // Return the block index if we did a transfer, otherwise None
    Ok(block_index)
}

pub async fn liquidate_vault(vault_id: u64) -> Result<SuccessWithFee, ProtocolError> {
    let caller = ic_cdk::api::caller();
    let guard_principal = GuardPrincipal::new(caller, &format!("liquidate_vault_{}", vault_id))?;
    
    // Step 1: Validate vault is liquidatable
    let (vault, icp_rate, mode) = match read_state(|s| {
        match s.vault_id_to_vaults.get(&vault_id) {
            Some(vault) => {
                let icp_rate = s.last_icp_rate.expect("no icp rate");
                let ratio = compute_collateral_ratio(vault, icp_rate);
                
                if ratio >= s.mode.get_minimum_liquidation_collateral_ratio() {
                    Err(format!(
                        "Vault #{} is not liquidatable. Current ratio: {}, minimum: {}",
                        vault_id, 
                        ratio.to_f64(), 
                        s.mode.get_minimum_liquidation_collateral_ratio().to_f64()
                    ))
                } else {
                    Ok((vault.clone(), icp_rate, s.mode))
                }
            },
            None => Err(format!("Vault #{} not found", vault_id)),
        }
    }) {
        Ok(result) => result,
        Err(msg) => {
            guard_principal.fail();
            return Err(ProtocolError::GenericError(msg));
        }
    };

    // Step 2: Calculate liquidation amounts
    let debt_amount = vault.borrowed_icusd_amount;
    let icp_equivalent = debt_amount / icp_rate;
    let liquidation_bonus = Ratio::new(dec!(1.1)); // 110% (10% bonus)
    let icp_with_bonus = icp_equivalent * liquidation_bonus;
    let icp_to_liquidator = icp_with_bonus.min(vault.icp_margin_amount);
    let excess_collateral = vault.icp_margin_amount.saturating_sub(icp_to_liquidator);
    
    log!(INFO, 
        "[liquidate_vault] Vault #{}: debt={} icUSD, liquidator gets {} ICP, excess={} ICP",
        vault_id, 
        debt_amount.to_u64(),
        icp_to_liquidator.to_u64(),
        excess_collateral.to_u64()
    );
    
    // Step 3: Take icUSD from liquidator (this must succeed for liquidation to proceed)
    let icusd_block_index = match transfer_icusd_from(debt_amount, caller).await {
        Ok(block_index) => {
            log!(INFO, "[liquidate_vault] Received {} icUSD from liquidator", debt_amount.to_u64());
            block_index
        },
        Err(transfer_from_error) => {
            guard_principal.fail();
            return Err(ProtocolError::TransferFromError(transfer_from_error, debt_amount.to_u64()));
        }
    };
    
    // Step 4: Update protocol state ATOMICALLY (this is the critical section)
    mutate_state(|s| {
        // Execute the liquidation in state first (this must happen)
        s.liquidate_vault(vault_id, mode, icp_rate);
        
        // Record the liquidation event
        let event = crate::event::Event::LiquidateVault {
            vault_id,
            mode,
            icp_rate,
            liquidator: Some(caller),
        };
        crate::storage::record_event(&event);
        
        // Create pending transfer for liquidator reward
        s.pending_margin_transfers.insert(
            vault_id, 
            PendingMarginTransfer {
                owner: caller,
                margin: icp_to_liquidator,
            },
        );
        
        // Create pending transfer for excess collateral to vault owner (if any)
        if excess_collateral > ICP::new(0) {
            log!(INFO, "[liquidate_vault] Scheduling excess collateral return to vault owner");
            s.pending_margin_transfers.insert(
                vault_id + 1_000_000, // Different ID to avoid collision
                PendingMarginTransfer {
                    owner: vault.owner,
                    margin: excess_collateral,
                },
            );
        }
        
        log!(INFO, "[liquidate_vault] Protocol state updated, {} pending transfers created", 
             if excess_collateral > ICP::new(0) { 2 } else { 1 });
    });
    
    // Step 5: Attempt immediate transfer processing (best effort)
    log!(INFO, "[liquidate_vault] Attempting immediate transfer processing...");
    
    // Try to process transfers immediately
    match try_process_pending_transfers_immediate(vault_id).await {
        Ok(processed_count) => {
            log!(INFO, "[liquidate_vault] Successfully processed {} transfers immediately", processed_count);
        },
        Err(e) => {
            log!(INFO, "[liquidate_vault] Immediate processing failed: {}. Transfers will be retried via timer", e);
            
            // Schedule retry with exponential backoff
            schedule_transfer_retry(vault_id, 0);
        }
    }
    
    // Step 6: Always schedule a backup timer (in case immediate processing failed)
    ic_cdk_timers::set_timer(std::time::Duration::from_secs(2), move || {
        ic_cdk::spawn(async move {
            log!(INFO, "[liquidate_vault] Backup timer processing transfers for vault #{}", vault_id);
            let _ = crate::process_pending_transfer().await;
        })
    });
    
    // Step 7: Liquidation is successful (protocol state is consistent)
    guard_principal.complete();
    
    // Calculate fee
    let liquidator_value_received = icp_to_liquidator * icp_rate;
    let fee_amount = if liquidator_value_received > debt_amount {
        liquidator_value_received - debt_amount
    } else {
        ICUSD::new(0)
    };
    
    log!(INFO, "[liquidate_vault] Liquidation completed successfully. Block index: {}, Fee: {}", 
         icusd_block_index, fee_amount.to_u64());
    
    Ok(SuccessWithFee {
        block_index: icusd_block_index,
        fee_amount_paid: fee_amount.to_u64(),
    })
}

// Helper function to attempt immediate transfer processing
async fn try_process_pending_transfers_immediate(vault_id: u64) -> Result<u32, String> {
    let mut processed_count = 0;
    let ledger_fee = read_state(|s| s.icp_ledger_fee);
    
    // Get pending transfers for this liquidation
    let transfers_to_process = read_state(|s| {
        let mut transfers = Vec::new();
        
        // Primary transfer (liquidator reward)
        if let Some(transfer) = s.pending_margin_transfers.get(&vault_id) {
            transfers.push((vault_id, transfer.clone()));
        }
        
        // Excess collateral transfer (if exists)
        if let Some(transfer) = s.pending_margin_transfers.get(&(vault_id + 1_000_000)) {
            transfers.push((vault_id + 1_000_000, transfer.clone()));
        }
        
        transfers
    });
    
    // Process each transfer
    for (transfer_id, transfer) in transfers_to_process {
        let transfer_amount = transfer.margin - ledger_fee;
        
        if transfer_amount <= ICP::new(0) {
            log!(INFO, "[immediate_transfer] Skipping transfer {} - amount too small after fee", transfer_id);
            continue;
        }
        
        log!(INFO, "[immediate_transfer] Processing transfer {} of {} ICP to {}", 
             transfer_id, transfer_amount.to_u64(), transfer.owner);
        
        match management::transfer_icp(transfer_amount, transfer.owner).await {
            Ok(block_index) => {
                log!(INFO, "[immediate_transfer] Transfer {} successful, block: {}", transfer_id, block_index);
                
                // Remove from pending transfers
                mutate_state(|s| {
                    s.pending_margin_transfers.remove(&transfer_id);
                });
                
                processed_count += 1;
            },
            Err(error) => {
                log!(INFO, "[immediate_transfer] Transfer {} failed: {}. Will retry later", transfer_id, error);
                // Leave in pending transfers for retry
                return Err(format!("Transfer {} failed: {}", transfer_id, error));
            }
        }
    }
    
    Ok(processed_count)
}

// Helper function to schedule transfer retries with exponential backoff
fn schedule_transfer_retry(vault_id: u64, retry_count: u32) {
    let max_retries = 5;
    if retry_count >= max_retries {
        log!(INFO, "[retry_scheduler] Max retries reached for vault #{}", vault_id);
        return;
    }
    
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    let delay_seconds = 1u64 << retry_count;
    
    log!(INFO, "[retry_scheduler] Scheduling retry #{} for vault #{} in {}s", 
         retry_count + 1, vault_id, delay_seconds);
    
    ic_cdk_timers::set_timer(std::time::Duration::from_secs(delay_seconds), move || {
        ic_cdk::spawn(async move {
            log!(INFO, "[retry_scheduler] Retry #{} executing for vault #{}", retry_count + 1, vault_id);
            
            match try_process_pending_transfers_immediate(vault_id).await {
                Ok(processed) => {
                    log!(INFO, "[retry_scheduler] Retry #{} successful, processed {} transfers", retry_count + 1, processed);
                },
                Err(_) => {
                    log!(INFO, "[retry_scheduler] Retry #{} failed, scheduling next retry", retry_count + 1);
                    schedule_transfer_retry(vault_id, retry_count + 1);
                }
            }
        })
    });
}

#[update]
pub async fn partial_repay_to_vault(arg: VaultArg) -> Result<u64, ProtocolError> {
    let caller = ic_cdk::api::caller();
    let guard_principal = GuardPrincipal::new(caller, &format!("partial_repay_vault_{}", arg.vault_id))?;
    let amount: ICUSD = arg.amount.into();
    let vault = read_state(|s| s.vault_id_to_vaults.get(&arg.vault_id).cloned().unwrap());

    if caller != vault.owner {
        guard_principal.fail();
        return Err(ProtocolError::CallerNotOwner);
    }

    if amount < MIN_PARTIAL_REPAY_AMOUNT {
        guard_principal.fail();
        return Err(ProtocolError::AmountTooLow {
            minimum_amount: MIN_PARTIAL_REPAY_AMOUNT.to_u64(),
        });
    }

    if vault.borrowed_icusd_amount < amount {
        guard_principal.fail();
        return Err(ProtocolError::GenericError(format!(
            "cannot repay more than borrowed: {} ICUSD, repay: {} ICUSD",
            vault.borrowed_icusd_amount, amount
        )));
    }

    match transfer_icusd_from(amount, caller).await {
        Ok(block_index) => {
            mutate_state(|s| record_repayed_to_vault(s, arg.vault_id, amount, block_index));
            guard_principal.complete(); // Mark as completed
            Ok(block_index)
        }
        Err(transfer_from_error) => {
            guard_principal.fail(); // Mark as failed
            Err(ProtocolError::TransferFromError(
                transfer_from_error,
                amount.to_u64(),
            ))
        }
    }
}

#[update]
pub async fn partial_liquidate_vault(arg: VaultArg) -> Result<SuccessWithFee, ProtocolError> {
    let caller = ic_cdk::api::caller();
    let guard_principal = GuardPrincipal::new(caller, &format!("partial_liquidate_vault_{}", arg.vault_id))?;
    let liquidator_payment: ICUSD = arg.amount.into();
    
    // Step 1: Validate vault is liquidatable
    let (vault, icp_rate, mode) = match read_state(|s| {
        match s.vault_id_to_vaults.get(&arg.vault_id) {
            Some(vault) => {
                let icp_rate = s.last_icp_rate.expect("no icp rate");
                let ratio = compute_collateral_ratio(vault, icp_rate);
                
                if ratio >= s.mode.get_minimum_liquidation_collateral_ratio() {
                    Err(format!(
                        "Vault #{} is not liquidatable. Current ratio: {}, minimum: {}",
                        arg.vault_id, 
                        ratio.to_f64(), 
                        s.mode.get_minimum_liquidation_collateral_ratio().to_f64()
                    ))
                } else {
                    Ok((vault.clone(), icp_rate, s.mode))
                }
            },
            None => Err(format!("Vault #{} not found", arg.vault_id)),
        }
    }) {
        Ok(result) => result,
        Err(msg) => {
            guard_principal.fail();
            return Err(ProtocolError::GenericError(msg));
        }
    };

    // Step 2: Validate liquidator payment amount
    if liquidator_payment < MIN_PARTIAL_LIQUIDATION_AMOUNT {
        guard_principal.fail();
        return Err(ProtocolError::AmountTooLow {
            minimum_amount: MIN_PARTIAL_LIQUIDATION_AMOUNT.to_u64(),
        });
    }

    if liquidator_payment > vault.borrowed_icusd_amount {
        guard_principal.fail();
        return Err(ProtocolError::GenericError(format!(
            "cannot liquidate more than borrowed: {} ICUSD, liquidate: {} ICUSD",
            vault.borrowed_icusd_amount, liquidator_payment
        )));
    }

    // Step 3: Calculate liquidation amounts with 10% discount
    // Liquidator pays X icUSD, gets X/0.9 worth of ICP (10% discount)
    let liquidation_bonus = Ratio::new(dec!(1.111111111)); // 1/0.9 = 1.111... (10% discount)
    let icp_value_owed = liquidator_payment * liquidation_bonus;
    let icp_to_liquidator = icp_value_owed / icp_rate;
    
    // Ensure we don't give more collateral than available
    let actual_icp_to_liquidator = icp_to_liquidator.min(vault.icp_margin_amount);
    
    log!(INFO, 
        "[partial_liquidate_vault] Vault #{}: liquidator pays {} icUSD, gets {} ICP (10% discount)",
        arg.vault_id, 
        liquidator_payment.to_u64(),
        actual_icp_to_liquidator.to_u64()
    );
    
    // Step 4: Take icUSD from liquidator
    let icusd_block_index = match transfer_icusd_from(liquidator_payment, caller).await {
        Ok(block_index) => {
            log!(INFO, "[partial_liquidate_vault] Received {} icUSD from liquidator", liquidator_payment.to_u64());
            block_index
        },
        Err(transfer_from_error) => {
            guard_principal.fail();
            return Err(ProtocolError::TransferFromError(transfer_from_error, liquidator_payment.to_u64()));
        }
    };
    
    // Step 5: Update protocol state ATOMICALLY
    mutate_state(|s| {
        // Reduce the vault's debt by the liquidator payment amount
        if let Some(vault) = s.vault_id_to_vaults.get_mut(&arg.vault_id) {
            vault.borrowed_icusd_amount -= liquidator_payment;
            vault.icp_margin_amount -= actual_icp_to_liquidator;
        }
        
        // Record the partial liquidation event
        let event = crate::event::Event::PartialLiquidateVault {
            vault_id: arg.vault_id,
            liquidator_payment,
            icp_to_liquidator: actual_icp_to_liquidator,
            liquidator: caller,
        };
        crate::storage::record_event(&event);
        
        // Create pending transfer for liquidator reward
        s.pending_margin_transfers.insert(
            arg.vault_id, 
            PendingMarginTransfer {
                owner: caller,
                margin: actual_icp_to_liquidator,
            },
        );
        
        log!(INFO, "[partial_liquidate_vault] Protocol state updated, pending transfer created");
    });
    
    // Step 6: Attempt immediate transfer processing
    log!(INFO, "[partial_liquidate_vault] Attempting immediate transfer processing...");
    
    match try_process_pending_transfers_immediate(arg.vault_id).await {
        Ok(processed_count) => {
            log!(INFO, "[partial_liquidate_vault] Successfully processed {} transfers immediately", processed_count);
        },
        Err(e) => {
            log!(INFO, "[partial_liquidate_vault] Immediate processing failed: {}. Transfers will be retried via timer", e);
            schedule_transfer_retry(arg.vault_id, 0);
        }
    }
    
    // Step 7: Schedule backup timer
    ic_cdk_timers::set_timer(std::time::Duration::from_secs(2), move || {
        ic_cdk::spawn(async move {
            log!(INFO, "[partial_liquidate_vault] Backup timer processing transfers for vault #{}", arg.vault_id);
            let _ = crate::process_pending_transfer().await;
        })
    });
    
    // Step 8: Liquidation is successful
    guard_principal.complete();
    
    // Calculate fee (the 10% discount is the fee)
    let liquidator_value_received = actual_icp_to_liquidator * icp_rate;
    let fee_amount = if liquidator_value_received > liquidator_payment {
        liquidator_value_received - liquidator_payment
    } else {
        ICUSD::new(0)
    };
    
    log!(INFO, "[partial_liquidate_vault] Partial liquidation completed successfully. Block index: {}, Fee: {}", 
         icusd_block_index, fee_amount.to_u64());
    
    Ok(SuccessWithFee {
        block_index: icusd_block_index,
        fee_amount_paid: fee_amount.to_u64(),
    })
}