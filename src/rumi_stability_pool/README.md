# Rumi Stability Pool

The Rumi Stability Pool is an automated liquidation system that allows users to deposit icUSD and earn liquidation rewards in the form of discounted collateral.

## How It Works

1. **Deposits**: Users deposit icUSD into the stability pool
2. **Liquidations**: When vaults become undercollateralized, the protocol automatically liquidates them using icUSD from the pool
3. **Rewards**: Users earn collateral from liquidated vaults at a discount (e.g., 10% below market value)
4. **Proportional Distribution**: Rewards are distributed proportionally based on each user's share of the pool

## Core Features

### User Functions
- `deposit(amount: u64)` - Deposit icUSD into the pool
- `withdraw(amount: u64)` - Withdraw icUSD from the pool
- `claim_collateral_rewards(liquidation_ids: Vec<u64>)` - Claim earned collateral rewards
- `get_user_deposit()` - Query user's current deposit and pending rewards

### Query Functions
- `get_total_pool_info()` - Get total pool statistics
- `get_liquidation_history(limit: Option<u64>)` - View recent liquidations
- `get_pool_state()` - Get current pool configuration

### Admin Functions
- `execute_liquidation(...)` - Execute a liquidation (called by protocol backend)
- `pause_protocol()` / `unpause_protocol()` - Emergency controls
- `update_liquidation_discount(new_discount: u8)` - Adjust liquidation discount

## Smart Contract Architecture

### Data Structures

#### UserDeposit
```rust
struct UserDeposit {
    user: Principal,
    icusd_amount: u64,
    deposit_time: u64,
    pending_collateral: Vec<CollateralReward>,
}
```

#### LiquidationRecord
```rust
struct LiquidationRecord {
    liquidation_id: u64,
    vault_id: u64,
    liquidated_debt: u64,
    collateral_received: u64,
    collateral_type: CollateralType,
    liquidation_time: u64,
    pool_size_at_liquidation: u64,
}
```

#### CollateralReward
```rust
struct CollateralReward {
    collateral_type: CollateralType,
    amount: u64,
    liquidation_id: u64,
}
```

## Example Workflow

1. Alice deposits 1000 icUSD into the stability pool
2. Bob deposits 3000 icUSD into the stability pool
3. Total pool: 4000 icUSD (Alice: 25%, Bob: 75%)
4. A vault with 2000 icUSD debt and 1 ICP collateral (worth 2200 icUSD) gets liquidated
5. The pool uses 2000 icUSD to liquidate the vault and receives 1 ICP
6. Alice receives 0.25 ICP, Bob receives 0.75 ICP
7. Alice's icUSD balance reduces to 500, Bob's reduces to 2250
8. Both users can claim their ICP rewards

## Security Features

- **Pausable**: Admin can pause all operations in emergencies
- **Authorization**: Only protocol backend can execute liquidations
- **Bounds Checking**: All calculations include overflow protection
- **Proportional Distribution**: Fair distribution based on deposit ratios

## Integration

The stability pool integrates with the main Rumi Protocol backend:

1. **Vault Monitoring**: The backend monitors vault health
2. **Liquidation Trigger**: When a vault becomes unhealthy, backend calls `execute_liquidation`
3. **Asset Transfer**: Backend handles actual token transfers
4. **Reward Distribution**: Pool calculates and tracks user rewards

## Configuration

- **Liquidation Discount**: 10% (configurable by admin)
- **Max LTV Ratio**: 66% (reference for liquidation threshold)
- **Supported Collateral**: ICP, ckBTC

## Deployment

The stability pool is configured in `dfx.json` and can be deployed alongside other protocol canisters:

```bash
dfx deploy rumi_stability_pool --argument '(record { 
  protocol_owner = principal "your-principal-here"; 
  liquidation_discount = 10; 
  max_ltv_ratio = 66; 
})'
```

## Future Enhancements

1. **Stable Storage**: Migrate from HashMap to stable structures for persistence
2. **Token Integration**: Add actual ICRC token transfers
3. **Yield Distribution**: Add additional yield mechanisms
4. **Governance**: Add DAO governance for parameter updates
5. **Multi-Asset Support**: Expand to support more collateral types

## Safety Considerations

- This is a basic implementation for demonstration
- Production deployment requires:
  - Comprehensive testing
  - Security audits
  - Stable storage implementation
  - Proper access controls
  - Integration testing with live tokens