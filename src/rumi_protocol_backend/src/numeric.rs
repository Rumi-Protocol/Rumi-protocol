use candid::types::TypeInner;
use candid::{CandidType, Deserialize, Nat};
use rust_decimal::prelude::{FromPrimitive, ToPrimitive};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::{de::Deserializer, Serialize, Serializer};
use std::cmp::Ordering;
use std::fmt;
use std::iter::Sum;
use std::marker::PhantomData;
use std::ops::{Add, AddAssign, Div, Mul, Sub, SubAssign};

#[cfg(test)]
mod tests;

const E8S: u64 = 100_000_000;
const ICUSD_DEC: u64 = 100_000_000; 


#[derive(PartialEq, Eq, Debug, Ord, PartialOrd, Clone, Copy)]
pub struct Amount<T>(pub Decimal, pub PhantomData<T>);

impl<T> Serialize for Amount<T> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_bytes(&self.0.serialize())
    }
}

impl<'de, T> Deserialize<'de> for Amount<T>
where
    T: Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let array: [u8; 16] = Deserialize::deserialize(deserializer)?;
        Ok(Amount(Decimal::deserialize(array), PhantomData))
    }
}

impl<T> CandidType for Amount<T> {
    fn _ty() -> candid::types::Type {
        TypeInner::Vec(TypeInner::Nat8.into()).into()
    }

    fn idl_serialize<S>(&self, serializer: S) -> Result<(), S::Error>
    where
        S: candid::types::Serializer,
    {
        serializer.serialize_blob(&self.to_array())
    }
}

impl<T> Amount<T> {
    pub fn to_f64(self) -> f64 {
        self.0.to_f64().unwrap()
    }

    pub fn to_array(&self) -> [u8; 16] {
        self.0.serialize()
    }
}

#[derive(PartialEq, Eq, Debug, Ord, PartialOrd, Clone, Copy)]
pub struct Token<T>(pub u64, pub PhantomData<T>);

impl<T> Serialize for Token<T> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u64(self.0)
    }
}

impl<'de, T> Deserialize<'de> for Token<T>
where
    T: Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value: u64 = Deserialize::deserialize(deserializer)?;
        Ok(Token(value, PhantomData))
    }
}

impl<T> CandidType for Token<T> {
    fn _ty() -> candid::types::Type {
        candid::types::TypeInner::Nat64.into()
    }

    fn idl_serialize<S>(&self, serializer: S) -> Result<(), S::Error>
    where
        S: candid::types::Serializer,
    {
        serializer.serialize_nat64(self.0)
    }
}

impl<T> Token<T> {
    pub fn to_u64(self) -> u64 {
        self.0
    }

    pub fn to_nat(self) -> Nat {
        Nat::from(self.0)
    }

    pub fn saturating_sub(self, other: Token<T>) -> Token<T> {
        if other.0 > self.0 {
            return Token::<T>(0, PhantomData::<T>);
        }
        Token::<T>(self.0 - other.0, PhantomData::<T>)
    }
}

impl<T> PartialOrd<u64> for Token<T> {
    fn partial_cmp(&self, &other: &u64) -> Option<Ordering> {
        self.0.partial_cmp(&other)
    }
}

impl<T> PartialEq<u64> for Token<T> {
    fn eq(&self, &other: &u64) -> bool {
        self.0 == other
    }
}

impl<T> PartialEq<Token<T>> for u64 {
    fn eq(&self, other: &Token<T>) -> bool {
        *self == other.0
    }
}


// Keep enums instead of structs
#[derive(PartialEq, Eq, Debug, Ord, PartialOrd, Serialize, Deserialize, Clone, Copy)]
pub enum IcusdTag {}

#[derive(PartialEq, Eq, Debug, Ord, PartialOrd, Serialize, Deserialize, Clone, Copy)]
pub enum IcpTag {}

#[derive(PartialEq, Eq, Debug, Ord, PartialOrd, Serialize, Deserialize, Clone, Copy)]
pub enum UsdIcpTag {}

#[derive(PartialEq, Eq, Debug, Ord, PartialOrd, Serialize, Deserialize, Clone, Copy)]
pub enum RatioTag {}

// Type definitions using enum tags
pub type ICUSD = Token<IcusdTag>;    // Integer token amounts
pub type ICP = Token<IcpTag>;        // Integer token amounts
pub type UsdIcp = Amount<UsdIcpTag>; // Decimal exchange rate
pub type Ratio = Amount<RatioTag>;   // Decimal ratios



impl<T> Sum for Token<T> {
    fn sum<I>(iter: I) -> Self
    where
        I: Iterator<Item = Token<T>>,
    {
        iter.fold(Token::<T>(0, PhantomData::<T>), |acc, x| acc + x)
    }
}

impl<T> Sub for Token<T> {
    type Output = Token<T>;

    fn sub(self, rhs: Token<T>) -> Token<T> {
        if rhs.0 > self.0 {
            panic!("underflow")
        }
        Token(self.0 - rhs.0, PhantomData)
    }
}

impl Sub for Ratio {
    type Output = Ratio;

    fn sub(self, rhs: Ratio) -> Self::Output {
        if rhs.0 > self.0 {
            panic!("underflow")
        }
        Ratio::from(self.0 - rhs.0)
    }
}

impl<T> Add for Token<T> {
    type Output = Token<T>;

    fn add(self, rhs: Token<T>) -> Token<T> {
        Token(self.0 + rhs.0, PhantomData)
    }
}

impl<T> Add for Amount<T> {
    type Output = Amount<T>;

    fn add(self, rhs: Amount<T>) -> Amount<T> {
        Amount(self.0 + rhs.0, PhantomData)
    }
}

impl From<u64> for ICP {
    fn from(value: u64) -> Self {
        Token(value, PhantomData::<IcpTag>)
    }
}

impl From<u64> for ICUSD {
    fn from(value: u64) -> Self {
        Token(value, PhantomData::<IcusdTag>)
    }
}


impl ICUSD {
    pub const fn new(value: u64) -> Self {
        Token(value, PhantomData::<IcusdTag>)
    }
}

impl ICP {
    pub const fn new(value: u64) -> Self {
        Token(value, PhantomData::<IcpTag>)
    }
}

impl UsdIcp {
    pub const fn new(value: Decimal) -> Self {
        Amount(value, PhantomData::<UsdIcpTag>)
    }

    pub fn to_e8s(self) -> u64 {
        (self.0 * dec!(100_000_000)).to_u64().unwrap()
    }

    pub fn serialize(self) -> [u8; 16] {
        self.0.serialize()
    }

    pub fn deserialize(array: [u8; 16]) -> Self {
        UsdIcp::new(Decimal::deserialize(array))
    }
}

impl From<Decimal> for UsdIcp {
    fn from(value: Decimal) -> Self {
        Amount(value, PhantomData::<UsdIcpTag>)
    }
}


impl Ratio {
    pub const fn new(value: Decimal) -> Self {
        Amount(value, PhantomData::<RatioTag>)
    }

    pub fn pow(self, rhs: u64) -> Self {
        if rhs == 0 {
            return Amount(Decimal::ONE, PhantomData::<RatioTag>); 
        }
        let mut result = Decimal::ONE;
        for _ in 0..rhs {
            result *= self.0;
        }
        Amount(result, PhantomData::<RatioTag>) 
    }
}

impl From<Decimal> for Ratio {
    fn from(value: Decimal) -> Self {
        Amount(value, PhantomData::<RatioTag>)
    }
}

// Add From<ICP> for ICUSD conversion
impl From<ICP> for ICUSD {
    fn from(value: ICP) -> Self {
        Token(value.0, PhantomData::<IcusdTag>)
    }
}

// Add Mul<UsdIcp> for ICUSD
impl Mul<UsdIcp> for ICUSD {
    type Output = ICP;
    fn mul(self, other: UsdIcp) -> ICP {
        let icusd_dec = Decimal::from_u64(self.0).expect("failed to construct decimal from u64")
            / dec!(100_000_000);
        let result = icusd_dec * other.0;
        let result_e8s = result * dec!(100_000_000);
        Token(
            result_e8s.to_u64().expect("failed to cast decimal as u64"),
            PhantomData::<IcpTag>,
        )
    }
}

// Add AddAssign for Amount<T>
impl<T> AddAssign for Amount<T> {
    fn add_assign(&mut self, rhs: Amount<T>) {
        self.0 += rhs.0;
    }
}

// Add SubAssign for Amount<T>
impl<T> SubAssign for Amount<T> {
    fn sub_assign(&mut self, rhs: Amount<T>) {
        self.0 -= rhs.0;
    }
}


impl Mul<UsdIcp> for ICP {
    type Output = ICUSD;

    fn mul(self, other: UsdIcp) -> ICUSD {
        let icp_dec = Decimal::from_u64(self.0).expect("failed to construct decimal from u64")
            / dec!(100_000_000);
        let result = icp_dec * other.0;
        let result_e8s = result * dec!(100_000_000);
        Token(
            result_e8s.to_u64().expect("failed to cast decimal as u64"),
            PhantomData::<IcusdTag>,
        )
    }
}

impl<T> Mul<Ratio> for Token<T> {
    type Output = Token<T>;

    fn mul(self, other: Ratio) -> Token<T> {
        let icp_dec = Decimal::from_u64(self.0).expect("failed to construct decimal from u64")
            / dec!(100_000_000);
        let result = icp_dec * other.0;
        let result_e8s = result * dec!(100_000_000);
        Token(
            result_e8s.to_u64().expect("failed to cast decimal as u64"),
            PhantomData::<T>,
        )
    }
}

impl<T> AddAssign for Token<T> {
    fn add_assign(&mut self, rhs: Token<T>) {
        self.0 += rhs.0;
    }
}

impl<T> SubAssign for Token<T> {
    fn sub_assign(&mut self, rhs: Token<T>) {
        assert!(self.0 >= rhs.0);
        self.0 -= rhs.0;
    }
}

impl Mul<Ratio> for Ratio {
    type Output = Ratio;
    fn mul(self, other: Ratio) -> Ratio {
        let result = self.0 * other.0;
        Amount(result, PhantomData::<RatioTag>) 
    }
}

impl Div<UsdIcp> for ICUSD {
    type Output = ICP;
    fn div(self, other: UsdIcp) -> ICP {
        assert_ne!(other.0, Decimal::ZERO);
        let icusd_dec = Decimal::from_u64(self.0).unwrap() / dec!(100_000_000);
        let result = (icusd_dec / other.0) * dec!(100_000_000);
        Token::<IcpTag>(result.to_u64().unwrap(), PhantomData)
    }
}

impl Div<ICUSD> for ICUSD {
    type Output = Ratio;
    fn div(self, other: ICUSD) -> Ratio {
        assert_ne!(other.0, 0, "cannot divide {} by 0", self.0);
        let icusd_dec = Decimal::from_u64(self.0).unwrap();
        let div_by = Decimal::from_u64(other.0).unwrap();
        Amount::<RatioTag>(icusd_dec / div_by, PhantomData)
    }
}



impl Div<Ratio> for ICUSD {
    type Output = ICUSD;
    fn div(self, other: Ratio) -> ICUSD {
        assert_ne!(other.0, Decimal::ZERO, "cannot divide {} by 0", self.0);
        let icusd_dec = Decimal::from_u64(self.0).unwrap() / Decimal::from_u64(ICUSD_DEC).unwrap();
        let result = (icusd_dec / other.0) * Decimal::from_u64(ICUSD_DEC).unwrap();
        Token::<IcusdTag>(result.to_u64().unwrap(), PhantomData) 
    }
}

impl Div<Ratio> for UsdIcp {
    type Output = UsdIcp;
    fn div(self, other: Ratio) -> UsdIcp {
        assert_ne!(other.0, Decimal::ZERO);
        Amount::<UsdIcpTag>(self.0 / other.0, PhantomData::<UsdIcpTag>)
    }
}


impl Div<ICP> for ICP {
    type Output = Ratio;
    fn div(self, other: ICP) -> Ratio {
        assert_ne!(other.0, 0, "cannot divide {} by 0", self.0);
        let icp_dec = Decimal::from_u64(self.0).unwrap();
        let div_by = Decimal::from_u64(other.0).unwrap();
        Amount::<RatioTag>(icp_dec / div_by, PhantomData) 
    }
}

impl<T> fmt::Display for Token<T> {
    fn fmt(&self, fmt: &mut fmt::Formatter<'_>) -> fmt::Result {
        let int = self.0 / E8S;
        let frac = self.0 % E8S;

        if frac > 0 {
            let frac_width: usize = {
                // Count decimal digits in the fraction part.
                let mut d = 0;
                let mut x = frac;
                while x > 0 {
                    d += 1;
                    x /= 10;
                }
                d
            };
            debug_assert!(frac_width <= 8);
            let frac_prefix: u64 = {
                // The fraction part without trailing zeros.
                let mut f = frac;
                while f % 10 == 0 {
                    f /= 10
                }
                f
            };

            write!(fmt, "{}.", int)?;
            for _ in 0..(8 - frac_width) {
                write!(fmt, "0")?;
            }
            write!(fmt, "{}", frac_prefix)
        } else {
            write!(fmt, "{}.0", int)
        }
    }
}

impl<T> fmt::Display for Amount<T> {
    fn fmt(&self, fmt: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(fmt, "{}", self.0)
    }
}
