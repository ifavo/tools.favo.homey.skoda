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

