use candid::{CandidType, Deserialize, Principal, encode_one};
use ic_xrc_types::{Asset, AssetClass, GetExchangeRateRequest, ExchangeRate};
use std::collections::HashMap;

/// A simple mock implementation for the XRC canister
#[derive(CandidType, Deserialize, Debug, Clone)]
pub struct MockXRC {
    // Map from asset pair to rate (e8s format)
    rates: HashMap<String, u64>,
}

impl Default for MockXRC {
    fn default() -> Self {
        let mut rates = HashMap::new();
        // Use a higher ICP price to ensure the test passes collateral requirements
        rates.insert("ICP/USD".to_string(), 1000000000); // $10.00 to ensure better collateral ratios
        Self { rates }
    }
}

impl MockXRC {
    /// Set the exchange rate for a specific asset pair
    /// Rate in e8s format (e.g., 650000000 = $6.50)
    pub fn set_rate(&mut self, base: &str, quote: &str, rate_e8s: u64) {
        let key = format!("{}/{}", base.to_uppercase(), quote.to_uppercase());
        self.rates.insert(key, rate_e8s);
    }

    /// Get the exchange rate for a pair specified in the request
    pub fn get_exchange_rate(&self, req: GetExchangeRateRequest) -> Result<ExchangeRate, String> {
        let base_symbol = req.base_asset.symbol.to_uppercase();
        let quote_symbol = req.quote_asset.symbol.to_uppercase();
        let key = format!("{}/{}", base_symbol, quote_symbol);
        
        // Default timestamp is now
        let timestamp = req.timestamp.unwrap_or_else(|| 
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs()
        );
        
        if let Some(rate) = self.rates.get(&key) {
            // Return successful result
            Ok(ExchangeRate {
                base_asset: req.base_asset.clone(),
                quote_asset: req.quote_asset.clone(),
                timestamp,
                rate: *rate,
                metadata: ic_xrc_types::ExchangeRateMetadata {
                    decimals: 8,
                    base_asset_num_queried_sources: 1,
                    base_asset_num_received_rates: 1,
                    quote_asset_num_queried_sources: 1,
                    quote_asset_num_received_rates: 1,
                    standard_deviation: 0,
                    forex_timestamp: None,
                },
            })
        } else {
            // Return empty result
            Err("Rate not found".to_string())
        }
    }
}

/// Prepare the mock XRC for installation in a canister
pub fn prepare_mock_xrc() -> Vec<u8> {
    // Create a default mock with predefined rates
    let mut mock = MockXRC::default();
    
    // Use a higher rate for ICP to ensure sufficient collateral
    mock.set_rate("ICP", "USD", 1000000000); // $10.00
    
    // Encode for canister installation
    match encode_one(mock) {
        Ok(bytes) => bytes,
        Err(e) => panic!("Failed to encode mock XRC: {}", e),
    }
}
