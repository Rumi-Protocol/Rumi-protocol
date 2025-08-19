#[cfg(test)]
mod tests {
    use crate::types::*;
    use candid::Principal;

    fn mock_principal() -> Principal {
        Principal::anonymous()
    }

    fn init_test_treasury() {
        let args = TreasuryInitArgs {
            controller: mock_principal(),
            icusd_ledger: mock_principal(),
            icp_ledger: mock_principal(), 
            ckbtc_ledger: Some(mock_principal()),
        };
        crate::state::init_state(args);
    }

    #[test]
    fn test_treasury_initialization() {
        init_test_treasury();
        
        let status = crate::state::with_state(|s| {
            let config = s.get_config();
            let balances = s.balances.iter()
                .map(|(asset_type, balance)| (asset_type.clone(), balance.clone()))
                .collect();

            TreasuryStatus {
                total_deposits: s.get_deposits_count(),
                balances,
                controller: config.controller,
                is_paused: config.is_paused,
            }
        });

        assert_eq!(status.controller, mock_principal());
        assert_eq!(status.is_paused, false);
        assert_eq!(status.total_deposits, 0);
        assert_eq!(status.balances.len(), 3); // ICUSD, ICP, CKBTC
    }

    #[test]
    fn test_deposit_functionality() {
        init_test_treasury();

        let deposit_record = DepositRecord {
            id: 0, // Will be set by add_deposit
            deposit_type: DepositType::MintingFee,
            asset_type: AssetType::ICUSD,
            amount: 1_000_000, // 0.01 icUSD in e8s
            block_index: 12345,
            timestamp: 1234567890,
            memo: Some("Test minting fee".to_string()),
        };

        let deposit_id = crate::state::with_state_mut(|s| s.add_deposit(deposit_record));

        assert_eq!(deposit_id, 1);

        // Check balance was updated
        let balance = crate::state::with_state(|s| 
            s.balances.get(&AssetType::ICUSD).unwrap().clone()
        );
        
        assert_eq!(balance.total, 1_000_000);
        assert_eq!(balance.available, 1_000_000);
        assert_eq!(balance.reserved, 0);
    }

    #[test]
    fn test_withdraw_functionality() {
        init_test_treasury();

        // First add some balance
        let deposit_record = DepositRecord {
            id: 0,
            deposit_type: DepositType::LiquidationSurplus,
            asset_type: AssetType::ICP,
            amount: 5_000_000, // 0.05 ICP in e8s
            block_index: 54321,
            timestamp: 1234567890,
            memo: None,
        };

        crate::state::with_state_mut(|s| s.add_deposit(deposit_record));

        // Now try to withdraw less than available
        let result = crate::state::with_state_mut(|s| 
            s.withdraw(AssetType::ICP, 2_000_000)
        );

        assert!(result.is_ok());

        // Check remaining balance
        let balance = crate::state::with_state(|s| 
            s.balances.get(&AssetType::ICP).unwrap().clone()
        );

        assert_eq!(balance.total, 3_000_000);
        assert_eq!(balance.available, 3_000_000);
    }

    #[test]
    fn test_withdraw_insufficient_funds() {
        init_test_treasury();

        // Try to withdraw from empty treasury
        let result = crate::state::with_state_mut(|s| 
            s.withdraw(AssetType::CKBTC, 1_000_000)
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Insufficient balance"));
    }

    #[test]
    fn test_controller_update() {
        init_test_treasury();

        let new_controller = Principal::from_slice(&[1, 2, 3, 4]);
        
        let result = crate::state::with_state_mut(|s| 
            s.set_controller(new_controller)
        );

        assert!(result.is_ok());

        let config = crate::state::with_state(|s| s.get_config());
        assert_eq!(config.controller, new_controller);
    }

    #[test]
    fn test_pause_functionality() {
        init_test_treasury();

        // Pause treasury
        let result = crate::state::with_state_mut(|s| s.set_paused(true));
        assert!(result.is_ok());

        let config = crate::state::with_state(|s| s.get_config());
        assert_eq!(config.is_paused, true);

        // Unpause treasury
        let result = crate::state::with_state_mut(|s| s.set_paused(false));
        assert!(result.is_ok());

        let config = crate::state::with_state(|s| s.get_config());
        assert_eq!(config.is_paused, false);
    }

    #[test]
    fn test_deposit_history() {
        init_test_treasury();

        // Add multiple deposits
        let deposits = vec![
            DepositRecord {
                id: 0,
                deposit_type: DepositType::MintingFee,
                asset_type: AssetType::ICUSD,
                amount: 1_000_000,
                block_index: 1,
                timestamp: 1000,
                memo: Some("First deposit".to_string()),
            },
            DepositRecord {
                id: 0,
                deposit_type: DepositType::RedemptionFee,
                asset_type: AssetType::ICP,
                amount: 2_000_000,
                block_index: 2,
                timestamp: 2000,
                memo: Some("Second deposit".to_string()),
            },
        ];

        for deposit in deposits {
            crate::state::with_state_mut(|s| s.add_deposit(deposit));
        }

        // Get deposit history
        let history = crate::state::with_state(|s| s.get_deposits(None, 10));
        
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].id, 1);
        assert_eq!(history[1].id, 2);
        assert_eq!(history[0].deposit_type, DepositType::MintingFee);
        assert_eq!(history[1].deposit_type, DepositType::RedemptionFee);
    }
}