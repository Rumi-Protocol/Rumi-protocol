/**
 * Format a number as a string with the given number of decimals
 */
export function formatNumber(
  value: number | string | undefined | null, 
  decimals: number = 2, 
  options: Intl.NumberFormatOptions = {}
): string {
  if (value === undefined || value === null) return '0';
  
  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  
  if (isNaN(numValue)) return '0';
  
  const formatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
    ...options
  });
  
  return formatter.format(numValue);
}

/**
 * Format a number with safety checks for Infinity and NaN
 * @param value Number to format
 * @param maxLength Maximum length (to prevent extremely large numbers)
 */
export function safeFormatNumber(value: number, maxLength: number = 10): string {
  if (!isFinite(value)) return value > 0 ? '∞' : '-∞';
  if (isNaN(value)) return '0';
  
  const formatted = formatNumber(value);
  
  // Cap extremely large numbers
  if (formatted.length > maxLength) {
    return `>${formatted.charAt(0)}e${formatted.length - 1}`;
  }
  
  return formatted;
}

/**
 * Format a number as a currency string
 */
export function formatCurrency(
  value: number | string | undefined | null, 
  currency: string = 'USD', 
  decimals: number = 2
): string {
  return formatNumber(value, decimals, {
    style: 'currency',
    currency
  });
}

/**
 * Format a percentage
 */
export function formatPercent(
  value: number | string | undefined | null,
  decimals: number = 2
): string {
  return formatNumber(value, decimals, {
    style: 'percent',
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals
  });
}

/**
 * Format an address for display by truncating the middle
 */
export function formatAddress(
  address: string | null | undefined,
  startChars: number = 6,
  endChars: number = 4
): string {
  if (!address) return '';
  if (address.length <= startChars + endChars) return address;
  
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}

/**
 * Format a date
 */
export function formatDate(
  timestamp: number | Date,
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }
): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  return new Intl.DateTimeFormat('en-US', options).format(date);
}