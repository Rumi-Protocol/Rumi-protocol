use crate::types::*;
use ic_cdk::caller;

// Core deposit logic
pub fn deposit_icusd(amount: u64) -> DepositResult {
    let user = caller();
    
    // Validate amount
    if amount == 0 {
        return DepositResult {
            success: false,
            new_balance: 0,
            message: "Amount must be greater than 0".to_string(),
        };
    }

    // TODO: Transfer icUSD from user to this canister
    // This would involve calling the ICRC ledger

    DEPOSITS.with(|deposits| {
        let mut deposits = deposits.borrow_mut();
        
        match deposits.get(&user) {
            Some(existing_deposit) => {
                let mut updated_deposit = existing_deposit.clone();
                updated_deposit.icusd_amount += amount;
                deposits.insert(user, updated_deposit.clone());
                
                DepositResult {
                    success: true,
                    new_balance: updated_deposit.icusd_amount,
                    message: "Deposit successful".to_string(),
                }
            }
            None => {
                let new_deposit = UserDeposit {
                    user,
                    icusd_amount: amount,
                    deposit_time: ic_cdk::api::time(),
                    pending_collateral: Vec::new(),
                };
                
                deposits.insert(user, new_deposit.clone());
                
                DepositResult {
                    success: true,
                    new_balance: new_deposit.icusd_amount,
                    message: "First deposit successful".to_string(),
                }
            }
        }
    })
}

// Core withdrawal logic
pub fn withdraw_icusd(amount: u64) -> WithdrawResult {
    let user = caller();
    
    DEPOSITS.with(|deposits| {
        let mut deposits = deposits.borrow_mut();
        
        match deposits.get(&user) {
            Some(deposit) => {
                if deposit.icusd_amount < amount {
                    return WithdrawResult {
                        success: false,
                        remaining_balance: deposit.icusd_amount,
                        message: "Insufficient balance".to_string(),
                    };
                }
                
                let mut updated_deposit = deposit.clone();
                updated_deposit.icusd_amount -= amount;
                
                if updated_deposit.icusd_amount == 0 && updated_deposit.pending_collateral.is_empty() {
                    // Remove empty deposit
                    deposits.remove(&user);
                } else {
                    deposits.insert(user, updated_deposit.clone());
                }
                
                // TODO: Transfer icUSD back to user
                
                WithdrawResult {
                    success: true,
                    remaining_balance: updated_deposit.icusd_amount,
                    message: "Withdrawal successful".to_string(),
                }
            }
            None => WithdrawResult {
                success: false,
                remaining_balance: 0,
                message: "No deposit found".to_string(),
            }
        }
    })
}

// Calculate user's share of liquidation rewards
pub fn calculate_liquidation_share(
    user_icusd: u64,
    total_pool_icusd: u64,
    collateral_amount: u64,
) -> u64 {
    if total_pool_icusd == 0 {
        return 0;
    }
    
    // Use simple integer math to avoid decimal dependency issues
    let user_share = (user_icusd as u128 * collateral_amount as u128) / total_pool_icusd as u128;
    user_share as u64
}

// Process a liquidation and distribute rewards
pub fn process_liquidation(
    vault_id: u64,
    liquidated_debt: u64,
    collateral_received: u64,
    collateral_type: CollateralType,
) -> bool {
    STATE.with(|state| {
        let mut state = state.borrow_mut();
        let liquidation_id = state.next_liquidation_id;
        state.next_liquidation_id += 1;
        
        // Get total pool size
        let total_pool_icusd = get_total_pool_size();
        
        if total_pool_icusd < liquidated_debt {
            return false; // Not enough in pool
        }
        
        // Record the liquidation
        LIQUIDATIONS.with(|liquidations| {
            let mut liquidations = liquidations.borrow_mut();
            let record = LiquidationRecord {
                liquidation_id,
                vault_id,
                liquidated_debt,
                collateral_received,
                collateral_type: collateral_type.clone(),
                liquidation_time: ic_cdk::api::time(),
                pool_size_at_liquidation: total_pool_icusd,
            };
            liquidations.insert(liquidation_id, record);
        });
        
        // Distribute collateral to all depositors
        DEPOSITS.with(|deposits| {
            let mut deposits = deposits.borrow_mut();
            let all_deposits: Vec<_> = deposits.iter().map(|(k, v)| (*k, v.clone())).collect();
            
            for (user, deposit) in all_deposits {
                let mut updated_deposit = deposit.clone();
                
                // Calculate this user's share
                let user_share = calculate_liquidation_share(
                    deposit.icusd_amount,
                    total_pool_icusd,
                    collateral_received,
                );
                
                if user_share > 0 {
                    let reward = CollateralReward {
                        collateral_type: collateral_type.clone(),
                        amount: user_share,
                        liquidation_id,
                    };
                    updated_deposit.pending_collateral.push(reward);
                }
                
                // Reduce their icUSD proportionally
                let icusd_used = calculate_liquidation_share(
                    deposit.icusd_amount,
                    total_pool_icusd,
                    liquidated_debt,
                );
                updated_deposit.icusd_amount = updated_deposit.icusd_amount.saturating_sub(icusd_used);
                
                deposits.insert(user, updated_deposit);
            }
        });
        
        true
    })
}

// Get total icUSD in the pool
pub fn get_total_pool_size() -> u64 {
    DEPOSITS.with(|deposits| {
        deposits
            .borrow()
            .values()
            .map(|deposit| deposit.icusd_amount)
            .sum()
    })
}

// Claim collateral rewards
pub fn claim_collateral(liquidation_ids: Vec<u64>) -> ClaimResult {
    let user = caller();
    
    DEPOSITS.with(|deposits| {
        let mut deposits = deposits.borrow_mut();
        
        match deposits.get(&user) {
            Some(deposit) => {
                let mut updated_deposit = deposit.clone();
                let mut claimed_rewards = Vec::new();
                let mut remaining_collateral = Vec::new();
                
                for reward in updated_deposit.pending_collateral.iter() {
                    if liquidation_ids.contains(&reward.liquidation_id) {
                        claimed_rewards.push(reward.clone());
                    } else {
                        remaining_collateral.push(reward.clone());
                    }
                }
                
                if claimed_rewards.is_empty() {
                    return ClaimResult {
                        success: false,
                        claimed_collateral: Vec::new(),
                        message: "No claimable collateral found".to_string(),
                    };
                }
                
                updated_deposit.pending_collateral = remaining_collateral;
                deposits.insert(user, updated_deposit);
                
                // TODO: Transfer actual collateral tokens to user
                
                ClaimResult {
                    success: true,
                    claimed_collateral: claimed_rewards,
                    message: "Collateral claimed successfully".to_string(),
                }
            }
            None => ClaimResult {
                success: false,
                claimed_collateral: Vec::new(),
                message: "No deposit found".to_string(),
            }
        }
    })
}