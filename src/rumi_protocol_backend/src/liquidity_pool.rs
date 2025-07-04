use crate::event::{
    record_claim_liquidity_returns, record_provide_liquidity, record_withdraw_liquidity,
};
use crate::guard::GuardPrincipal;
use crate::logs::INFO;
use crate::management::{mint_icusd, transfer_icusd_from, transfer_icp};
use crate::{mutate_state, read_state, ProtocolError, ICP, MIN_LIQUIDITY_AMOUNT, ICUSD};
use ic_canister_log::log;
use icrc_ledger_types::icrc1::transfer::TransferError;

pub async fn provide_liquidity(amount: u64) -> Result<u64, ProtocolError> {
    let caller = ic_cdk::api::caller();
    let _guard_principal = GuardPrincipal::new(caller, "provide_liquidity")?;

    let amount: ICUSD = amount.into();

    if amount < MIN_LIQUIDITY_AMOUNT {
        return Err(ProtocolError::AmountTooLow {
            minimum_amount: MIN_LIQUIDITY_AMOUNT.to_u64(),
        });
    }

    match transfer_icusd_from(amount, caller).await {
        Ok(block_index) => {
            log!(INFO, "[provide_liquidity] {caller} provided {amount}",);
            mutate_state(|s| {
                record_provide_liquidity(s, amount, caller, block_index);
            });
            Ok(block_index)
        }
        Err(transfer_from_error) => Err(ProtocolError::TransferFromError(
            transfer_from_error,
            amount.to_u64(),
        )),
    }
}

pub async fn withdraw_liquidity(amount: u64) -> Result<u64, ProtocolError> {
    let caller = ic_cdk::caller();
    let _guard_principal = GuardPrincipal::new(caller, "withdraw_liquidity")?;

    let amount: ICUSD = amount.into();

    if amount < MIN_LIQUIDITY_AMOUNT {
        return Err(ProtocolError::AmountTooLow {
            minimum_amount: MIN_LIQUIDITY_AMOUNT.to_u64(),
        });
    }

    let provided_liquidity = read_state(|s| {
        s.liquidity_pool
            .get(&caller)
            .cloned()
            .expect("no provided liquidity")
    });
    if amount > provided_liquidity {
        return Err(ProtocolError::GenericError(format!(
            "cannot withdraw: {amount}, provided: {provided_liquidity}"
        )));
    }

    match mint_icusd(amount, caller).await {
        Ok(block_index) => {
            log!(INFO, "[withdraw_liquidity] {caller} withdrew {amount}",);
            mutate_state(|s| {
                record_withdraw_liquidity(s, amount, caller, block_index);
            });
            Ok(block_index)
        }
        Err(transfer_error) => Err(ProtocolError::TransferError(transfer_error)),
    }
}

pub async fn claim_liquidity_returns() -> Result<u64, ProtocolError> {
    let caller = ic_cdk::caller();
    let _guard_principal = GuardPrincipal::new(caller, "claim_liquidity_returns")?;

    let return_amount = read_state(|s| *s.liquidity_returns.get(&caller).expect("No reward"));

    match transfer_icp(return_amount, caller).await {
        Ok(block_index) => {
            log!(
                INFO,
                "[claim_liquidity_returns] {caller} claimed {return_amount}",
            );
            mutate_state(|s| {
                record_claim_liquidity_returns(s, return_amount, caller, block_index);
            });
            Ok(block_index)
        }
        Err(transfer_error) => {
            if let TransferError::BadFee { expected_fee } = transfer_error.clone() {
                mutate_state(|s| {
                    let expected_fee: u64 = expected_fee
                        .0
                        .try_into()
                        .expect("failed to convert Nat to u64");
                    s.icp_ledger_fee = ICP::from(expected_fee);
                });
            };
            Err(ProtocolError::TransferError(transfer_error))
        }
    }
}
