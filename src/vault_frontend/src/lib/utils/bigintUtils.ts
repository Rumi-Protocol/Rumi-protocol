/**
 * Utility for handling BigInt serialization and deserialization
 */

/**
 * Custom replacer for JSON.stringify that handles BigInt values
 * @param _key The current key being processed
 * @param value The current value being processed
 * @returns The processed value
 */
export function replacerWithBigInt(_key: string, value: any): any {
  // Convert BigInt to a string with a special prefix
  if (typeof value === 'bigint') {
    return { __bigint: value.toString() };
  }
  return value;
}

/**
 * Custom reviver for JSON.parse that handles BigInt values
 * @param _key The current key being processed
 * @param value The current value being processed
 * @returns The processed value
 */
export function reviverWithBigInt(_key: string, value: any): any {
  // Check for the special BigInt marker
  if (typeof value === 'object' && value !== null && '__bigint' in value) {
    return BigInt(value.__bigint);
  }
  return value;
}

/**
 * Stringify an object with BigInt support
 * @param obj Object to stringify
 * @returns JSON string with BigInt values handled
 */
export function stringifyWithBigInt(obj: any): string {
  return JSON.stringify(obj, replacerWithBigInt);
}

/**
 * Parse a JSON string with BigInt support
 * @param text JSON string to parse
 * @returns Parsed object with BigInt values restored
 */
export function parseWithBigInt(text: string): any {
  return JSON.parse(text, reviverWithBigInt);
}

/**
 * Format a BigInt for display (similar to Number.toLocaleString)
 * @param value The BigInt value to format
 * @param options Formatting options
 * @returns Formatted string
 */
export function formatBigInt(
  value: bigint,
  options: { decimals?: number; separator?: string } = {}
): string {
  const { decimals = 0, separator = ',' } = options;
  
  // Handle negative values
  const isNegative = value < 0n;
  const absValue = isNegative ? -value : value;
  
  // Convert to string
  let numStr = absValue.toString();
  
  // Add decimal point if needed
  if (decimals > 0) {
    // Pad with zeros if needed
    while (numStr.length <= decimals) {
      numStr = '0' + numStr;
    }
    
    const integerPart = numStr.slice(0, numStr.length - decimals) || '0';
    const fractionalPart = numStr.slice(numStr.length - decimals);
    
    // Add separators to integer part
    const formattedIntegerPart = integerPart
      .split('')
      .reverse()
      .join('')
      .match(/.{1,3}/g)
      ?.join(separator)
      .split('')
      .reverse()
      .join('') || '0';
      
    numStr = formattedIntegerPart + '.' + fractionalPart;
  } else {
    // Just add separators
    numStr = numStr
      .split('')
      .reverse()
      .join('')
      .match(/.{1,3}/g)
      ?.join(separator)
      .split('')
      .reverse()
      .join('') || '0';
  }
  
  return isNegative ? '-' + numStr : numStr;
}

/**
 * Convert e8s BigInt to a human-readable format with 8 decimal places
 * This is specifically for converting ICP/ICUSD e8s to their decimal representation
 */
export function formatTokenE8s(e8sAmount: bigint): string {
  const isNegative = e8sAmount < 0n;
  let absValue = isNegative ? -e8sAmount : e8sAmount;
  
  // Convert to string with proper decimal placement
  let intPart = absValue / 100_000_000n;
  let fracPart = absValue % 100_000_000n;
  
  // Format the fractional part to always have 8 digits
  let fracStr = fracPart.toString().padStart(8, '0');
  
  // Trim trailing zeros if not needed
  fracStr = fracStr.replace(/0+$/, '');
  
  // Construct the final string
  let result = intPart.toString();
  if (fracStr.length > 0) {
    result += '.' + fracStr;
  }
  
  return isNegative ? '-' + result : result;
}

/**
 * Cast a value to BigInt if it's not already, handling string and number inputs
 */
export function toBigInt(value: string | number | bigint | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.floor(value));
  return BigInt(value);
}

// Export a singleton instance for easier imports
export const BigIntUtils = {
  stringify: stringifyWithBigInt,
  parse: parseWithBigInt,
  format: formatBigInt,
  formatE8s: formatTokenE8s,
  toBigInt
};
