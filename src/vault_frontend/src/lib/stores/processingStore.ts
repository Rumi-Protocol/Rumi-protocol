import { writable, derived } from 'svelte/store';

export enum ProcessingStage {
  IDLE = 'idle',
  CHECKING = 'checking',
  APPROVING = 'approving',   // Added new stage for token approvals
  CREATING = 'creating',
  DONE = 'done',
  FAILED = 'failed'
}

interface ProcessingState {
  stage: ProcessingStage;
  errorCode?: number;
  startTime: number;
  timeout: number;
}

function createProcessingStore() {
  const DEFAULT_TIMEOUT = 60000; // 60 seconds
  
  const { subscribe, update, set } = writable<ProcessingState>({
    stage: ProcessingStage.IDLE,
    startTime: 0,
    timeout: DEFAULT_TIMEOUT
  });

  let timeoutId: NodeJS.Timeout | null = null;

  // Helper to clear timeout
  function clearActiveTimeout() {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  }

  return {
    subscribe,
    
    setStage(stage: ProcessingStage, errorCode?: number) {
      clearActiveTimeout();
      
      if (stage === ProcessingStage.IDLE || 
          stage === ProcessingStage.DONE || 
          stage === ProcessingStage.FAILED) {
        set({
          stage,
          errorCode,
          startTime: 0,
          timeout: DEFAULT_TIMEOUT
        });
        return;
      }
      
      // For stages that need timeout handling
      const startTime = Date.now();
      const timeout = stage === ProcessingStage.APPROVING 
        ? DEFAULT_TIMEOUT * 2  // Give approval process extra time
        : DEFAULT_TIMEOUT;
      
      update(state => ({
        ...state,
        stage,
        errorCode,
        startTime,
        timeout
      }));
      
      // Set up timeout
      timeoutId = setTimeout(() => {
        update(state => ({
          ...state,
          stage: ProcessingStage.FAILED,
          errorCode: -1 // Timeout error code
        }));
      }, timeout);
    },
    
    reset() {
      clearActiveTimeout();
      set({
        stage: ProcessingStage.IDLE,
        startTime: 0,
        timeout: DEFAULT_TIMEOUT
      });
    },
    
    getRemainingTime() {
      let state: ProcessingState = { 
        stage: ProcessingStage.IDLE, 
        startTime: 0, 
        timeout: DEFAULT_TIMEOUT 
      };
      subscribe(s => { state = s; })();
      
      if (state.stage === ProcessingStage.IDLE || 
          state.stage === ProcessingStage.DONE || 
          state.stage === ProcessingStage.FAILED) {
        return 0;
      }
      
      const elapsed = Date.now() - state.startTime;
      const remaining = Math.max(0, Math.floor((state.timeout - elapsed) / 1000));
      return remaining;
    }
  };
}

export const processingStore = createProcessingStore();

export const isProcessing = derived(
  processingStore,
  $store => $store.stage !== ProcessingStage.IDLE && 
            $store.stage !== ProcessingStage.DONE && 
            $store.stage !== ProcessingStage.FAILED
);