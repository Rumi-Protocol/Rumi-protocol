use candid::{candid_method, Principal};
use ic_canister_log::log;
use ic_canisters_http_types::{HttpRequest, HttpResponse, HttpResponseBuilder};
use ic_cdk_macros::{init, post_upgrade, query, update};
use rumi_protocol_backend::{
    event::Event,
    logs::INFO,
    numeric::{ICUSD, UsdIcp, Ratio},
    state::{read_state, replace_state, Mode, State},
    vault::{CandidVault, OpenVaultSuccess, VaultArg},
    Fees, GetEventsArg, ProtocolArg, ProtocolError, ProtocolStatus, SuccessWithFee,
};
use rumi_protocol_backend::logs::DEBUG;
use rumi_protocol_backend::state::mutate_state;
use rumi_protocol_backend::management;
use rumi_protocol_backend::event;
use rust_decimal::prelude::FromPrimitive;
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use rumi_protocol_backend::storage::events;
use rumi_protocol_backend::LiquidityStatus;
use candid_parser::utils::CandidSource;
use candid_parser::utils::service_equal;

// Stability Pool Integration Types
#[derive(candid::CandidType, serde::Deserialize, Clone, Debug)]
pub struct StabilityPoolLiquidationResult {
    pub success: bool,
    pub vault_id: u64,
    pub liquidated_debt: u64,
    pub collateral_received: u64,
    pub collateral_type: String,
    pub block_index: u64,
    pub fee: u64,
}

#[derive(candid::CandidType, serde::Deserialize, Clone, Debug)]
pub struct StabilityPoolConfig {
    pub stability_pool_canister: Option<Principal>,
    pub liquidation_discount: u8,
    pub enabled: bool,
}

#[cfg(feature = "self_check")]
fn ok_or_die(result: Result<(), String>) {
    if let Err(msg) = result {
        ic_cdk::println!("{}", msg);
        ic_cdk::trap(&msg);
    }
}

/// Checks that Elliptic Core Canister state is internally consistent.
#[cfg(feature = "self_check")]
fn check_invariants() -> Result<(), String> {
    use protocol_canister::event::replay;

    read_state(|s| {
        s.check_invariants()?;

        let events: Vec<_> = protocol_canister::storage::events().collect();
        let recovered_state = replay(events.clone().into_iter())
            .unwrap_or_else(|e| panic!("failed to replay log {:?}: {:?}", events, e));

        recovered_state.check_invariants()?;

        // A running timer can temporarily violate invariants.
        if (!s.is_timer_running) {
            s.check_semantically_eq(&recovered_state)?;
        }

        Ok(())
    })
}

fn check_postcondition<T>(t: T) -> T {
    #[cfg(feature = "self_check")]
    ok_or_die(check_invariants());
    t
}

fn validate_call() -> Result<(), ProtocolError> {
    if ic_cdk::caller() == Principal::anonymous() {
        return Err(ProtocolError::AnonymousCallerNotAllowed);
    }
    read_state(|s| s.check_price_not_too_old())
}

fn validate_mode() -> Result<(), ProtocolError> {
    match read_state(|s| s.mode) {
        Mode::ReadOnly => {
            Err(ProtocolError::TemporarilyUnavailable(
                "protocol temporarly unavailable, please wait for an upgrade or for total collateral ratio to go above 100%".to_string(),
            ))
        }
        Mode::GeneralAvailability => Ok(()),
        Mode::Recovery => Ok(())
    }
}

fn setup_timers() {
    ic_cdk_timers::set_timer_interval(rumi_protocol_backend::xrc::FETCHING_ICP_RATE_INTERVAL, || {
        ic_cdk::spawn(rumi_protocol_backend::xrc::fetch_icp_rate())
    });
}

fn main() {}

#[candid_method(init)]
#[init]
fn init(arg: ProtocolArg) {
    match arg {
        ProtocolArg::Init(init_arg) => {
            log!(
                INFO,
                "[init] initialized Rumi Protocol with args: {:?}",
                init_arg
            );
            rumi_protocol_backend::storage::record_event(&Event::Init(init_arg.clone()));
            replace_state(State::from(init_arg));
        }
        ProtocolArg::Upgrade(_) => ic_cdk::trap("expected Init got Upgrade"),
    }
    setup_timers();
}

#[post_upgrade]
fn post_upgrade(arg: ProtocolArg) {
    use rumi_protocol_backend::event::replay;
    use rumi_protocol_backend::storage::{count_events, events, record_event};

    let start = ic_cdk::api::instruction_counter();

    log!(INFO, "[upgrade]: replaying {} events", count_events());

    match arg {
        ProtocolArg::Init(_) => ic_cdk::trap("expected Upgrade got Init"),
        ProtocolArg::Upgrade(upgrade_args) => {
            log!(
                INFO,
                "[upgrade]: updating configuration with {:?}",
                upgrade_args
            );
            record_event(&Event::Upgrade(upgrade_args));
        }
    }

    let state = replay(events()).unwrap_or_else(|e| {
        ic_cdk::trap(&format!(
            "[upgrade]: failed to replay the event log: {:?}",
            e
        ))
    });

    replace_state(state);

    let end = ic_cdk::api::instruction_counter();

    log!(
        INFO,
        "[upgrade]: replaying events consumed {} instructions",
        end - start
    );

    setup_timers();
}

#[candid_method(query)]
#[query]
fn get_protocol_status() -> ProtocolStatus {
    read_state(|s| ProtocolStatus {
        last_icp_rate: s
            .last_icp_rate
            .unwrap_or(UsdIcp::from(Decimal::ZERO))
            .to_f64(),
        last_icp_timestamp: s.last_icp_timestamp.unwrap_or(0),
        total_icp_margin: s.total_icp_margin_amount().to_u64(),
        total_icusd_borrowed: s.total_borrowed_icusd_amount().to_u64(),
        total_collateral_ratio: s.total_collateral_ratio.to_f64(),
        mode: s.mode,
    })
}

#[candid_method(query)]
#[query]
fn get_fees(redeemed_amount: u64) -> Fees {
    read_state(|s| Fees {
        borrowing_fee: s.get_borrowing_fee().to_f64(),
        redemption_fee: s.get_redemption_fee(redeemed_amount.into()).to_f64(),
    })
}

#[candid_method(query)]
#[query]
fn get_vault_history(vault_id: u64) -> Vec<Event> {
    if ic_cdk::api::data_certificate().is_none() {
        ic_cdk::trap("update call rejected");
    }

    let mut vault_events: Vec<Event> = vec![];
    for event in events() {
        if event.is_vault_related(&vault_id) {
            vault_events.push(event);
        }
    }
    vault_events
}

#[candid_method(query)]
#[query]
fn get_events(args: GetEventsArg) -> Vec<Event> {
    if ic_cdk::api::data_certificate().is_none() {
        ic_cdk::trap("update call rejected");
    }
    const MAX_EVENTS_PER_QUERY: usize = 2000;

    events()
        .skip(args.start as usize)
        .take(MAX_EVENTS_PER_QUERY.min(args.length as usize))
        .collect()
}

#[candid_method(query)]
#[query]
fn get_liquidity_status(owner: Principal) -> LiquidityStatus {
    let total_liquidity_provided = read_state(|s| s.total_provided_liquidity_amount());
    let liquidity_pool_share = if total_liquidity_provided == 0 {
        0.0
    } else {
        read_state(|s| {
            (s.get_provided_liquidity(owner) / s.total_provided_liquidity_amount()).to_f64()
        })
    };
    read_state(|s| LiquidityStatus {
        liquidity_provided: s.get_provided_liquidity(owner).to_u64(),
        total_liquidity_provided: s.total_provided_liquidity_amount().to_u64(),
        liquidity_pool_share,
        available_liquidity_reward: s.get_liquidity_returns_of(owner).to_u64(),
        total_available_returns: s.total_available_returns().to_u64(),
    })
}

#[candid_method(query)]
#[query]
fn get_vaults(target: Option<Principal>) -> Vec<CandidVault> {
    match target {
        Some(target) => read_state(|s| match s.principal_to_vault_ids.get(&target) {
            Some(vault_ids) => vault_ids
                .iter()
                .filter_map(|id| {
                    // Use filter_map with proper error handling instead of unwrap
                    s.vault_id_to_vaults.get(id).map(|vault| CandidVault {
                        owner: vault.owner,
                        borrowed_icusd_amount: vault.borrowed_icusd_amount.to_u64(),
                        icp_margin_amount: vault.icp_margin_amount.to_u64(),
                        vault_id: vault.vault_id,
                    })
                })
                .collect(),
            None => vec![],
        }),
        None => read_state(|s| {
            s.vault_id_to_vaults
                .values()
                .map(|vault| CandidVault {
                    owner: vault.owner,
                    borrowed_icusd_amount: vault.borrowed_icusd_amount.to_u64(),
                    icp_margin_amount: vault.icp_margin_amount.to_u64(),
                    vault_id: vault.vault_id,
                })
                .collect::<Vec<CandidVault>>()
        }),
    }
}

// Vault related operations
#[candid_method(update)]
#[update]
async fn redeem_icp(icusd_amount: u64) -> Result<SuccessWithFee, ProtocolError> {
    validate_call()?;
    check_postcondition(rumi_protocol_backend::vault::redeem_icp(icusd_amount).await)
}

#[candid_method(query)]
#[query]
fn get_redemption_rate() -> f64 {
    read_state(|s| {
        s.get_redemption_fee(
            ICUSD::from(100_000_000),
        ).to_f64()
    })
}

#[candid_method(update)]
#[update]
async fn open_vault(icp_margin: u64) -> Result<OpenVaultSuccess, ProtocolError> {
    validate_call()?;
    check_postcondition(rumi_protocol_backend::vault::open_vault(icp_margin).await)
}

#[candid_method(update)]
#[update]
async fn borrow_from_vault(arg: VaultArg) -> Result<SuccessWithFee, ProtocolError> {
    validate_call()?;
    validate_mode()?;
    check_postcondition(rumi_protocol_backend::vault::borrow_from_vault(arg).await)
}

#[candid_method(update)]
#[update]
async fn repay_to_vault(arg: VaultArg) -> Result<u64, ProtocolError> {
    validate_call()?;
    check_postcondition(rumi_protocol_backend::vault::repay_to_vault(arg).await)
}

#[candid_method(update)]
#[update]
async fn add_margin_to_vault(arg: VaultArg) -> Result<u64, ProtocolError> {
    validate_call()?;
    check_postcondition(rumi_protocol_backend::vault::add_margin_to_vault(arg).await)
}

#[candid_method(update)]
#[update]
async fn close_vault(vault_id: u64) -> Result<Option<u64>, ProtocolError> {
    validate_call()?;
    check_postcondition(rumi_protocol_backend::vault::close_vault(vault_id).await)
}

// Add the new withdraw collateral endpoint
#[candid_method(update)]
#[update]
async fn withdraw_collateral(vault_id: u64) -> Result<u64, ProtocolError> {
    validate_call()?;
    check_postcondition(rumi_protocol_backend::vault::withdraw_collateral(vault_id).await)
}

#[candid_method(update)]
#[update]
async fn withdraw_and_close_vault(vault_id: u64) -> Result<Option<u64>, ProtocolError> {
    validate_call()?;
    check_postcondition(rumi_protocol_backend::vault::withdraw_and_close_vault(vault_id).await)
}

// Add the new liquidate vault endpoints
#[update]
#[candid_method(update)]
async fn liquidate_vault(vault_id: u64) -> Result<SuccessWithFee, ProtocolError> {
    check_postcondition(rumi_protocol_backend::vault::liquidate_vault(vault_id).await)
}

#[update]
#[candid_method(update)]
async fn liquidate_vault_partial(vault_id: u64, icusd_amount: u64) -> Result<SuccessWithFee, ProtocolError> {
    check_postcondition(rumi_protocol_backend::vault::liquidate_vault_partial(vault_id, icusd_amount).await)
}

// Stability Pool Integration - allows stability pool to execute liquidations
#[update]
#[candid_method(update)]
async fn stability_pool_liquidate(vault_id: u64, max_debt_to_liquidate: u64) -> Result<StabilityPoolLiquidationResult, ProtocolError> {
    let caller = ic_cdk::api::caller();
    
    // TODO: Add proper authorization check - only allow registered stability pool
    // For now, we'll allow any caller for testing
    
    // Get vault info and validate it's liquidatable
    let (vault, icp_rate, liquidatable_debt, collateral_available) = read_state(|s| {
        match s.vault_id_to_vaults.get(&vault_id) {
            Some(vault) => {
                let icp_rate = s.last_icp_rate.ok_or("No ICP rate available")?;
                let ratio = rumi_protocol_backend::compute_collateral_ratio(vault, icp_rate);
                
                if ratio >= s.mode.get_minimum_liquidation_collateral_ratio() {
                    return Err(format!(
                        "Vault #{} is not liquidatable. Current ratio: {:.2}%, minimum: {:.2}%",
                        vault_id, 
                        ratio.to_f64() * 100.0, 
                        s.mode.get_minimum_liquidation_collateral_ratio().to_f64() * 100.0
                    ));
                }
                
                // Calculate how much can be liquidated
                let max_liquidation_ratio = Ratio::new(dec!(0.5)); // 50% max
                let max_liquidatable = vault.borrowed_icusd_amount * max_liquidation_ratio;
                let actual_liquidatable_debt = max_liquidatable.min(vault.borrowed_icusd_amount).min(max_debt_to_liquidate.into());
                
                // Calculate collateral that will be seized (debt + 10% bonus)
                let liquidation_bonus = Ratio::new(dec!(1.1)); // 110%
                let icp_equivalent = actual_liquidatable_debt / icp_rate;
                let collateral_with_bonus = icp_equivalent * liquidation_bonus;
                let collateral_to_seize = collateral_with_bonus.min(vault.icp_margin_amount);
                
                Ok((vault.clone(), icp_rate, actual_liquidatable_debt, collateral_to_seize))
            },
            None => Err(format!("Vault #{} not found", vault_id)),
        }
    }).map_err(|e| ProtocolError::GenericError(e))?;
    
    if liquidatable_debt == ICUSD::new(0) {
        return Err(ProtocolError::GenericError("No liquidatable debt available".to_string()));
    }
    
    // Execute the liquidation using existing logic
    let result = rumi_protocol_backend::vault::liquidate_vault_partial(vault_id, liquidatable_debt.to_u64()).await?;
    
    // Return structured result for stability pool
    Ok(StabilityPoolLiquidationResult {
        success: true,
        vault_id,
        liquidated_debt: liquidatable_debt.to_u64(),
        collateral_received: collateral_available.to_u64(),
        collateral_type: "ICP".to_string(), // Currently only ICP is supported
        block_index: result.block_index,
        fee: result.fee_amount_paid,
    })
}

// Get stability pool configuration
#[query]
#[candid_method(query)]
fn get_stability_pool_config() -> StabilityPoolConfig {
    read_state(|s| {
        StabilityPoolConfig {
            stability_pool_canister: s.stability_pool_canister,
            liquidation_discount: 10, // 10% discount for stability pool
            enabled: s.stability_pool_canister.is_some(),
        }
    })
}

// Update stability pool configuration (admin only)
#[update]
#[candid_method(update)]
fn set_stability_pool_canister(canister_id: Principal) -> Result<(), ProtocolError> {
    mutate_state(|s| {
        // TODO: Add proper admin authorization check
        s.stability_pool_canister = Some(canister_id);
        Ok(())
    })
}

// Add the new get liquidatable vaults endpoint
#[candid_method(query)]
#[query]
fn get_liquidatable_vaults() -> Vec<CandidVault> {
    read_state(|s| {
        let current_icp_rate = s.last_icp_rate.unwrap_or(UsdIcp::from(dec!(0.0)));
        
        if current_icp_rate.to_f64() == 0.0 {
            return vec![];
        }
        
        s.vault_id_to_vaults
            .values()
            .filter(|vault| {
                let ratio = rumi_protocol_backend::compute_collateral_ratio(vault, current_icp_rate);
                ratio < s.mode.get_minimum_liquidation_collateral_ratio()
            })
            .map(|vault| {
                let collateral_ratio = rumi_protocol_backend::compute_collateral_ratio(vault, current_icp_rate);
                CandidVault {
                    owner: vault.owner,
                    borrowed_icusd_amount: vault.borrowed_icusd_amount.to_u64(),
                    icp_margin_amount: vault.icp_margin_amount.to_u64(),
                    vault_id: vault.vault_id,
                }
            })
            .collect::<Vec<CandidVault>>()
    })
}


// Liquidity related operations
#[candid_method(update)]
#[update]
async fn provide_liquidity(amount: u64) -> Result<u64, ProtocolError> {
    validate_call()?;
    check_postcondition(rumi_protocol_backend::liquidity_pool::provide_liquidity(amount).await)
}

#[candid_method(update)]
#[update]
async fn withdraw_liquidity(amount: u64) -> Result<u64, ProtocolError> {
    validate_call()?;
    check_postcondition(rumi_protocol_backend::liquidity_pool::withdraw_liquidity(amount).await)
}

#[candid_method(update)]
#[update]
async fn claim_liquidity_returns() -> Result<u64, ProtocolError> {
    validate_call()?;
    check_postcondition(rumi_protocol_backend::liquidity_pool::claim_liquidity_returns().await)
}

#[query]
fn http_request(req: HttpRequest) -> HttpResponse {
    use ic_metrics_encoder::MetricsEncoder;
    if ic_cdk::api::data_certificate().is_none() {
        ic_cdk::trap("update call rejected");
    }

    if req.path() == "/metrics" {
        let mut writer = MetricsEncoder::new(vec![], ic_cdk::api::time() as i64 / 1_000_000);

        fn encode_metrics(w: &mut MetricsEncoder<Vec<u8>>) -> std::io::Result<()> {
            read_state(|s| {
                w.gauge_vec("cycle_balance", "Cycle balance of this canister.")?
                    .value(
                        &[("canister", "rumi-protocol")],
                        ic_cdk::api::canister_balance128() as f64,
                    )?;

                w.encode_gauge(
                    "icusd_active_vault_count",
                    s.vault_id_to_vaults.len() as f64,
                    "Count of active vaults in the system.",
                )?;

                w.encode_gauge(
                    "rumi_vault_owners_count",
                    s.principal_to_vault_ids.keys().len() as f64,
                    "Count of owners of active vaults.",
                )?;

                w.encode_gauge(
                    "rumi_total_provided_liquidity_amount",
                    s.total_provided_liquidity_amount().to_u64() as f64,
                    "Provided amount of liquidity.",
                )?;

                w.encode_gauge(
                    "rumi_liquidity_providers_count",
                    s.liquidity_pool.len() as f64,
                    "Count of liquidity providers.",
                )?;

                w.encode_gauge(
                    "rumi_pending_margin_transfer_count",
                    s.pending_margin_transfers.len() as f64,
                    "Pending margin transfers count.",
                )?;

                w.encode_gauge(
                    "rumi_liquidity_providers_rewards",
                    s.total_available_returns().to_u64() as f64,
                    "Available rewards for liquidity providers.",
                )?;

                w.encode_gauge(
                    "rumi_pending_margin_transfers_count",
                    s.pending_margin_transfers.len() as f64,
                    "Pending margin transfers count.",
                )?;

                w.encode_gauge(
                    "rumi_pending_redemption_transfer_count",
                    s.pending_redemption_transfer.len() as f64,
                    "Pending redemption transfers count.",
                )?;

                w.encode_gauge(
                    "rumi_icp_rate",
                    s.last_icp_rate.unwrap_or(UsdIcp::from(dec!(0))).to_f64(),
                    "ICP rate.",
                )?;

                let total_icp_dec = Decimal::from_u64(s.total_icp_margin_amount().0)
                    .expect("failed to construct decimal from u64")
                    / dec!(100_000_000);

                w.encode_gauge(
                    "icp_total_ICP_margin",
                    total_icp_dec.to_f64().unwrap(),
                    "Total ICP Margin.",
                )?;

                w.encode_gauge(
                    "ICP_total_tvl",
                    (total_icp_dec * s.last_icp_rate.unwrap_or(UsdIcp::from(dec!(0))).0)
                        .to_f64()
                        .unwrap(),
                    "Total TVL.",
                )?;

                let total_borrowed_icusd_amount = Decimal::from_u64(s.total_borrowed_icusd_amount().0)
                    .expect("failed to construct decimal from u64")
                    / dec!(100_000_000);

                w.encode_gauge(
                    "icusd_total_borrowed_amount",
                    total_borrowed_icusd_amount.to_f64().unwrap(),
                    "Total borrowed icusd.",
                )?;

                w.encode_gauge(
                    "ICP_total_collateral_ratio",
                    s.total_collateral_ratio.to_f64(),
                    "TCR.",
                )?;

                Ok(())
            })
        }

        match encode_metrics(&mut writer) {
            Ok(()) => HttpResponseBuilder::ok()
                .header("Content-Type", "text/plain; version=0.0.4")
                .with_body_and_content_length(writer.into_inner())
                .build(),
            Err(err) => {
                HttpResponseBuilder::server_error(format!("Failed to encode metrics: {}", err))
                    .build()
            }
        }
    } else if req.path() == "/logs" {
        use rumi_protocol_backend::logs::{Log, Priority};
        use serde_json;
        use std::str::FromStr;

        let max_skip_timestamp = match req.raw_query_param("time") {
            Some(arg) => match u64::from_str(arg) {
                Ok(value) => value,
                Err(_) => {
                    return HttpResponseBuilder::bad_request()
                        .with_body_and_content_length("failed to parse the 'time' parameter")
                        .build()
                }
            },
            None => 0,
        };

        let mut entries: Log = Default::default();

        match req.raw_query_param("priority") {
            Some(priority_str) => match Priority::from_str(priority_str) {
                Ok(priority) => match priority {
                    Priority::Info => entries.push_logs(Priority::Info),
                    Priority::TraceXrc => entries.push_logs(Priority::TraceXrc),
                    Priority::Debug => entries.push_logs(Priority::Debug),
                },
                Err(_) => entries.push_all(),
            },
            None => entries.push_all(),
        }

        entries
            .entries
            .retain(|entry| entry.timestamp >= max_skip_timestamp);
        let mut entries_bytes: Vec<u8> = serde_json::to_string(&entries)
            .unwrap_or_default()
            .into_bytes();

        // Truncate bytes to avoid having more than 2MB response.
        let max_size_bytes: usize = 1_900_000;
        entries_bytes.truncate(max_size_bytes);

        HttpResponseBuilder::ok()
            .header("Content-Type", "application/json; charset=utf-8")
            .with_body_and_content_length(entries_bytes)
            .build()
    } else if req.path() == "/dashboard" {
        use rumi_protocol_backend::dashboard::build_dashboard;

        let dashboard = build_dashboard();
        HttpResponseBuilder::ok()
            .header("Content-Type", "text/html; charset=utf-8")
            .with_body_and_content_length(dashboard)
            .build()
    } else {
        HttpResponseBuilder::not_found().build()
    }
}

// Add a new heartbeat function to routinely clean up stale operations
#[ic_cdk::heartbeat]
fn heartbeat() {
    use rumi_protocol_backend::state::mutate_state;
    log!(INFO, "[heartbeat] Running scheduled cleanup tasks");
    
    // Clean up any stale operations
    mutate_state(|s| s.clean_stale_operations());
}

#[candid_method(update)]
#[update]
async fn recover_pending_transfer(vault_id: u64) -> Result<bool, ProtocolError> {
    let caller = ic_cdk::caller();
    
    // Validate the caller is the owner of this pending transfer
    let is_owner = read_state(|s| {
        s.pending_margin_transfers
            .get(&vault_id)
            .map(|transfer| transfer.owner == caller)
            .unwrap_or(false)
    });
    
    if !is_owner {
        return Err(ProtocolError::CallerNotOwner);
    }
    
    // Process the pending transfer immediately
    let transfer_opt = read_state(|s| {
        s.pending_margin_transfers.get(&vault_id).cloned()
    });
    
    if let Some(transfer) = transfer_opt {
        let icp_transfer_fee = read_state(|s| s.icp_ledger_fee);
        
        match crate::management::transfer_icp(
            transfer.margin - icp_transfer_fee,
            transfer.owner,
        )
        .await
        {
            Ok(block_index) => {
                mutate_state(|s| crate::event::record_margin_transfer(s, vault_id, block_index));
                Ok(true)
            }
            Err(error) => {
                log!(
                    DEBUG,
                    "[recover_pending_transfer] failed to transfer margin: {}, with error: {}",
                    transfer.margin,
                    error
                );
                Err(ProtocolError::TransferError(error))
            }
        }
    } else {
        // No pending transfer found for this vault
        Err(ProtocolError::GenericError("No pending transfer found for this vault".to_string()))
    }
}

// Add treasury configuration endpoint (developer only)
#[candid_method(update)]
#[update]
async fn set_treasury_principal(treasury_principal: Principal) -> Result<(), ProtocolError> {
    let caller = ic_cdk::caller();
    
    // Only developer can set treasury principal
    let is_developer = read_state(|s| s.developer_principal == caller);
    if (!is_developer) {
        return Err(ProtocolError::GenericError("Only developer can set treasury principal".to_string()));
    }
    
    mutate_state(|s| {
        s.set_treasury_principal(treasury_principal);
    });
    
    log!(INFO, "[set_treasury_principal] Treasury principal set to: {}", treasury_principal);
    Ok(())
}

#[candid_method(query)]
#[query]
fn get_treasury_principal() -> Option<Principal> {
    read_state(|s| s.get_treasury_principal())
}

// Add stability pool configuration endpoint (developer only)
#[candid_method(update)]
#[update]
async fn set_stability_pool_principal(stability_pool_principal: Principal) -> Result<(), ProtocolError> {
    let caller = ic_cdk::caller();
    
    // Only developer can set stability pool principal
    let is_developer = read_state(|s| s.developer_principal == caller);
    if !is_developer {
        return Err(ProtocolError::GenericError("Only developer can set stability pool principal".to_string()));
    }
    
    mutate_state(|s| {
        s.set_stability_pool_canister(stability_pool_principal);
    });
    
    log!(INFO, "[set_stability_pool_principal] Stability pool principal set to: {}", stability_pool_principal);
    Ok(())
}

#[candid_method(query)]
#[query]
fn get_stability_pool_principal() -> Option<Principal> {
    read_state(|s| s.get_stability_pool_canister())
}

// Add guard cleanup method for developers to resolve stuck operations
#[candid_method(update)]
#[update]
async fn clear_stuck_operations(principal_id: Option<Principal>) -> Result<u64, ProtocolError> {
    let caller = ic_cdk::caller();
    
    // Only developer can clear stuck operations
    let is_developer = read_state(|s| s.developer_principal == caller);
    if !is_developer {
        return Err(ProtocolError::GenericError("Only developer can clear stuck operations".to_string()));
    }
    
    let cleared_count = mutate_state(|s| {
        use ic_cdk::api::time;
        let current_time = time();
        let mut operations_to_remove = Vec::new();
        let mut count = 0u64;
        
        // If specific principal provided, only clear their operations
        if let Some(target_principal) = principal_id {
            for op_key in s.operation_guards.iter() {
                if let Some((op_principal, op_name)) = s.operation_details.get(op_key) {
                    if *op_principal == target_principal {
                        operations_to_remove.push(op_key.clone());
                        log!(INFO, 
                            "[clear_stuck_operations] Clearing operation '{}' for principal: {}", 
                            op_name, op_principal.to_string()
                        );
                        count += 1;
                    }
                }
            }
        } else {
            // Clear all operations older than 2 minutes or marked as failed
            for op_key in s.operation_guards.iter() {
                let mut should_remove = false;
                
                if let Some(timestamp) = s.operation_guard_timestamps.get(op_key) {
                    let age_seconds = (current_time - timestamp) / 1_000_000_000;
                    if age_seconds > 120 { // 2 minutes
                        should_remove = true;
                    }
                }
                
                // Commented out to avoid import issues - not needed for basic functionality
                // if let Some(state) = s.operation_states.get(op_key) {
                //     if *state == crate::guard::OperationState::Failed {
                //         should_remove = true;
                //     }
                // }
                
                if should_remove {
                    operations_to_remove.push(op_key.clone());
                    if let Some((op_principal, op_name)) = s.operation_details.get(op_key) {
                        log!(INFO, 
                            "[clear_stuck_operations] Clearing stale operation '{}' for principal: {}", 
                            op_name, op_principal.to_string()
                        );
                    }
                    count += 1;
                }
            }
        }
        
        // Remove the identified operations
        for op_key in operations_to_remove {
            s.operation_guards.remove(&op_key);
            s.operation_guard_timestamps.remove(&op_key);
            s.operation_states.remove(&op_key);
            s.operation_details.remove(&op_key);
        }
        
        count
    });
    
    log!(INFO, "[clear_stuck_operations] Cleared {} stuck operations", cleared_count);
    Ok(cleared_count)
}

// Checks the real candid interface against the one declared in the did file
#[test]
fn check_candid_interface_compatibility() {
    fn source_to_str(source: &CandidSource) -> String {
        match source {
            CandidSource::File(f) => {
                std::fs::read_to_string(f).unwrap_or_else(|_| "".to_string())
            }
            CandidSource::Text(t) => t.to_string(),
        }
    }
    

    fn check_service_compatible(
        new_name: &str,
        new: CandidSource,
        old_name: &str,
        old: CandidSource,
    ) {
        let new_str = source_to_str(&new);
        let old_str = source_to_str(&old);
        match service_equal(new, old) {
            Ok(_) => {}
            Err(e) => {
                eprintln!(
                    "{} is not compatible with {}!\n\n\
            {}:\n\
            {}\n\n\
            {}:\n\
            {}\n",
                    new_name, old_name, new_name, new_str, old_name, old_str
                );
                panic!("{:?}", e);
            }
        }
    }

    candid::export_service!();

    let new_interface = __export_service();

    // check the public interface against the actual one
    let old_interface =
        std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("rumi_protocol_backend.did");

    check_service_compatible(
        "actual Rumi Protocol candid interface",
        CandidSource::Text(&new_interface),
        "declared candid interface in rumi_protocol_backend.did file",
        CandidSource::File(old_interface.as_path()),
    );
}