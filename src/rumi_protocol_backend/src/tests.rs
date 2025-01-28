use crate::Vault;
use crate::{ICP, ICUSD};
use candid::Principal;
use ic_base_types::PrincipalId;
use proptest::prelude::*;
use std::collections::BTreeMap;

fn arb_vault() -> impl Strategy<Value = Vault> {
    (arb_principal(), any::<u64>(), arb_amount()).prop_map(|(owner, borrowed_icusd, icp_margin)| {
        Vault {
            owner,
            borrowed_icusd_amount: ICUSD::from(borrowed_icusd),
            icp_margin_amount: ICP::from(icp_margin.max(1_000_000)),
            vault_id: 0,
        }
    })
}

fn arb_principal() -> impl Strategy<Value = Principal> {
    (pvec(any::<u8>(), 32)).prop_map(|pk| PrincipalId::new_self_authenticating(&pk).0)
}

fn arb_usd_amount() -> impl Strategy<Value = ICUSD> {
    arb_amount().prop_map(|a| ICUSD::from(a))
}

fn arb_amount() -> impl Strategy<Value = u64> {
    1..21_000_000_00_000_000_u64
}

proptest! {
    #[test]
    fn test_vault_distribution(
        vaults_vec in pvec(arb_vault(), 1..10),
        target_borrowed_icusd in any::<u64>(),
        target_icp_margin in arb_amount(),
    ) {
        let vaults = vault_vec_to_map(vaults_vec);
        let sum_icp_margin: ICP = vaults.values().map(|v| v.icp_margin_amount).sum();
        
        let target_vault = Vault {
            owner: Principal::anonymous(),
            borrowed_icusd_amount: ICUSD::from(target_borrowed_icusd),
            icp_margin_amount: ICP::from(target_icp_margin),
            vault_id: vaults.last_key_value().unwrap().1.vault_id + 1,
        };

        prop_assert!(sum_icp_margin >= target_vault.icp_margin_amount);
        
        let result = crate::state::distribute_accross_vaults(&vaults, target_vault);
        let icusd_distributed: ICUSD = result.iter().map(|e| e.icusd_share_amount).sum();
        let icp_distributed: ICP = result.iter().map(|e| e.icp_share_amount).sum();
        
        assert_eq!(icusd_distributed, ICUSD::from(target_borrowed_icusd));
        assert_eq!(icp_distributed, ICP::from(target_icp_margin));
    }
}
