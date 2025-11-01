use ic_cdk::{query, update, init};
use serde::{Serialize};
use ic_stable_structures::memory_manager::{MemoryId, MemoryManager};
use ic_stable_structures::DefaultMemoryImpl;
use icrc_ledger_types::icrc::generic_metadata_value::MetadataValue;
use icrc_ledger_types::icrc1::account::Account;
use icrc_ledger_types::icrc1::transfer::{BlockIndex, Memo, TransferArg, TransferError};
use icrc_ledger_types::icrc2::allowance::{Allowance, AllowanceArgs};
use icrc_ledger_types::icrc2::approve::{ApproveArgs, ApproveError};
use icrc_ledger_types::icrc2::transfer_from::{TransferFromArgs, TransferFromError};
use icrc_ledger_types::icrc3::transactions::{Approve, Burn, Mint, Transaction, Transfer};
use std::cell::RefCell;
use crate::state::PendingMarginTransfer;

use crate::event::{record_liquidate_vault, record_redistribute_vault};
use crate::guard::GuardError;
use crate::logs::{DEBUG, INFO};
use crate::numeric::{Ratio, ICUSD, ICP, UsdIcp};
use crate::state::{mutate_state, read_state, Mode};
use crate::vault::Vault;
use candid::{CandidType, Deserialize, Principal};
use ic_canister_log::log;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;


pub mod dashboard;
pub mod event;
pub mod guard;
pub mod liquidity_pool;
pub mod logs;
pub mod management;
pub mod numeric;
pub mod state;
pub mod storage;
pub mod vault;
pub mod xrc;

#[cfg(any(test, feature = "test_endpoints"))]
pub mod test_helpers; 

#[cfg(test)]
mod tests;

pub const SEC_NANOS: u64 = 1_000_000_000;
pub const E8S: u64 = 100_000_000;

pub const MIN_LIQUIDITY_AMOUNT: ICUSD = ICUSD::new(1_000_000_000);
pub const MIN_ICP_AMOUNT: ICP = ICP::new(100_000);  // Instead of MIN_CKBTC_AMOUNT
pub const MIN_ICUSD_AMOUNT: ICUSD = ICUSD::new(10_000_000); // 0.10 icUSD (10 cents)

// Update collateral ratios per whitepaper
pub const RECOVERY_COLLATERAL_RATIO: Ratio = Ratio::new(dec!(1.5));  // 150%
pub const MINIMUM_COLLATERAL_RATIO: Ratio = Ratio::new(dec!(1.33));  // 133%


#[derive(CandidType, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProtocolArg {
    Init(InitArg),
    Upgrade(UpgradeArg),
}

#[derive(CandidType, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct InitArg {
    pub xrc_principal: Principal,
    pub icusd_ledger_principal: Principal,
    pub icp_ledger_principal: Principal,
    pub fee_e8s: u64,
    pub developer_principal: Principal,
    pub treasury_principal: Option<Principal>,
    pub stability_pool_principal: Option<Principal>,
}

#[derive(CandidType, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpgradeArg {
    pub mode: Option<Mode>,
}

#[derive(CandidType, Deserialize, Debug)]
pub struct ProtocolStatus {
    pub last_icp_rate: f64,
    pub last_icp_timestamp: u64,
    pub total_icp_margin: u64,
    pub total_icusd_borrowed: u64,
    pub total_collateral_ratio: f64,
    pub mode: Mode,
}

#[derive(CandidType, Deserialize, Debug)]
pub struct Fees {
    pub borrowing_fee: f64,
    pub redemption_fee: f64,
}

#[derive(CandidType, Deserialize, Debug)]
pub struct SuccessWithFee {
    pub block_index: u64,
    pub fee_amount_paid: u64,
}

#[derive(candid::CandidType, Deserialize)]
pub struct GetEventsArg {
    pub start: u64,
    pub length: u64,
}

#[derive(CandidType, Deserialize, Debug)]
pub struct LiquidityStatus {
    pub liquidity_provided: u64,
    pub total_liquidity_provided: u64,
    pub liquidity_pool_share: f64,
    pub available_liquidity_reward: u64,
    pub total_available_returns: u64,
}

#[derive(CandidType, Debug, Clone, Deserialize)]
pub enum ProtocolError {
    TransferFromError(TransferFromError, u64),
    TransferError(TransferError),
    TemporarilyUnavailable(String),
    AlreadyProcessing,
    AnonymousCallerNotAllowed,
    CallerNotOwner,
    AmountTooLow { minimum_amount: u64 },
    GenericError(String),
}

impl From<GuardError> for ProtocolError {
    fn from(e: GuardError) -> Self {
        match e {
            GuardError::AlreadyProcessing => Self::AlreadyProcessing,
            GuardError::TooManyConcurrentRequests => {
                Self::TemporarilyUnavailable("too many concurrent requests".to_string())
            },
            GuardError::StaleOperation => {
                Self::TemporarilyUnavailable("previous operation is being cleaned up".to_string())
            }
        }
    }
}

pub fn check_vaults() {
    let last_icp_rate = read_state(|s| {
        s.last_icp_rate.unwrap_or_else(|| {
            log!(INFO, "[check_vaults] No ICP rate available, using default rate");
            UsdIcp::from(dec!(1.0))
        })
    });
    
    // Only identify unhealthy vaults but don't liquidate them
    let (unhealthy_vaults, healthy_vaults) = read_state(|s| {
        let mut unhealthy_vaults: Vec<Vault> = vec![];
        let mut healthy_vaults: Vec<Vault> = vec![];
        for vault in s.vault_id_to_vaults.values() {
            if compute_collateral_ratio(vault, last_icp_rate)
                < s.mode.get_minimum_liquidation_collateral_ratio()
            {
                unhealthy_vaults.push(vault.clone());
            } else {
                healthy_vaults.push(vault.clone())
            }
        }
        (unhealthy_vaults, healthy_vaults)
    });

    // Log unhealthy vaults but don't liquidate them
    if !unhealthy_vaults.is_empty() {
        log!(
            INFO,
            "[check_vaults] Found {} liquidatable vaults. Waiting for external liquidators.", 
            unhealthy_vaults.len()
        );
        
        // Log detailed information about each unhealthy vault
        for vault in unhealthy_vaults {
            let ratio = compute_collateral_ratio(&vault, last_icp_rate);
            log!(
                INFO,
                "[check_vaults] Liquidatable vault #{}: owner={}, borrowed={}, collateral={}, ratio={:.2}%, min_ratio={:.2}%", 
                vault.vault_id,
                vault.owner,
                vault.borrowed_icusd_amount,
                vault.icp_margin_amount,
                ratio.to_f64() * 100.0,
                read_state(|s| s.mode.get_minimum_liquidation_collateral_ratio().to_f64() * 100.0)
            );
        }
    } else {
        log!(
            DEBUG,
            "[check_vaults] All vaults are healthy at the current ICP rate: {}", 
            last_icp_rate.to_f64()
        );
    }
    
    // No longer calling record_liquidate_vault to trigger automatic liquidations
}

pub fn compute_collateral_ratio(vault: &Vault, icp_rate: UsdIcp) -> Ratio {
    if vault.borrowed_icusd_amount == 0 {
        return Ratio::from(Decimal::MAX);
    }
    let margin_value: ICUSD = vault.icp_margin_amount * icp_rate;
    margin_value / vault.borrowed_icusd_amount
}

pub(crate) async fn process_pending_transfer() {
    let _guard = match crate::guard::TimerLogicGuard::new() {
        Some(guard) => guard,
        None => {
            log!(INFO, "[process_pending_transfer] double entry.");
            return;
        }
    };

    // Process pending margin transfers
    let pending_transfers = read_state(|s| {
        // Log for visibility
        if !s.pending_margin_transfers.is_empty() {
            log!(INFO, "[process_pending_transfer] Found {} pending margin transfers", 
                 s.pending_margin_transfers.len());
        }
        
        s.pending_margin_transfers
            .iter()
            .map(|(vault_id, margin_transfer)| (*vault_id, *margin_transfer))
            .collect::<Vec<(u64, PendingMarginTransfer)>>()
    });
    let icp_transfer_fee = read_state(|s| s.icp_ledger_fee);
    
    for (vault_id, transfer) in pending_transfers {
        match crate::management::transfer_icp(
            transfer.margin - icp_transfer_fee,
            transfer.owner,
        )
        .await
        {
            Ok(block_index) => {
                log!(
                    INFO,
                    "[transfering_margins] successfully transferred: {} to {}",
                    transfer.margin,
                    transfer.owner
                );
                mutate_state(|s| crate::event::record_margin_transfer(s, vault_id, block_index));
            }
            Err(error) => {
                // Improved error logging with more details
                log!(
                    DEBUG,
                    "[transfering_margins] failed to transfer margin: {}, to principal: {}, with error: {}",
                    transfer.margin,
                    transfer.owner,
                    error
                );
                
                // If there was a transfer fee error, update the fee
                if let TransferError::BadFee { expected_fee } = error {
                    log!(INFO, "[transfering_margins] Updating transfer fee to: {:?}", expected_fee);
                    mutate_state(|s| {
                        let expected_fee: u64 = expected_fee
                            .0
                            .try_into()
                            .expect("failed to convert Nat to u64");
                        s.icp_ledger_fee = ICP::from(expected_fee);
                    });
                    
                    // After updating the fee, we should retry this transfer next time
                } else {
                    // For other errors, we still keep the transfer pending for retry
                    log!(INFO, "[transfering_margins] Will retry this transfer later");
                }
            }
        }
    }

    // Similar improved logic for redemption transfers
    let pending_redemptions = read_state(|s| {
        s.pending_redemption_transfer
            .iter()
            .map(|(icusd_block_index, margin_transfer)| (*icusd_block_index, *margin_transfer))
            .collect::<Vec<(u64, PendingMarginTransfer)>>()
    });

    for (icusd_block_index, pending_transfer) in pending_redemptions {
        match crate::management::transfer_icp(
            pending_transfer.margin - icp_transfer_fee,
            pending_transfer.owner,
        )
        .await
        {
            Ok(block_index) => {
                log!(
                    INFO,
                    "[transfering_redemptions] successfully transferred: {} to {}",
                    pending_transfer.margin,
                    pending_transfer.owner
                );
                mutate_state(|s| {
                    crate::event::record_redemption_transfered(s, icusd_block_index, block_index)
                });
            }
            Err(error) => log!(
                DEBUG,
                "[transfering_redemptions] failed to transfer margin: {}, with error: {}",
                pending_transfer.margin,
                error
            ),
        }
    }

    // Schedule another run if needed, but with better timing
    if read_state(|s| {
        !s.pending_margin_transfers.is_empty() || !s.pending_redemption_transfer.is_empty()
    }) {
        // Schedule another check in 5 seconds
        log!(INFO, "[process_pending_transfer] Scheduling another transfer attempt in 5 seconds");
        ic_cdk_timers::set_timer(std::time::Duration::from_secs(5), || {
            ic_cdk::spawn(crate::process_pending_transfer())
        });
    } else {
        log!(INFO, "[process_pending_transfer] No more pending transfers");
    }
}