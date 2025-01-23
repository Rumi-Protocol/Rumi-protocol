use crate::event::{
    record_add_margin_to_vault, record_borrow_from_vault, record_open_vault,
    record_redemption_on_vaults, record_repayed_to_vault,
};
use crate::guard::GuardPrincipal;
use crate::logs::INFO;
use crate::management::{mint_icusd, transfer_icp_from, transfer_icusd_from};
use crate::numeric::{ICUSD, ICP};
use crate::{
    mutate_state, read_state, ProtocolError, SuccessWithFee, MIN_ICP_AMOUNT, MIN_ICUSD_AMOUNT,
};
use candid::{CandidType, Deserialize, Principal};
use ic_canister_log::log;
use icrc_ledger_types::icrc2::transfer_from::TransferFromError;
use serde::Serialize;

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
    let _guard_principal = GuardPrincipal::new(caller)?;

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
    let _guard_principal = GuardPrincipal::new(caller)?;

    let icp_margin_amount = icp_margin.into();

    if icp_margin_amount < MIN_ICP_AMOUNT {
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
            Ok(OpenVaultSuccess {
                vault_id,
                block_index,
            })
        }
        Err(transfer_from_error) => {
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
    let _guard_principal = GuardPrincipal::new(caller)?;
    let amount: ICUSD = arg.amount.into();

    if amount < MIN_ICUSD_AMOUNT {
        return Err(ProtocolError::AmountTooLow {
            minimum_amount: MIN_ICUSD_AMOUNT.to_u64(),
        });
    }

    let (vault, icp_rate) = read_state(|s| {
        (
            s.vault_id_to_vaults.get(&arg.vault_id).cloned().unwrap(),
            s.last_icp_rate.expect("no icp rate"),
        )
    });

    if caller != vault.owner {
        return Err(ProtocolError::CallerNotOwner);
    }

    let max_borrowable_amount = vault.icp_margin_amount * icp_rate
        / read_state(|s| s.mode.get_minimum_liquidation_collateral_ratio());

    if vault.borrowed_icusd_amount + amount > max_borrowable_amount {
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
            Ok(SuccessWithFee {
                block_index,
                fee_amount_paid: fee.to_u64(),
            })
        }
        Err(mint_error) => Err(ProtocolError::TransferError(mint_error)),
    }
}

pub async fn repay_to_vault(arg: VaultArg) -> Result<u64, ProtocolError> {
    let caller = ic_cdk::api::caller();
    let _guard_principal = GuardPrincipal::new(caller)?;
    let amount: ICUSD = arg.amount.into();
    let vault = read_state(|s| s.vault_id_to_vaults.get(&arg.vault_id).cloned().unwrap());

    if caller != vault.owner {
        return Err(ProtocolError::CallerNotOwner);
    }

    if amount < MIN_ICUSD_AMOUNT {
        return Err(ProtocolError::AmountTooLow {
            minimum_amount: MIN_ICUSD_AMOUNT.to_u64(),
        });
    }

    if vault.borrowed_icusd_amount < amount {
        return Err(ProtocolError::GenericError(format!(
            "cannot repay more than borrowed: {} ICUSD, repay: {} ICUSD",
            vault.borrowed_icusd_amount, amount
        )));
    }

    match transfer_icusd_from(amount, caller).await {
        Ok(block_index) => {
            mutate_state(|s| record_repayed_to_vault(s, arg.vault_id, amount, block_index));
            Ok(block_index)
        }
        Err(transfer_from_error) => Err(ProtocolError::TransferFromError(
            transfer_from_error,
            amount.to_u64(),
        )),
    }
}

pub async fn add_margin_to_vault(arg: VaultArg) -> Result<u64, ProtocolError> {
    let caller = ic_cdk::api::caller();
    let _guard_principal = GuardPrincipal::new(caller)?;
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
    let caller = ic_cdk::api::caller();
    let _guard_principal = GuardPrincipal::new(caller)?;
    let vault = read_state(|s| s.vault_id_to_vaults.get(&vault_id).cloned().unwrap());

    if caller != vault.owner {
        return Err(ProtocolError::CallerNotOwner);
    }

    let amount_to_pay_off = read_state(|s| match s.vault_id_to_vaults.get(&vault_id) {
        Some(vault) => vault.borrowed_icusd_amount,
        None => panic!("vault not found"),
    });

    if amount_to_pay_off == 0 {
        mutate_state(|s| {
            crate::event::record_close_vault(s, vault_id, None);
        });
        return Ok(None);
    }

    match transfer_icusd_from(amount_to_pay_off, caller).await {
        Ok(block_index) => {
            mutate_state(|s| {
                crate::event::record_close_vault(s, vault_id, Some(block_index));
            });
            Ok(Some(block_index))
        }
        Err(error) => Err(ProtocolError::TransferFromError(
            error,
            amount_to_pay_off.to_u64(),
        )),
    }
}