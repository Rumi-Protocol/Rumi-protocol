/**
 * Execute a promise with a timeout
 * 
 * @param promise The promise to execute
 * @param timeoutMs Timeout in milliseconds
 * @param errorMessage Optional custom error message
 * @returns Promise result
 */
export async function promiseWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string = 'Operation timed out'
): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  
  // Create a promise that rejects after timeoutMs
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
  });

  try {
    // Race the original promise against the timeout
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    // Clear the timeout to prevent memory leaks
    clearTimeout(timeoutId!);
  }
}

/**
 * Delay execution for specified milliseconds
 * @param ms Milliseconds to delay
 */
export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retry a function with exponential backoff
 * 
 * @param fn Function to retry
 * @param maxRetries Maximum number of retries
 * @param initialDelay Initial delay in milliseconds
 * @returns Promise with the result of the function
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 500
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let retry = 0; retry < maxRetries; retry++) {
    try {
      return await fn();
    } catch (err) {
      console.warn(`Attempt ${retry + 1} failed, retrying...`, err);
      lastError = err instanceof Error ? err : new Error(String(err));
      
      // Calculate exponential backoff delay
      const backoffDelay = initialDelay * Math.pow(2, retry);
      await delay(backoffDelay);
    }
  }
  
  throw lastError || new Error(`Failed after ${maxRetries} attempts`);
}
