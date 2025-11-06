
use rumi_protocol_backend::numeric::{ICUSD, ICP};
use ic_canister_log::log;
use crate::logs::INFO;
use ic_cdk::call;
use icrc_ledger_types::icrc2::transfer_from::{TransferFromArgs, TransferFromError};
use icrc_ledger_types::icrc1::transfer::{TransferArg, TransferError};
use icrc_ledger_types::icrc1::account::Account;
use num_traits::ToPrimitive;

use crate::types::*;
use crate::state::read_state;

pub async fn deposit_icusd(amount: u64) -> Result<(), StabilityPoolError> {
    let caller = ic_cdk::api::caller();
    let deposit_amount = ICUSD::from(amount);

    if deposit_amount.to_u64() < crate::MIN_DEPOSIT_AMOUNT {
        return Err(StabilityPoolError::AmountTooLow {
            minimum_amount: crate::MIN_DEPOSIT_AMOUNT,
        });
    }

    if read_state(|s| s.configuration.emergency_pause) {
        return Err(StabilityPoolError::TemporarilyUnavailable(
            "Pool is emergency paused".to_string()
        ));
    }

    log!(INFO,
        "Deposit request: {} icUSD from {}", amount, caller);

    let icusd_ledger_id = read_state(|s| s.icusd_ledger_id);
    let stability_pool_account = Account {
        owner: ic_cdk::api::id(),
        subaccount: None,
    };
    let user_account = Account {
        owner: caller,
        subaccount: None,
    };

    let transfer_args = TransferFromArgs {
        from: user_account,
        to: stability_pool_account,
        amount: deposit_amount.to_u64().into(),
        fee: None, 
        memo: None,
        created_at_time: Some(ic_cdk::api::time()),
        spender_subaccount: None,
    };

    log!(INFO, "Calling ICRC-2 transfer_from on ledger {}", icusd_ledger_id);

    let transfer_result: Result<(Result<u64, TransferFromError>,), _> = call(
        icusd_ledger_id,
        "icrc2_transfer_from",
        (transfer_args,)
    ).await;

    match transfer_result {
        Ok((Ok(block_index),)) => {
            log!(INFO, "Successfully received {} icUSD from user, block: {}", amount, block_index);

            crate::state::mutate_state(|s| {
                s.add_deposit(caller, deposit_amount, ic_cdk::api::time());
            });

            log!(INFO, "Deposit completed successfully for user {}", caller);
            Ok(())
        },
        Ok((Err(transfer_error),)) => {
            log!(INFO, "ICRC-2 transfer failed: {:?}", transfer_error);
            match transfer_error {
                TransferFromError::BadFee { expected_fee } => {
                    Err(StabilityPoolError::LedgerTransferFailed {
                        reason: format!("Bad fee, expected: {}", expected_fee)
                    })
                },
                TransferFromError::InsufficientFunds { balance } => {
                    Err(StabilityPoolError::InsufficientDeposit {
                        required: amount,
                        available: balance.0.to_u64().unwrap_or(0)
                    })
                },
                TransferFromError::InsufficientAllowance { allowance } => {
                    Err(StabilityPoolError::LedgerTransferFailed {
                        reason: format!("Insufficient allowance: {}. Please approve the Stability Pool to spend your icUSD first.", allowance.0.to_u64().unwrap_or(0))
                    })
                },
                _ => {
                    Err(StabilityPoolError::LedgerTransferFailed {
                        reason: format!("Transfer failed: {:?}", transfer_error)
                    })
                }
            }
        },
        Err(call_error) => {
            log!(INFO, "Inter-canister call to ledger failed: {:?}", call_error);
            Err(StabilityPoolError::InterCanisterCallFailed {
                target: "icUSD Ledger".to_string(),
                method: "icrc2_transfer_from".to_string()
            })
        }
    }
}

pub async fn withdraw_icusd(amount: u64) -> Result<(), StabilityPoolError> {
    let caller = ic_cdk::api::caller();
    let withdraw_amount = ICUSD::from(amount);

    if read_state(|s| s.configuration.emergency_pause) {
        return Err(StabilityPoolError::TemporarilyUnavailable(
            "Pool is emergency paused".to_string()
        ));
    }

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

    let icusd_ledger_id = read_state(|s| s.icusd_ledger_id);
    let user_account = Account {
        owner: caller,
        subaccount: None,
    };

    let transfer_args = TransferArg {
        to: user_account,
        amount: withdraw_amount.to_u64().into(),
        fee: None, 
        memo: None,
        created_at_time: Some(ic_cdk::api::time()),
        from_subaccount: None,
    };

    log!(INFO, "Calling ICRC-1 transfer on ledger {}", icusd_ledger_id);

    let transfer_result: Result<(Result<u64, TransferError>,), _> = call(
        icusd_ledger_id,
        "icrc1_transfer",
        (transfer_args,)
    ).await;

    match transfer_result {
        Ok((Ok(block_index),)) => {
            log!(INFO, "Successfully sent {} icUSD to user, block: {}", amount, block_index);

            crate::state::mutate_state(|s| {
                match s.process_withdrawal(caller, withdraw_amount) {
                    Ok(()) => {
                        log!(INFO, "Withdrawal state updated successfully for user {}", caller);
                    },
                    Err(e) => {
                        log!(INFO, "Warning: State update failed after successful transfer: {:?}", e);
                    }
                }
            });

            log!(INFO, "Withdrawal completed successfully for user {}", caller);
            Ok(())
        },
        Ok((Err(transfer_error),)) => {
            log!(INFO, "ICRC-1 transfer failed: {:?}", transfer_error);
            match transfer_error {
                TransferError::BadFee { expected_fee } => {
                    Err(StabilityPoolError::LedgerTransferFailed {
                        reason: format!("Bad fee, expected: {}", expected_fee)
                    })
                },
                TransferError::InsufficientFunds { balance: _ } => {
                    Err(StabilityPoolError::InsufficientPoolBalance)
                },
                _ => {
                    Err(StabilityPoolError::LedgerTransferFailed {
                        reason: format!("Transfer failed: {:?}", transfer_error)
                    })
                }
            }
        },
        Err(call_error) => {
            log!(INFO, "Inter-canister call to ledger failed: {:?}", call_error);
            Err(StabilityPoolError::InterCanisterCallFailed {
                target: "icUSD Ledger".to_string(),
                method: "icrc1_transfer".to_string()
            })
        }
    }
}

pub async fn claim_collateral_gains() -> Result<u64, StabilityPoolError> {
    let caller = ic_cdk::api::caller();

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

    let icp_ledger_id = read_state(|s| s.icp_ledger_id);
    let user_account = Account {
        owner: caller,
        subaccount: None,
    };

    let transfer_args = TransferArg {
        to: user_account,
        amount: pending_gains.to_u64().into(),
        fee: None, 
        memo: None,
        created_at_time: Some(ic_cdk::api::time()),
        from_subaccount: None,
    };

    log!(INFO, "Calling ICRC-1 transfer on ICP ledger {}", icp_ledger_id);

    let transfer_result: Result<(Result<u64, TransferError>,), _> = call(
        icp_ledger_id,
        "icrc1_transfer",
        (transfer_args,)
    ).await;

    match transfer_result {
        Ok((Ok(block_index),)) => {
            let claimed_amount = pending_gains.to_u64();
            log!(INFO, "Successfully sent {} ICP to user, block: {}", claimed_amount, block_index);

            crate::state::mutate_state(|s| {
                s.mark_gains_claimed(caller, pending_gains);
            });

            log!(INFO, "ICP gains claimed successfully for user {}", caller);
            Ok(claimed_amount)
        },
        Ok((Err(transfer_error),)) => {
            log!(INFO, "ICRC-1 ICP transfer failed: {:?}", transfer_error);
            match transfer_error {
                TransferError::BadFee { expected_fee } => {
                    Err(StabilityPoolError::LedgerTransferFailed {
                        reason: format!("Bad fee, expected: {}", expected_fee)
                    })
                },
                TransferError::InsufficientFunds { balance: _ } => {
                    Err(StabilityPoolError::InsufficientPoolBalance)
                },
                _ => {
                    Err(StabilityPoolError::LedgerTransferFailed {
                        reason: format!("ICP transfer failed: {:?}", transfer_error)
                    })
                }
            }
        },
        Err(call_error) => {
            log!(INFO, "Inter-canister call to ICP ledger failed: {:?}", call_error);
            Err(StabilityPoolError::InterCanisterCallFailed {
                target: "ICP Ledger".to_string(),
                method: "icrc1_transfer".to_string()
            })
        }
    }
}