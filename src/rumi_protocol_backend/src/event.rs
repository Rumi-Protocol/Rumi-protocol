use crate::numeric::{UsdIcp, ICUSD, ICP};
use crate::state::{PendingMarginTransfer, State};
use crate::storage::record_event;
use crate::vault::Vault;
use crate::{InitArg, Mode, UpgradeArg};
use candid::{CandidType, Principal};
use serde::{Deserialize, Serialize};

#[derive(CandidType, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Event {
    #[serde(rename = "open_vault")]
    OpenVault { vault: Vault, block_index: u64 },

    #[serde(rename = "close_vault")]
    CloseVault {
        vault_id: u64,
        block_index: Option<u64>,
    },

    #[serde(rename = "margin_transfer")]
    MarginTransfer { vault_id: u64, block_index: u64 },

    #[serde(rename = "liquidate_vault")]
    LiquidateVault {
        vault_id: u64,
        mode: Mode,
        icp_rate: UsdIcp,
        #[serde(skip_serializing_if = "Option::is_none")]
        liquidator: Option<Principal>,
    },

    #[serde(rename = "partial_liquidate_vault")]
    PartialLiquidateVault {
        vault_id: u64,
        liquidator_payment: ICUSD,
        icp_to_liquidator: ICP,
        liquidator: Principal,
    },

    #[serde(rename = "redemption_on_vaults")]
    RedemptionOnVaults {
        owner: Principal,
        current_icp_rate: UsdIcp,
        icusd_amount: ICUSD,
        fee_amount: ICUSD,
        icusd_block_index: u64,
    },

    #[serde(rename = "redemption_transfered")]
    RedemptionTransfered {
        icusd_block_index: u64,
        icp_block_index: u64,
    },

    #[serde(rename = "redistribute_vault")]
    RedistributeVault { vault_id: u64 },

    #[serde(rename = "borrow_from_vault")]
    BorrowFromVault {
        vault_id: u64,
        borrowed_amount: ICUSD,
        fee_amount: ICUSD,
        block_index: u64,
    },

    #[serde(rename = "repay_to_vault")]
    RepayToVault {
        vault_id: u64,
        repayed_amount: ICUSD,
        block_index: u64,
    },

    #[serde(rename = "add_margin_to_vault")]
    AddMarginToVault {
        vault_id: u64,
        margin_added: ICP,
        block_index: u64,
    },

    #[serde(rename = "provide_liquidity")]
    ProvideLiquidity {
        amount: ICUSD,
        block_index: u64,
        caller: Principal,
    },

    #[serde(rename = "withdraw_liquidity")]
    WithdrawLiquidity {
        amount: ICUSD,
        block_index: u64,
        caller: Principal,
    },

    #[serde(rename = "claim_liquidity_returns")]
    ClaimLiquidityReturns {
        amount: ICP,
        block_index: u64,
        caller: Principal,
    },

    #[serde(rename = "init")]
    Init(InitArg),

    #[serde(rename = "upgrade")]
    Upgrade(UpgradeArg),

    #[serde(rename = "collateral_withdrawn")]
    CollateralWithdrawn {
        vault_id: u64,
        amount: ICP,
        block_index: u64,
    },

    VaultWithdrawnAndClosed {
        vault_id: u64,
        caller: Principal,
        amount: ICP,
        timestamp: u64,
    },

    #[serde(rename = "withdraw_and_close_vault")]
    WithdrawAndCloseVault {
        vault_id: u64,
        amount: ICP,
        block_index: Option<u64>,
    },
}

impl Event {
    // Define a method to check if the event contains vault_id
    pub fn is_vault_related(&self, filter_vault_id: &u64) -> bool {
        match self {
            Event::OpenVault { vault, .. } => &vault.vault_id == filter_vault_id,
            Event::CloseVault { vault_id, .. } => vault_id == filter_vault_id,
            Event::MarginTransfer { vault_id, .. } => vault_id == filter_vault_id,
            Event::LiquidateVault { vault_id, .. } => vault_id == filter_vault_id,
            Event::PartialLiquidateVault { vault_id, .. } => vault_id == filter_vault_id,
            Event::RedemptionOnVaults { .. } => true,
            Event::RedemptionTransfered { .. } => false,
            Event::RedistributeVault { vault_id, .. } => vault_id == filter_vault_id,
            Event::BorrowFromVault { vault_id, .. } => vault_id == filter_vault_id,
            Event::RepayToVault { vault_id, .. } => vault_id == filter_vault_id,
            Event::AddMarginToVault { vault_id, .. } => vault_id == filter_vault_id,
            Event::ProvideLiquidity { .. } => false,
            Event::WithdrawLiquidity { .. } => false,
            Event::ClaimLiquidityReturns { .. } => false,
            Event::Init(_) => false,
            Event::Upgrade(_) => false,
            Event::CollateralWithdrawn { vault_id, .. } => vault_id == filter_vault_id,
            Event::VaultWithdrawnAndClosed { vault_id, .. } => vault_id == filter_vault_id,
            Event::WithdrawAndCloseVault { vault_id, .. } => vault_id == filter_vault_id,
        }
    }
}

#[derive(Debug)]
pub enum ReplayLogError {
    /// There are no events in the event log.
    EmptyLog,
    /// The event log is inconsistent.
    InconsistentLog(String),
}

pub fn replay(mut events: impl Iterator<Item = Event>) -> Result<State, ReplayLogError> {
    let mut state = match events.next() {
        Some(Event::Init(args)) => State::from(args),
        Some(evt) => {
            return Err(ReplayLogError::InconsistentLog(format!(
                "The first event is not Init: {:?}",
                evt
            )))
        }
        None => return Err(ReplayLogError::EmptyLog),
    };
    let mut vault_id = 0;
    for event in events {
        match event {
            Event::OpenVault {
                vault,
                block_index: _,
            } => {
                vault_id += 1;
                state.open_vault(vault);
            }
            Event::CloseVault {
                vault_id,
                block_index: _,
            } => state.close_vault(vault_id),
            Event::LiquidateVault {
                vault_id,
                mode,
                icp_rate,
                liquidator: _,
            } => state.liquidate_vault(vault_id, mode, icp_rate),
            Event::PartialLiquidateVault {
                vault_id,
                liquidator_payment,
                icp_to_liquidator,
                liquidator: _,
            } => {
                // Reduce vault debt and collateral
                if let Some(vault) = state.vault_id_to_vaults.get_mut(&vault_id) {
                    vault.borrowed_icusd_amount -= liquidator_payment;
                    vault.icp_margin_amount -= icp_to_liquidator;
                }
            },
            Event::RedistributeVault { vault_id } => state.redistribute_vault(vault_id),
            Event::BorrowFromVault {
                vault_id,
                borrowed_amount,
                fee_amount,
                block_index: _,
            } => {
                state.provide_liquidity(fee_amount, state.developer_principal);
                state.borrow_from_vault(vault_id, borrowed_amount)
            }
            Event::RedemptionOnVaults {
                owner,
                current_icp_rate,
                icusd_amount,
                fee_amount,
                icusd_block_index,
            } => {
                state.provide_liquidity(fee_amount, state.developer_principal);
                state.redeem_on_vaults(icusd_amount, current_icp_rate);
                let margin: ICP = icusd_amount / current_icp_rate;
                state
                    .pending_redemption_transfer
                    .insert(icusd_block_index, PendingMarginTransfer { owner, margin });
            }
            Event::RedemptionTransfered {
                icusd_block_index, ..
            } => {
                state.pending_redemption_transfer.remove(&icusd_block_index);
            }
            Event::AddMarginToVault {
                vault_id,
                margin_added,
                ..
            } => state.add_margin_to_vault(vault_id, margin_added),
            Event::RepayToVault {
                vault_id,
                repayed_amount,
                ..
            } => {
                state.repay_to_vault(vault_id, repayed_amount);
            }
            Event::ProvideLiquidity { amount, caller, .. } => {
                state.provide_liquidity(amount, caller);
            }
            Event::WithdrawLiquidity { amount, caller, .. } => {
                state.withdraw_liquidity(amount, caller);
            }
            Event::ClaimLiquidityReturns { amount, caller, .. } => {
                state.claim_liquidity_returns(amount, caller);
            }
            Event::Init(_) => panic!("should have only one init event"),
            Event::Upgrade(upgrade_args) => {
                state.upgrade(upgrade_args);
            }
            Event::MarginTransfer { vault_id, .. } => {
                state.pending_margin_transfers.remove(&vault_id);
            }
            Event::CollateralWithdrawn { vault_id, .. } => {
                // The vault's margin has already been set to 0 in the vault.rs function
            }
            // In the match statement inside replay function
            Event::VaultWithdrawnAndClosed {
                vault_id,
                caller: _,   // Ignore caller
                amount: _,   // Ignore amount
                timestamp: _, // Ignore timestamp
            } => {
                // Simply close the vault - previous implementation was incorrect
                state.close_vault(vault_id);
            },
            // Add this case:
            Event::WithdrawAndCloseVault { 
                vault_id,
                amount: _,
                block_index: _,
            } => {
                // Close the vault during replay
                state.close_vault(vault_id);
            },
        }
    }
    state.next_available_vault_id = vault_id;
    Ok(state)
}

pub fn record_liquidate_vault(state: &mut State, vault_id: u64, mode: Mode, icp_rate: UsdIcp) {
    record_event(&Event::LiquidateVault {
        vault_id,
        mode,
        icp_rate,
        liquidator: None,
    });
    state.liquidate_vault(vault_id, mode, icp_rate);
}

pub fn record_redistribute_vault(state: &mut State, vault_id: u64) {
    record_event(&Event::RedistributeVault { vault_id });
    state.redistribute_vault(vault_id);
}

pub fn record_provide_liquidity(
    state: &mut State,
    amount: ICUSD,
    caller: Principal,
    block_index: u64,
) {
    record_event(&Event::ProvideLiquidity {
        amount,
        block_index,
        caller,
    });
    state.provide_liquidity(amount, caller);
}

pub fn record_withdraw_liquidity(
    state: &mut State,
    amount: ICUSD,
    caller: Principal,
    block_index: u64,
) {
    record_event(&Event::WithdrawLiquidity {
        amount,
        block_index,
        caller,
    });
    state.withdraw_liquidity(amount, caller);
}

pub fn record_claim_liquidity_returns(
    state: &mut State,
    amount: ICP,
    caller: Principal,
    block_index: u64,
) {
    record_event(&Event::ClaimLiquidityReturns {
        amount,
        block_index,
        caller,
    });
    state.claim_liquidity_returns(amount, caller);
}

pub fn record_open_vault(state: &mut State, vault: Vault, block_index: u64) {
    record_event(&Event::OpenVault {
        vault: vault.clone(),
        block_index,
    });
    state.open_vault(vault);
}

pub fn record_close_vault(state: &mut State, vault_id: u64, block_index: Option<u64>) {
    record_event(&Event::CloseVault {
        vault_id,
        block_index,
    });
    state.close_vault(vault_id);
}

pub fn record_margin_transfer(state: &mut State, vault_id: u64, block_index: u64) {
    record_event(&Event::MarginTransfer {
        vault_id,
        block_index,
    });
    state.pending_margin_transfers.remove(&vault_id);
}

pub fn record_borrow_from_vault(
    state: &mut State,
    vault_id: u64,
    borrowed_amount: ICUSD,
    fee_amount: ICUSD,
    block_index: u64,
) {
    record_event(&Event::BorrowFromVault {
        vault_id,
        block_index,
        fee_amount,
        borrowed_amount,
    });
    state.borrow_from_vault(vault_id, borrowed_amount);
    state.provide_liquidity(fee_amount, state.developer_principal);
}

pub fn record_repayed_to_vault(
    state: &mut State,
    vault_id: u64,
    repayed_amount: ICUSD,
    block_index: u64,
) {
    record_event(&Event::RepayToVault {
        vault_id,
        block_index,
        repayed_amount,
    });
    state.repay_to_vault(vault_id, repayed_amount);
}

pub fn record_add_margin_to_vault(
    state: &mut State,
    vault_id: u64,
    margin_added: ICP,
    block_index: u64,
) {
    record_event(&Event::AddMarginToVault {
        vault_id,
        margin_added,
        block_index,
    });
    state.add_margin_to_vault(vault_id, margin_added);
}

pub fn record_redemption_on_vaults(
    state: &mut State,
    owner: Principal,
    icusd_amount: ICUSD,
    fee_amount: ICUSD,
    current_icp_rate: UsdIcp,
    icusd_block_index: u64,
) {
    record_event(&Event::RedemptionOnVaults {
        owner,
        current_icp_rate,
        icusd_amount,
        fee_amount,
        icusd_block_index,
    });
    state.provide_liquidity(fee_amount, state.developer_principal);
    state.redeem_on_vaults(icusd_amount, current_icp_rate);
    let margin: ICP = icusd_amount / current_icp_rate;
    state
        .pending_redemption_transfer
        .insert(icusd_block_index, PendingMarginTransfer { owner, margin });
}

pub fn record_redemption_transfered(
    state: &mut State,
    icusd_block_index: u64,
    icp_block_index: u64,
) {
    record_event(&Event::RedemptionTransfered {
        icusd_block_index,
        icp_block_index,
    });
    state.pending_redemption_transfer.remove(&icusd_block_index);
}

pub fn record_collateral_withdrawn(
    state: &mut State,
    vault_id: u64,
    amount: ICP,
    block_index: u64,
) {
    record_event(&Event::CollateralWithdrawn {
        vault_id,
        amount,
        block_index,
    });

}

pub fn record_withdraw_and_close_vault(
    state: &mut State,
    vault_id: u64,
    amount: ICP,
    block_index: Option<u64>
) {
    record_event(&Event::WithdrawAndCloseVault {
        vault_id,
        amount,
        block_index,
    });
    
    // Close the vault (withdrawal is already handled in vault.rs)
    state.close_vault(vault_id);
}
