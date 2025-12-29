/**
 * Date and Time Utilities
 *
 * Pure functions for date and time calculations.
 * This module is isolated from Homey dependencies to enable comprehensive testing.
 */

/**
 * Milliseconds in one day
 */
export const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Milliseconds in one hour
 */
export const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

/**
 * Milliseconds in one minute
 */
export const MILLISECONDS_PER_MINUTE = 60 * 1000;

/**
 * Get UTC date number (1-31) for a timestamp
 * @param timestamp - Unix timestamp in milliseconds
 * @returns UTC date number (1-31)
 */
export function getUTCDate(timestamp: number): number {
  return new Date(timestamp).getUTCDate();
}

/**
 * Get UTC date number for today
 * @param now - Current timestamp (defaults to Date.now())
 * @returns UTC date number for today
 */
export function getTodayUTCDate(now: number = Date.now()): number {
  return getUTCDate(now);
}

/**
 * Get UTC date number for tomorrow
 * @param now - Current timestamp (defaults to Date.now())
 * @returns UTC date number for tomorrow
 */
export function getTomorrowUTCDate(now: number = Date.now()): number {
  return getUTCDate(now + MILLISECONDS_PER_DAY);
}

/**
 * Calculate milliseconds until the next 15-minute boundary
 * Aligns to :00, :15, :30, :45 minutes past the hour
 * @param now - Current timestamp in milliseconds (defaults to Date.now())
 * @returns Milliseconds until the next 15-minute boundary
 */
export function getMillisecondsUntilNext15MinuteBoundary(now: number = Date.now()): number {
  const date = new Date(now);
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const milliseconds = date.getMilliseconds();
  
  // Calculate which 15-minute block we're in (0, 1, 2, or 3)
  const currentBlock = Math.floor(minutes / 15);
  
  // Calculate the next block (always move to next, even if exactly on boundary)
  const nextBlock = currentBlock + 1;
  
  // Calculate the target minutes for the next block
  let targetMinutes = nextBlock * 15;
  
  // If we've passed the last block of the hour (45), wrap to next hour
  let targetTime = new Date(now);
  if (targetMinutes >= 60) {
    targetTime.setHours(targetTime.getHours() + 1);
    targetTime.setMinutes(0);
  } else {
    targetTime.setMinutes(targetMinutes);
  }
  
  // Always set seconds and milliseconds to 0 for clean boundaries
  targetTime.setSeconds(0);
  targetTime.setMilliseconds(0);
  
  const delay = targetTime.getTime() - now;
  
  // Ensure we return a positive delay (should always be, but handle edge cases)
  return delay > 0 ? delay : delay + (15 * MILLISECONDS_PER_MINUTE);
}

