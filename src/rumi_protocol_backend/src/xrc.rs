use crate::logs::TRACE_XRC;
use crate::numeric::UsdIcp;  // Changed from UsdBtc
use crate::state::{mutate_state, read_state};
use crate::Decimal;
use crate::Mode;
use ic_canister_log::log;
use ic_xrc_types::GetExchangeRateResult;
use rust_decimal::prelude::FromPrimitive;
use rust_decimal_macros::dec;
use std::time::Duration;

pub const FETCHING_ICP_RATE_INTERVAL: Duration = Duration::from_secs(60);

pub async fn fetch_icp_rate() {
    let _guard = match crate::guard::FetchXrcGuard::new() {
        Some(guard) => guard,
        None => return,
    };

    match crate::management::fetch_icp_price().await {
        Ok(call_result) => match call_result {
            GetExchangeRateResult::Ok(exchange_rate_result) => {
                let rate = Decimal::from_u64(exchange_rate_result.rate).unwrap()
                    / Decimal::from_u64(10_u64.pow(exchange_rate_result.metadata.decimals))
                        .unwrap();
                if rate < dec!(0.01) {  // Changed threshold for ICP
                    log!(
                        TRACE_XRC,
                        "[FetchPrice] Warning: ICP rate is below $0.01 switching to read-only at timestamp: {}",
                        exchange_rate_result.timestamp
                    );
                    mutate_state(|s| s.mode = Mode::ReadOnly);
                };
                log!(
                    TRACE_XRC,
                    "[FetchPrice] fetched new ICP rate: {rate} with timestamp: {}",
                    exchange_rate_result.timestamp
                );
                mutate_state(|s| match s.last_icp_timestamp {
                    Some(last_icp_timestamp) => {
                        if last_icp_timestamp < exchange_rate_result.timestamp * 1_000_000_000 {
                            s.last_icp_rate = Some(UsdIcp::from(rate));
                            s.last_icp_timestamp = 
                                Some(exchange_rate_result.timestamp * 1_000_000_000);
                        }
                    }
                    None => {
                        s.last_icp_rate = Some(UsdIcp::from(rate));
                        s.last_icp_timestamp = Some(exchange_rate_result.timestamp * 1_000_000_000);
                    }
                });
            }
            GetExchangeRateResult::Err(error) => ic_canister_log::log!(
                TRACE_XRC,
                "[FetchPrice] failed to call XRC canister with error: {error:?}"
            ),
        },
        Err(error) => ic_canister_log::log!(
            TRACE_XRC,
            "[FetchPrice] failed to call XRC canister with error: {error}"
        ),
    }
    if let Some(last_icp_rate) = read_state(|s| s.last_icp_rate) {
        mutate_state(|s| s.update_total_collateral_ratio_and_mode(last_icp_rate));
    }
    if read_state(|s| s.mode != crate::Mode::ReadOnly) {
        crate::check_vaults();
    }
}
