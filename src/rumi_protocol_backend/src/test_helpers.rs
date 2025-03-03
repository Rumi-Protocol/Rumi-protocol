//! Helper functions for testing purposes.
//! These functions should only be available in test builds.

use candid::{candid_method, Principal};
use ic_cdk_macros::update;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use num_traits::FromPrimitive; // Add this import for from_u64

use crate::logs::INFO;
use crate::numeric::UsdIcp;
use crate::state::mutate_state;
use ic_canister_log::log;

/// Set the ICP price directly for testing.
/// This method is only intended for use in tests.
#[cfg(any(test, feature = "test_endpoints"))]
#[candid_method(update)]
#[update]
pub fn test_set_icp_price_e8s(price_e8s: u64) {
    // Only management canister or self can call this method
    let caller = ic_cdk::caller();
    if caller != ic_cdk::id() && 
       caller != Principal::management_canister() && // Fix: use imported Principal
       caller.to_text() != "aaaaa-aa" {
        ic_cdk::trap("Only management canister or self can call test methods");
    }
    
    log!(INFO, "[test_set_icp_price_e8s] Setting ICP price to {}", price_e8s);
    
    // Convert e8s to decimal (e.g., 650000000 -> $6.50)
    let price_decimal = Decimal::from_u64(price_e8s).unwrap_or(dec!(0)) / dec!(100_000_000);
    let icp_rate = UsdIcp::from(price_decimal);
    
    mutate_state(|s| {
        s.last_icp_rate = Some(icp_rate);
        s.last_icp_timestamp = Some(ic_cdk::api::time() / 1_000_000_000); // Fix: wrap in Some()
    });
}

/// Alternative name for setting the ICP price in tests
#[cfg(any(test, feature = "test_endpoints"))]
#[candid_method(update)]
#[update]
pub fn set_test_icp_rate(price_e8s: u64) {
    test_set_icp_price_e8s(price_e8s)
}
