/**
 * Helper to safely convert BigInt values to strings when serializing objects
 * @param data Any object that might contain BigInt values
 */
export function safeStringifyBigInt(data: any): string {
  return JSON.stringify(data, (_, value) => 
    typeof value === 'bigint' ? value.toString() : value
  );
}

/**
 * Helper to check if an object contains BigInt values
 */
export function containsBigInt(obj: any): boolean {
  if (typeof obj === 'bigint') return true;
  if (!obj || typeof obj !== 'object') return false;
  
  return Object.values(obj).some(value => {
    if (typeof value === 'bigint') return true;
    if (typeof value === 'object' && value !== null) return containsBigInt(value);
    return false;
  });
}

/**
 * Safely log values that might include BigInts by converting them to strings
 */
export function safeLog(label: string, data: any): void {
  try {
    // Replace BigInts with their string representation
    const processValue = (val: any): any => {
      if (typeof val === 'bigint') {
        return val.toString();
      }
      if (val === null || val === undefined || typeof val !== 'object') {
        return val;
      }
      if (Array.isArray(val)) {
        return val.map(processValue);
      }
      // Process object properties
      return Object.fromEntries(
        Object.entries(val).map(([k, v]) => [k, processValue(v)])
      );
    };
    
    const processed = processValue(data);
    console.log(`${label}:`, processed);
  } catch (err) {
    console.warn(`Error logging ${label}:`, err);
    console.log(`${label} (raw):`, data);
  }
}

/**
 * Format a bigint to a string with the given number of decimals
 */
export function formatBigintWithDecimals(value: bigint, decimals: number = 8): string {
  if (value === 0n) return "0";
  
  const valueStr = value.toString().padStart(decimals + 1, "0");
  const integerPart = valueStr.slice(0, -decimals) || "0";
  const fractionalPart = valueStr.slice(-decimals);
  
  // Trim trailing zeros from the fractional part
  const trimmedFractionalPart = fractionalPart.replace(/0+$/, "");
  
  if (trimmedFractionalPart.length === 0) {
    return integerPart;
  }
  
  return `${integerPart}.${trimmedFractionalPart}`;
}

/**
 * Convert a number to a bigint with the given number of decimals
 */
export function numberToBigintWithDecimals(value: number, decimals: number = 8): bigint {
  const multiplier = Math.pow(10, decimals);
  const valueAsBigInt = BigInt(Math.floor(value * multiplier));
  return valueAsBigInt;
}
