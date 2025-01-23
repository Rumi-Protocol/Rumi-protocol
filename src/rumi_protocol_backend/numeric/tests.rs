use crate::numeric::{Ratio, UsdIcp, ICP, E8S, ICUSD};
use rust_decimal_macros::dec;

#[test]
fn icp_mul_by_usdicp_available() {
    let ICP_token: ICP = 100_000_000_u64.into();
    let rate_amount: UsdIcp = dec!(20_000.0).into();
    assert_eq!(ICP_token * rate_amount, ICUSD::from(20_000 * E8S));
}

#[test]
fn ICP_mul_by_ratio() {
    let ICP_token: ICP = 100_000_000_u64.into();
    let ratio_amount: Ratio = dec!(0.5).into();
    assert_eq!(ICP_token * ratio_amount, ICP::from(50_000_000));
}

#[test]
fn ICP_mul_by_0() {
    let ICP_token: ICP = 100_000_000_u64.into();
    let ratio_amount: Ratio = dec!(0.0).into();
    assert_eq!(ICP_token * ratio_amount, ICP::from(0));
}

#[test]
fn ratio_mul_by_0() {
    let ICP_token: ICP = 0_u64.into();
    let ratio_amount: Ratio = dec!(1.0).into();
    assert_eq!(ICP_token * ratio_amount, ICP::from(0));
}

#[test]
fn tal_mul_by_ratio() {
    let tal_token: ICUSD = 100_u64.into();
    let ratio: Ratio = dec!(0.5).into();
    assert_eq!(tal_token * ratio, ICUSD::from(50_u64));
}

#[test]
fn tal_div_by_usdicp() {
    let rate: UsdIcp = dec!(1000).into();
    let icusd: ICUSD = (100 * 100_000_000).into();
    let result = icusd / rate;
    assert_eq!(ICP::from(10_000_000), result);
}
