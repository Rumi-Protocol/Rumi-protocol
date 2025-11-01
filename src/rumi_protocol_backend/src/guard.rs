use crate::state::mutate_state;
use candid::Principal;
use std::marker::PhantomData;
use ic_cdk::api::time;
use ic_canister_log::log;

const MAX_CONCURRENT: usize = 100;

// Create a unique operation key combining principal and operation name
fn create_operation_key(principal: Principal, operation_name: &str) -> String {
    format!("{}:{}", principal.to_string(), operation_name)
}
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
    /// already a pending request for the specified [operation_key] or if there
    /// are at least [MAX_CONCURRENT] pending requests.
    pub fn new(principal: Principal, operation_name: &str) -> Result<Self, GuardError> {
        let operation_key = create_operation_key(principal, operation_name);
        
        mutate_state(|s| {
            // Clean up any stale guards before processing new request
            let current_time = time();
            
            // Remove guards that are older than the timeout or explicitly marked as failed
            let mut stale_operations = Vec::new();
            for op_key in s.operation_guards.iter() {
                if let Some(timestamp) = s.operation_guard_timestamps.get(op_key) {
                    // Check if operation has been running too long
                    if current_time.saturating_sub(*timestamp) > GUARD_TIMEOUT_NANOS {
                        if let Some((op_principal, op_name)) = s.operation_details.get(op_key) {
                            log!(crate::INFO, 
                                "[guard] Removing stale operation: {} for principal: {} (age: {}s)",
                                op_name,
                                op_principal.to_string(), 
                                current_time.saturating_sub(*timestamp) / 1_000_000_000
                            );
                        }
                        stale_operations.push(op_key.clone());
                    } 
                    
                    // Also check for operations marked as failed or with errors
                    if let Some(state) = s.operation_states.get(op_key) {
                        if *state == OperationState::Failed {
                            if let Some((op_principal, op_name)) = s.operation_details.get(op_key) {
                                log!(crate::INFO, 
                                    "[guard] Removing failed operation: {} for principal: {}", 
                                    op_name,
                                    op_principal.to_string()
                                );
                            }
                            stale_operations.push(op_key.clone());
                        }
                    }
                } else {
                    // No timestamp, must be stale
                    stale_operations.push(op_key.clone());
                }
            }
            
            // Remove stale guards from all tracking data structures
            for op_key in stale_operations {
                s.operation_guards.remove(&op_key);
                s.operation_guard_timestamps.remove(&op_key);
                s.operation_states.remove(&op_key);
                s.operation_details.remove(&op_key);
            }
            
            // Now check if this specific operation already has a guard
            if s.operation_guards.contains(&operation_key) {
                let (op_principal, op_name) = s.operation_details.get(&operation_key)
                    .map(|(p, n)| (*p, n.clone()))
                    .unwrap_or((principal, operation_name.to_string()));
                
                let timestamp = s.operation_guard_timestamps.get(&operation_key)
                    .copied()
                    .unwrap_or_default();
                
                let age_seconds = (current_time - timestamp) / 1_000_000_000;
                
                if age_seconds > (GUARD_TIMEOUT_NANOS / 1_000_000_000) / 2 {
                    // If operation is more than half of timeout old, treat it as stale
                    log!(crate::INFO, 
                        "[guard] Operation '{}' for principal {} is stale ({}s old), allowing new request",
                        op_name, op_principal.to_string(), age_seconds
                    );
                    
                    // Clean up the stale operation
                    s.operation_guards.remove(&operation_key);
                    s.operation_guard_timestamps.remove(&operation_key);
                    s.operation_states.remove(&operation_key);
                    s.operation_details.remove(&operation_key);
                    
                    // Continue with new guard creation below
                } else {
                    // Operation is still considered active
                    log!(crate::INFO, 
                        "[guard] Operation '{}' for principal {} is already in progress ({}s old)",
                        op_name, op_principal.to_string(), age_seconds
                    );
                    return Err(GuardError::AlreadyProcessing);
                }
            }
            
            if s.operation_guards.len() >= MAX_CONCURRENT {
                return Err(GuardError::TooManyConcurrentRequests);
            }
            
            // Add the guard and tracking data using operation key
            s.operation_guards.insert(operation_key.clone());
            s.operation_guard_timestamps.insert(operation_key.clone(), current_time);
            s.operation_states.insert(operation_key.clone(), OperationState::InProgress);
            s.operation_details.insert(operation_key.clone(), (principal, operation_name.to_string()));
            
            log!(crate::INFO, 
                "[guard] Created new guard for principal {} operation '{}' with key {}",
                principal.to_string(), operation_name, &operation_key
            );
            
            Ok(Self {
                principal,
                created_at: current_time,
                operation_id: operation_key,
                _marker: PhantomData,
            })
        })
    }
    
    // Method to mark this operation as complete
    pub fn complete(self) {
        mutate_state(|s| {
            if let Some(state) = s.operation_states.get_mut(&self.operation_id) {
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
            if let Some(state) = s.operation_states.get_mut(&self.operation_id) {
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
            if let Some(state) = s.operation_states.get(&self.operation_id) {
                if *state == OperationState::Completed {
                    s.operation_guards.remove(&self.operation_id);
                    s.operation_guard_timestamps.remove(&self.operation_id);
                    s.operation_states.remove(&self.operation_id);
                    s.operation_details.remove(&self.operation_id);
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
                s.operation_guards.remove(&self.operation_id);
                s.operation_guard_timestamps.remove(&self.operation_id);
                s.operation_details.remove(&self.operation_id);
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
