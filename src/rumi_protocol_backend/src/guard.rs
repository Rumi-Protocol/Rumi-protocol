use crate::state::mutate_state;
use candid::Principal;
use std::marker::PhantomData;
use ic_cdk::api::time;
use ic_canister_log::log;

const MAX_CONCURRENT: usize = 100;
// Add a timeout duration for guards
const GUARD_TIMEOUT_NANOS: u64 = 5 * 60 * 1_000_000_000; // 5 minutes in nanoseconds

// Add maximum allowed operation time
const MAX_OPERATION_TIME_NANOS: u64 = 30 * 1_000_000_000; // 30 seconds in nanoseconds

// Track operation state
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum OperationState {
    InProgress,
    Completed,
    Failed,
}

/// Guards a block from executing twice when called by the same user and from being
/// executed [MAX_CONCURRENT] or more times in parallel.
#[must_use]
pub struct GuardPrincipal {
    principal: Principal,
    created_at: u64,
    operation_id: String, // Identify the specific operation
    _marker: PhantomData<GuardPrincipal>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum GuardError {
    AlreadyProcessing,
    TooManyConcurrentRequests,
    StaleOperation,
}

impl GuardPrincipal {
    /// Attempts to create a new guard for the current block. Fails if there is
    /// already a pending request for the specified [principal] or if there
    /// are at least [MAX_CONCURRENT] pending requests.
    pub fn new(principal: Principal, operation_name: &str) -> Result<Self, GuardError> {
        mutate_state(|s| {
            // Clean up any stale guards before processing new request
            let current_time = time();
            
            // Remove guards that are older than the timeout or explicitly marked as failed
            let mut stale_principals = Vec::new();
            for &p in s.principal_guards.iter() {
                if let Some(timestamp) = s.principal_guard_timestamps.get(&p) {
                    // Check if operation has been running too long
                    if current_time.saturating_sub(*timestamp) > GUARD_TIMEOUT_NANOS {
                        log!(crate::INFO, 
                            "[guard] Removing stale operation for principal: {} (age: {}s)",
                            p.to_string(), 
                            current_time.saturating_sub(*timestamp) / 1_000_000_000
                        );
                        stale_principals.push(p);
                    } 
                    
                    // Also check for operations marked as failed or with errors
                    if let Some(state) = s.operation_states.get(&p) {
                        if *state == OperationState::Failed {
                            log!(crate::INFO, 
                                "[guard] Removing failed operation for principal: {}", 
                                p.to_string()
                            );
                            stale_principals.push(p);
                        }
                    }
                } else {
                    // No timestamp, must be stale
                    stale_principals.push(p);
                }
            }
            
            // Remove stale guards from all tracking data structures
            for p in stale_principals {
                s.principal_guards.remove(&p);
                s.principal_guard_timestamps.remove(&p);
                s.operation_states.remove(&p);
                s.operation_names.remove(&p);
            }
            
            // Now check if the principal already has a guard
            if s.principal_guards.contains(&principal) {
                let operation_name = s.operation_names.get(&principal)
                    .map(|op| op.clone())
                    .unwrap_or_else(|| "unknown".to_string());
                
                let timestamp = s.principal_guard_timestamps.get(&principal)
                    .copied()
                    .unwrap_or_default();
                
                let age_seconds = (current_time - timestamp) / 1_000_000_000;
                
                if age_seconds > (GUARD_TIMEOUT_NANOS / 1_000_000_000) / 2 {
                    // If operation is more than half of timeout old, treat it as stale
                    log!(crate::INFO, 
                        "[guard] Operation '{}' for principal {} is stale ({}s old), allowing new request",
                        operation_name, principal.to_string(), age_seconds
                    );
                    
                    // Clean up the stale operation
                    s.principal_guards.remove(&principal);
                    s.principal_guard_timestamps.remove(&principal);
                    s.operation_states.remove(&principal);
                    s.operation_names.remove(&principal);
                    
                    // Continue with new guard creation below
                } else {
                    // Operation is still considered active
                    log!(crate::INFO, 
                        "[guard] Principal {} already has an active operation: {} ({}s old)",
                        principal.to_string(), operation_name, age_seconds
                    );
                    return Err(GuardError::AlreadyProcessing);
                }
            }
            
            if s.principal_guards.len() >= MAX_CONCURRENT {
                return Err(GuardError::TooManyConcurrentRequests);
            }
            
            // Build operation ID that combines principal and operation
            let operation_id = format!("{}:{}", principal.to_string(), operation_name);
            
            // Add the guard and tracking data
            s.principal_guards.insert(principal);
            s.principal_guard_timestamps.insert(principal, current_time);
            s.operation_states.insert(principal, OperationState::InProgress);
            s.operation_names.insert(principal, operation_name.to_string());
            
            log!(crate::INFO, 
                "[guard] Created new guard for principal {} operation '{}' with id {}",
                principal.to_string(), operation_name, &operation_id
            );
            
            Ok(Self {
                principal,
                created_at: current_time,
                operation_id,
                _marker: PhantomData,
            })
        })
    }
    
    // Method to mark this operation as complete
    pub fn complete(self) {
        mutate_state(|s| {
            if let Some(state) = s.operation_states.get_mut(&self.principal) {
                *state = OperationState::Completed;
                log!(crate::INFO, 
                    "[guard] Marked operation {} as completed", 
                    self.operation_id
                );
            }
        });
    }
    
    // Method to mark this operation as failed
    pub fn fail(self) {
        mutate_state(|s| {
            if let Some(state) = s.operation_states.get_mut(&self.principal) {
                *state = OperationState::Failed;
                log!(crate::INFO, 
                    "[guard] Marked operation {} as failed", 
                    self.operation_id
                );
            }
        });
    }
}

impl Drop for GuardPrincipal {
    fn drop(&mut self) {
        mutate_state(|s| {
            // Only remove if we're specifically in the "completed" state,
            // otherwise keep for potential error recovery
            if let Some(state) = s.operation_states.get(&self.principal) {
                if *state == OperationState::Completed {
                    s.principal_guards.remove(&self.principal);
                    s.principal_guard_timestamps.remove(&self.principal);
                    s.operation_states.remove(&self.principal);
                    s.operation_names.remove(&self.principal);
                    log!(crate::INFO, 
                        "[guard] Cleaned up completed operation {}", 
                        self.operation_id
                    );
                } else {
                    log!(crate::INFO, 
                        "[guard] Operation {} dropped but not removed (state: {:?})", 
                        self.operation_id, state
                    );
                }
            } else {
                // If no state exists (odd case), do full cleanup
                s.principal_guards.remove(&self.principal);
                s.principal_guard_timestamps.remove(&self.principal);
                s.operation_names.remove(&self.principal);
                log!(crate::INFO, 
                    "[guard] Operation {} dropped with no state, cleaned up", 
                    self.operation_id
                );
            }
        });
    }
}

#[must_use]
pub struct TimerLogicGuard(());

impl TimerLogicGuard {
    pub fn new() -> Option<Self> {
        mutate_state(|s| {
            if s.is_timer_running {
                return None;
            }
            s.is_timer_running = true;
            Some(TimerLogicGuard(()))
        })
    }
}

impl Drop for TimerLogicGuard {
    fn drop(&mut self) {
        mutate_state(|s| {
            s.is_timer_running = false;
        });
    }
}

#[must_use]
pub struct FetchXrcGuard(());

impl FetchXrcGuard {
    pub fn new() -> Option<Self> {
        mutate_state(|s| {
            if s.is_fetching_rate {
                return None;
            }
            s.is_fetching_rate = true;
            Some(FetchXrcGuard(()))
        })
    }
}

impl Drop for FetchXrcGuard {
    fn drop(&mut self) {
        mutate_state(|s| {
            s.is_fetching_rate = false;
        });
    }
}
