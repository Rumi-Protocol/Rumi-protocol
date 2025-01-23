use crate::numeric::{Ratio, UsdIcp, ICUSD, ICP};
use crate::vault::Vault;
use crate::{
    compute_collateral_ratio, InitArg, ProtocolError, UpgradeArg, MINIMUM_COLLATERAL_RATIO,
    RECOVERY_COLLATERAL_RATIO,
};
use candid::Principal;
use ic_canister_log::log;
use rust_decimal::prelude::FromPrimitive;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::Serialize;
use std::cell::RefCell;
use std::collections::btree_map::Entry::{Occupied, Vacant};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

// Like assert_eq, but returns an error instead of panicking.
macro_rules! ensure_eq {
    ($lhs:expr, $rhs:expr, $msg:expr $(, $args:expr)* $(,)*) => {
        if $lhs != $rhs {
            return Err(format!("{} ({:?}) != {} ({:?}): {}",
                               std::stringify!($lhs), $lhs,
                               std::stringify!($rhs), $rhs,
                               format!($msg $(,$args)*)));
        }
    }
}

macro_rules! ensure {
    ($cond:expr, $msg:expr $(, $args:expr)* $(,)*) => {
        if !$cond {
            return Err(format!("Condition {} is false: {}",
                               std::stringify!($cond),
                               format!($msg $(,$args)*)));
        }
    }
}

pub const ICP_TRANSFER_FEE: ICP = ICP::new(10);
pub type VaultId = u64;
pub const DEFAULT_BORROW_FEE: Ratio = Ratio::new(dec!(0.005));

/// Controls which operations the protocol can perform.
#[derive(candid::CandidType, Clone, Debug, PartialEq, Eq, serde::Deserialize, Serialize, Copy)]
pub enum Mode {
    /// Protocol's state is read-only.
    ReadOnly,
    /// No restrictions on the protocol interactions.
    GeneralAvailability,
    /// The protocols tries to get back to a total
    /// collateral ratio above 150%
    Recovery,
}


impl Mode {
    pub fn is_available(&self) -> bool {
        match self {
            Mode::ReadOnly => false,
            Mode::GeneralAvailability => true,
            Mode::Recovery => true,
        }
    }

    pub fn get_minimum_liquidation_collateral_ratio(&self) -> Ratio {
        match self {
            Mode::ReadOnly => MINIMUM_COLLATERAL_RATIO,
            Mode::GeneralAvailability => MINIMUM_COLLATERAL_RATIO,
            Mode::Recovery => RECOVERY_COLLATERAL_RATIO,
        }
    }
}

impl fmt::Display for Mode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Mode::ReadOnly => write!(f, "Read-only"),
            Mode::GeneralAvailability => write!(f, "General availability"),
            Mode::Recovery => write!(f, "Recovery"),
        }
    }
}

impl Default for Mode {
    fn default() -> Self {
        Self::GeneralAvailability
    }
}



#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize, Serialize, Copy)]
pub struct PendingMarginTransfer {
    pub owner: Principal,
    pub margin: ICP,
}

thread_local! {
    static __STATE: RefCell<Option<State>> = RefCell::default();
}


pub struct State {
    pub vault_id_to_vaults: BTreeMap<u64, Vault>,
    pub principal_to_vault_ids: BTreeMap<Principal, BTreeSet<u64>>,
    pub pending_margin_transfers: BTreeMap<VaultId, PendingMarginTransfer>,
    pub pending_redemption_transfer: BTreeMap<u64, PendingMarginTransfer>,
    pub mode: Mode,
    pub fee: Ratio,
    pub developer_principal: Principal,
    pub next_available_vault_id: u64,
    pub total_collateral_ratio: Ratio,
    pub current_base_rate: Ratio,
    pub last_redemption_time: u64,
    pub liquidity_pool: BTreeMap<Principal, ICUSD>,
    pub liquidity_returns: BTreeMap<Principal, ICP>,
    pub xrc_principal: Principal,
    pub icusd_ledger_principal: Principal,
    pub icp_ledger_principal: Principal,
    pub icp_ledger_fee: ICP,
    pub last_icp_rate: Option<UsdIcp>,
    pub last_icp_timestamp: Option<u64>,
    pub principal_guards: BTreeSet<Principal>,
    pub is_timer_running: bool,
    pub is_fetching_rate: bool,
}

impl From<InitArg> for State {
    fn from(args: InitArg) -> Self {
        let fee = Decimal::from_u64(args.fee_e8s).unwrap() / dec!(100_000_000);
        Self {
            last_redemption_time: 0,
            current_base_rate: Ratio::from(Decimal::ZERO),
            fee: Ratio::from(fee),
            developer_principal: args.developer_principal,
            principal_to_vault_ids: BTreeMap::new(),
            pending_redemption_transfer: BTreeMap::new(),
            vault_id_to_vaults: BTreeMap::new(),
            xrc_principal: args.xrc_principal,
            icusd_ledger_principal: args.icusd_ledger_principal,
            icp_ledger_principal: args.icp_ledger_principal,
            icp_ledger_fee: ICP_TRANSFER_FEE,
            mode: Mode::GeneralAvailability,
            total_collateral_ratio: Ratio::from(Decimal::MAX),
            last_icp_timestamp: None,
            last_icp_rate: None,
            next_available_vault_id: 0,
            principal_guards: BTreeSet::new(),
            liquidity_pool: BTreeMap::new(),
            liquidity_returns: BTreeMap::new(),
            pending_margin_transfers: BTreeMap::new(),
            is_timer_running: false,
            is_fetching_rate: false,
        }
    }
}

impl State {

    pub fn check_price_not_too_old(&self) -> Result<(), ProtocolError> {
        let current_time = ic_cdk::api::time();
        const TEN_MINS_NANOS: u64 = 10 * 60 * 1_000_000_000;
        let last_icp_timestamp = match self.last_icp_timestamp {
            Some(last_icp_timestamp) => last_icp_timestamp,
            None => {
                return Err(ProtocolError::TemporarilyUnavailable(
                    "No ICP price fetched".to_string(),
                ))
            }
        };
        if current_time.saturating_sub(last_icp_timestamp) > TEN_MINS_NANOS {
            return Err(ProtocolError::TemporarilyUnavailable(
                "Last known ICP price too old".to_string(),
            ));
        }
        Ok(())
    }

    pub fn increment_vault_id(&mut self) -> u64 {
        let vault_id = self.next_available_vault_id;
        self.next_available_vault_id += 1;
        vault_id
    }

    pub fn upgrade(&mut self, args: UpgradeArg) {
        if let Some(mode) = args.mode {
            self.mode = mode;
        }
    }

    pub fn total_borrowed_icusd_amount(&self) -> ICUSD {
        self.vault_id_to_vaults
            .values()
            .map(|vault| vault.borrowed_icusd_amount)
            .sum()
    }

    pub fn total_icp_margin_amount(&self) -> ICP {
        self.vault_id_to_vaults
            .values()
            .map(|vault| vault.icp_margin_amount)
            .sum()
    }

    pub fn compute_total_collateral_ratio(&self, icp_rate: UsdIcp) -> Ratio {
        if self.total_borrowed_icusd_amount() == ICUSD::new(0) {
            return Ratio::from(Decimal::MAX);
        }
        (self.total_icp_margin_amount() * icp_rate) / self.total_borrowed_icusd_amount()
    }

    pub fn get_redemption_fee(&self, redeemed_amount: ICUSD) -> Ratio {
        let current_time = ic_cdk::api::time();
        let last_redemption_time = self.last_redemption_time;
        let elapsed_hours = (current_time - last_redemption_time) / 1_000_000_000 / 3600;
        compute_redemption_fee(
            elapsed_hours,
            redeemed_amount,
            self.total_borrowed_icusd_amount(),
            self.current_base_rate,
        )
    }

    pub fn get_borrowing_fee(&self) -> Ratio {
        match self.mode {
            Mode::Recovery => Ratio::from(Decimal::ZERO),
            Mode::GeneralAvailability => self.fee,
            Mode::ReadOnly => self.fee,
        }
    }

    pub fn update_total_collateral_ratio_and_mode(&mut self, icp_rate: UsdIcp) {
        let previous_mode = self.mode;
        let new_total_collateral_ratio = self.compute_total_collateral_ratio(icp_rate);
        self.total_collateral_ratio = new_total_collateral_ratio;
        
        if new_total_collateral_ratio < crate::RECOVERY_COLLATERAL_RATIO {
            self.mode = Mode::Recovery;
        } else {
            self.mode = Mode::GeneralAvailability;
        }
        
        if new_total_collateral_ratio < Ratio::from(dec!(1.0)) {
            self.mode = Mode::ReadOnly;
        }
        
        if previous_mode != self.mode {
            log!(
                crate::DEBUG,
                "[update_mode] switched to {}, ratio: {}, min ratio: {:?}",
                self.mode,
                new_total_collateral_ratio.to_f64(),
                self.mode.get_minimum_liquidation_collateral_ratio().to_f64()
            );
        }
    }

    pub fn open_vault(&mut self, vault: Vault) {
        let vault_id = vault.vault_id;
        self.vault_id_to_vaults.insert(vault_id, vault.clone());
        match self.principal_to_vault_ids.get_mut(&vault.owner) {
            Some(vault_ids) => {
                vault_ids.insert(vault_id);
            }
            None => {
                let mut vault_ids: BTreeSet<u64> = BTreeSet::new();
                vault_ids.insert(vault_id);
                self.principal_to_vault_ids.insert(vault.owner, vault_ids);
            }
        }
    }

    pub fn close_vault(&mut self, vault_id: u64) {
        if let Some(vault) = self.vault_id_to_vaults.remove(&vault_id) {
            let owner = vault.owner;
            self.pending_margin_transfers.insert(
                vault_id,
                PendingMarginTransfer {
                    owner,
                    margin: vault.icp_margin_amount,
                },
            );
            if let Some(vault_ids) = self.principal_to_vault_ids.get_mut(&owner) {
                vault_ids.remove(&vault_id);
            } else {
                ic_cdk::trap("BUG: tried to close vault with no owner");
            }
        } else {
            ic_cdk::trap("BUG: tried to close unknown vault");
        }
    }

    pub fn borrow_from_vault(&mut self, vault_id: u64, borrowed_amount: ICUSD) {
        match self.vault_id_to_vaults.get_mut(&vault_id) {
            Some(vault) => {
                vault.borrowed_icusd_amount += borrowed_amount;
            }
            None => ic_cdk::trap("borrowing from unknown vault"),
        }
    }

    pub fn add_margin_to_vault(&mut self, vault_id: u64, add_margin: ICP) {
        match self.vault_id_to_vaults.get_mut(&vault_id) {
            Some(vault) => {
                vault.icp_margin_amount += add_margin;
            }
            None => ic_cdk::trap("adding margin to unknown vault"),
        }
    }

    pub fn repay_to_vault(&mut self, vault_id: u64, repayed_amount: ICUSD) {
        match self.vault_id_to_vaults.get_mut(&vault_id) {
            Some(vault) => {
                assert!(repayed_amount <= vault.borrowed_icusd_amount);
                vault.borrowed_icusd_amount -= repayed_amount;
            }
            None => ic_cdk::trap("repaying to unknown vault"),
        }
    }

    pub fn provide_liquidity(&mut self, amount: ICUSD, caller: Principal) {
        if amount == 0 {
            return;
        }
        self.liquidity_pool
            .entry(caller)
            .and_modify(|curr| *curr += amount)
            .or_insert(amount);
    }

    pub fn withdraw_liquidity(&mut self, amount: ICUSD, caller: Principal) {
        match self.liquidity_pool.entry(caller) {
            Occupied(mut entry) => {
                assert!(*entry.get() >= amount);
                *entry.get_mut() -= amount;
                if *entry.get() == 0 {
                    entry.remove_entry();
                }
            }
            Vacant(_) => ic_cdk::trap("cannot remove liquidity from unknow principal"),
        }
    }

    pub fn claim_liquidity_returns(&mut self, amount: ICP, caller: Principal) {
        match self.liquidity_returns.entry(caller) {
            Occupied(mut entry) => {
                assert!(*entry.get() >= amount);
                *entry.get_mut() -= amount;
                if *entry.get() == 0 {
                    entry.remove_entry();
                }
            }
            Vacant(_) => ic_cdk::trap("cannot claim returns from unknow principal"),
        }
    }

    pub fn get_liquidity_returns_of(&self, principal: Principal) -> ICP {
        *self.liquidity_returns.get(&principal).unwrap_or(&0.into())
    }

    pub fn total_provided_liquidity_amount(&self) -> ICUSD {
        self.liquidity_pool.values().cloned().sum()
    }

    pub fn total_available_returns(&self) -> ICP {
        self.liquidity_returns.values().cloned().sum()
    }

    pub fn get_provided_liquidity(&self, principal: Principal) -> ICUSD {
        *self.liquidity_pool.get(&principal).unwrap_or(&ICUSD::from(0))
    }

    pub fn liquidate_vault(&mut self, vault_id: u64, mode: Mode, icp_rate: UsdIcp) {
        let vault = self
            .vault_id_to_vaults
            .get(&vault_id)
            .cloned()
            .expect("bug: vault not found");

        let vault_collateral_ratio = compute_collateral_ratio(&vault, icp_rate);
        
        if mode == Mode::Recovery && vault_collateral_ratio > MINIMUM_COLLATERAL_RATIO {
            // Partial liquidation
            let partial_margin = (vault.borrowed_icusd_amount * MINIMUM_COLLATERAL_RATIO) / icp_rate;
            assert!(
                partial_margin <= vault.icp_margin_amount,
                "partial margin: {partial_margin}, vault margin: {}",
                vault.icp_margin_amount
            );
            
            match self.vault_id_to_vaults.get_mut(&vault_id) {
                Some(vault) => {
                    vault.borrowed_icusd_amount = ICUSD::new(0);
                    vault.icp_margin_amount -= partial_margin;
                }
                None => ic_cdk::trap("liquidating unknown vault"),
            }
        } else {
            // Full liquidation
            if let Some(vault) = self.vault_id_to_vaults.remove(&vault_id) {
                if let Some(vault_ids) = self.principal_to_vault_ids.get_mut(&vault.owner) {
                    vault_ids.remove(&vault_id);
                }
            }
        }
    }

        
    pub fn redistribute_vault(&mut self, vault_id: u64) {
        let vault = self
            .vault_id_to_vaults
            .get(&vault_id)
            .expect("bug: vault not found");
        let entries = distribute_across_vaults(&self.vault_id_to_vaults, vault.clone());
        for entry in entries {
            match self.vault_id_to_vaults.entry(entry.vault_id) {
                Occupied(mut vault_entry) => {
                    vault_entry.get_mut().icp_margin_amount += entry.icp_share_amount;
                    vault_entry.get_mut().borrowed_icusd_amount += entry.icusd_share_amount;
                }
                Vacant(_) => panic!("bug: vault not found"),
            }
        }
        if let Some(vault) = self.vault_id_to_vaults.remove(&vault_id) {
            let owner = vault.owner;
            if let Some(vault_ids) = self.principal_to_vault_ids.get_mut(&owner) {
                vault_ids.remove(&vault_id);
            }
        }
    }
    
    pub fn redeem_on_vaults(&mut self, icusd_amount: ICUSD, current_icp_rate: UsdIcp) {
        let mut icusd_amount_to_convert = icusd_amount;
        let mut vaults: BTreeSet<(Ratio, VaultId)> = BTreeSet::new();
    
        for vault in self.vault_id_to_vaults.values() {
            vaults.insert((
                crate::compute_collateral_ratio(vault, current_icp_rate),
                vault.vault_id,
            ));
        }
    
        let vault_ids: Vec<VaultId> = vaults.iter().map(|(_cr, vault_id)| *vault_id).collect();
        let mut index: usize = 0;
    
        while icusd_amount_to_convert > 0 && index < vault_ids.len() {
            let vault = self.vault_id_to_vaults.get(&vault_ids[index]).unwrap();
    
            if vault.borrowed_icusd_amount >= icusd_amount_to_convert {
                // Convert everything on this vault
                let redeemable_icp_amount: ICP = icusd_amount_to_convert / current_icp_rate;
                self.deduct_amount_from_vault(
                    redeemable_icp_amount,
                    icusd_amount_to_convert,
                    vault_ids[index],
                );
                break;
            } else {
                // Convert what we can on this vault
                let redeemable_icusd_amount = vault.borrowed_icusd_amount;
                let redeemable_icp_amount: ICP = redeemable_icusd_amount / current_icp_rate;
                self.deduct_amount_from_vault(
                    redeemable_icp_amount,
                    redeemable_icusd_amount,
                    vault_ids[index],
                );
                icusd_amount_to_convert -= redeemable_icusd_amount;
                index += 1;
            }
        }
        debug_assert!(icusd_amount_to_convert == 0);
    }
    
    fn deduct_amount_from_vault(
        &mut self,
        icp_amount_to_deduct: ICP,
        icusd_amount_to_deduct: ICUSD,
        vault_id: VaultId,
    ) {
        match self.vault_id_to_vaults.get_mut(&vault_id) {
            Some(vault) => {
                assert!(vault.borrowed_icusd_amount >= icusd_amount_to_deduct);
                vault.borrowed_icusd_amount -= icusd_amount_to_deduct;
                assert!(vault.icp_margin_amount >= icp_amount_to_deduct);
                vault.icp_margin_amount -= icp_amount_to_deduct;
            }
            None => ic_cdk::trap("cannot deduct from unknown vault"),
        }
    }

    pub fn check_semantically_eq(&self, other: &Self) -> Result<(), String> {
        ensure_eq!(
            self.vault_id_to_vaults,
            other.vault_id_to_vaults,
            "vault_id_to_vaults does not match"
        );
        ensure_eq!(
            self.pending_margin_transfers,
            other.pending_margin_transfers,
            "pending_margin_transfers does not match"
        );
        ensure_eq!(
            self.principal_to_vault_ids,
            other.principal_to_vault_ids,
            "principal_to_vault_ids does not match"
        );
        ensure_eq!(
            self.xrc_principal,
            other.xrc_principal,
            "xrc_principal does not match"
        );
        ensure_eq!(
            self.icusd_ledger_principal,
            other.icusd_ledger_principal,
            "icusd_ledger_principal does not match"
        );
        ensure_eq!(
            self.icp_ledger_principal,
            other.icp_ledger_principal,
            "icp_ledger_principal does not match"
        );

        Ok(())
    }

    pub fn check_invariants(&self) -> Result<(), String> {
        ensure!(
            self.vault_id_to_vaults.len()
                <= self
                    .principal_to_vault_ids
                    .values()
                    .map(|set| set.len())
                    .sum::<usize>(),
            "Inconsistent vault count: {} vaults, {} vault ids",
            self.vault_id_to_vaults.len(),
            self.principal_to_vault_ids
                .values()
                .map(|set| set.len())
                .sum::<usize>(),
        );

        for vault_ids in self.principal_to_vault_ids.values() {
            for vault_id in vault_ids {
                if self.vault_id_to_vaults.get(vault_id).is_none() {
                    panic!("Not all vault ids are in the id -> Vault map.")
                }
            }
        }

        Ok(())
    }
}

#[derive(Debug)]
pub(crate) struct DistributeEntry {
    pub owner: Principal,
    pub icp_share: ICP,
    pub icusd_to_debit: ICUSD,
}

pub(crate) struct DistributeToVaultEntry {
    pub vault_id: u64,
    pub icp_share_amount: ICP,
    pub icusd_share_amount: ICUSD,
}

pub(crate) fn distribute_across_vaults(
    vaults: &BTreeMap<u64, Vault>,
    target_vault: Vault,
) -> Vec<DistributeToVaultEntry> {
    assert!(!vaults.is_empty());

    let target_vault_id = target_vault.vault_id;
    let total_icp_margin: ICP = vaults
        .iter()
        .filter(|&(&vault_id, _vault)| vault_id != target_vault_id)
        .map(|(_vault_id, vault)| vault.icp_margin_amount)
        .sum();
    assert_ne!(total_icp_margin, ICP::new(0));

    let mut result = vec![];
    let mut distributed_icp: ICP = ICP::new(0);
    let mut distributed_icusd: ICUSD = ICUSD::new(0);

    for (vault_id, vault) in vaults {
        if *vault_id != target_vault_id {
            let share: Ratio = vault.icp_margin_amount / total_icp_margin;
            let icp_share = target_vault.icp_margin_amount * share;
            let icusd_share = target_vault.borrowed_icusd_amount * share;
            distributed_icp += icp_share;
            distributed_icusd += icusd_share;
            result.push(DistributeToVaultEntry {
                vault_id: *vault_id,
                icp_share_amount: icp_share,
                icusd_share_amount: icusd_share,
            })
        }
    }

    if !result.is_empty() {
        result[0].icusd_share_amount += target_vault.borrowed_icusd_amount - distributed_icusd;
        result[0].icp_share_amount += target_vault.icp_margin_amount - distributed_icp;
    }

    result
}


fn compute_redemption_fee(
    elapsed_hours: u64,
    redeemed_amount: ICUSD,
    total_borrowed_icusd_amount: ICUSD,
    current_base_rate: Ratio,
) -> Ratio {
    if total_borrowed_icusd_amount == 0 {
        return Ratio::from(Decimal::ZERO);
    }
    const REEDEMED_PROPORTION: Ratio = Ratio::new(dec!(0.5)); // 0.5
    const DECAY_FACTOR: Ratio = Ratio::new(dec!(0.94));

    log!(
        crate::INFO,
        "current_base_rate: {current_base_rate}, elapsed_hours: {elapsed_hours}"
    );

    let rate = current_base_rate * DECAY_FACTOR.pow(elapsed_hours);
    let total_rate = rate + redeemed_amount / total_borrowed_icusd_amount * REEDEMED_PROPORTION;
    debug_assert!(total_rate < Ratio::from(dec!(1.0)));
    total_rate
        .max(Ratio::from(dec!(0.005)))
        .min(Ratio::from(dec!(0.05)))
}



pub fn mutate_state<F, R>(f: F) -> R
where
    F: FnOnce(&mut State) -> R,
{
    __STATE.with(|s| f(s.borrow_mut().as_mut().expect("State not initialized!")))
}

/// Read (part of) the current state using `f`.
///
/// Panics if there is no state.
pub fn read_state<F, R>(f: F) -> R
where
    F: FnOnce(&State) -> R,
{
    __STATE.with(|s| f(s.borrow().as_ref().expect("State not initialized!")))
}

/// Replaces the current state.
pub fn replace_state(state: State) {
    __STATE.with(|s| {
        *s.borrow_mut() = Some(state);
    });
}



#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_distribute_across_vaults() {
        let mut vaults = BTreeMap::new();
        let vault1 = Vault {
            owner: Principal::anonymous(),
            vault_id: 1,
            icp_margin_amount: ICP::new(500_000),
            borrowed_icusd_amount: ICUSD::new(300_000),
        };
        
        let vault2 = Vault {
            owner: Principal::anonymous(),
            vault_id: 2, 
            icp_margin_amount: ICP::new(300_000),
            borrowed_icusd_amount: ICUSD::new(200_000),
        };

        vaults.insert(1, vault1);
        vaults.insert(2, vault2);

        let target_vault = Vault {
            owner: Principal::anonymous(),
            vault_id: 3,
            icp_margin_amount: ICP::new(700_000),
            borrowed_icusd_amount: ICUSD::new(400_000),
        };

        let result = distribute_across_vaults(&vaults, target_vault);

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].icp_share_amount, ICP::new(437_500));
        assert_eq!(result[0].icusd_share_amount, ICUSD::new(250_000));
        assert_eq!(result[1].icp_share_amount, ICP::new(262_500));
        assert_eq!(result[1].icusd_share_amount, ICUSD::new(150_000));
    }
}