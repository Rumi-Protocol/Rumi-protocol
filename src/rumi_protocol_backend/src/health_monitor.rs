use ic_cdk::api::management_canister::time;
use ic_cdk::api::time;
use ic_canister_log::log;
use crate::logs::{INFO, DEBUG};
use crate::state::{read_state, mutate_state, PendingMarginTransfer};

const MAX_TRANSFER_AGE_NANOS: u64 = 15 * 60 * 1_000_000_000; // 15 minutes in nanoseconds

pub async fn check_and_retry_stuck_transfers() {
    let _guard = match crate::guard::TimerLogicGuard::new() {
        Some(guard) => guard,
        None => {
            log!(INFO, "[check_stuck_transfers] double entry.");
            return;
        }
    };
    
    let now = time();
    let stuck_transfers = read_state(|s| {
        // Find transfers that are older than MAX_TRANSFER_AGE_NANOS
        let mut stuck = Vec::new();
        for (vault_id, transfer) in &s.pending_margin_transfers {
            if now > transfer.timestamp + MAX_TRANSFER_AGE_NANOS {
                stuck.push((*vault_id, *transfer));
            }
        }
        stuck
    });
    
    if !stuck_transfers.is_empty() {
        log!(
            INFO,
            "[check_stuck_transfers] Found {} stuck transfers, attempting to retry",
            stuck_transfers.len()
        );
        
        // Process these transfers now
        let icp_transfer_fee = read_state(|s| s.icp_ledger_fee);
        
        for (vault_id, transfer) in stuck_transfers {
            match crate::management::transfer_icp(
                transfer.margin - icp_transfer_fee,
                transfer.owner,
            )
            .await
            {
                Ok(block_index) => {
                    log!(
                        INFO,
                        "[check_stuck_transfers] Successfully retried transfer for vault {}: {} ICP to {}",
                        vault_id,
                        transfer.margin,
                        transfer.owner
                    );
                    mutate_state(|s| crate::event::record_margin_transfer(s, vault_id, block_index));
                }
                Err(error) => {
                    log!(
                        DEBUG,
                        "[check_stuck_transfers] Failed to retry transfer for vault {}: {}, error: {}",
                        vault_id,
                        transfer.margin,
                        error
                    );
                }
            }
        }
    }
    
    // Schedule another check in 5 minutes
    ic_cdk_timers::set_timer(std::time::Duration::from_secs(5 * 60), || {
        ic_cdk::spawn(check_and_retry_stuck_transfers())
    });
}
