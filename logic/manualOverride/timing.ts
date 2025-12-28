/**
 * Manual Override Timing Logic
 *
 * Pure functions for calculating manual override timing and expiration.
 * This module is isolated from Homey dependencies to enable comprehensive testing.
 */

export const MANUAL_OVERRIDE_DURATION = 15 * 60 * 1000; // 15 minutes in milliseconds
export const LOG_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds

export interface ManualOverrideState {
  isActive: boolean;
  remainingMinutes: number;
  timeSinceManual: number;
  expirationTime: number;
}

/**
 * Check if manual override is currently active
 * @param manualOverrideTimestamp - Timestamp when manual override was activated (undefined if not active)
 * @param now - Current timestamp in milliseconds (defaults to Date.now())
 * @returns True if manual override is active, false otherwise
 */
export function isManualOverrideActive(
  manualOverrideTimestamp: number | undefined,
  now: number = Date.now(),
): boolean {
  if (!manualOverrideTimestamp) {
    return false;
  }
  const timeSinceManual = now - manualOverrideTimestamp;
  return timeSinceManual < MANUAL_OVERRIDE_DURATION;
}

/**
 * Calculate remaining minutes until manual override expires
 * @param manualOverrideTimestamp - Timestamp when manual override was activated (undefined if not active)
 * @param now - Current timestamp in milliseconds (defaults to Date.now())
 * @returns Remaining minutes until expiration (0 if expired or not active)
 */
export function calculateRemainingMinutes(
  manualOverrideTimestamp: number | undefined,
  now: number = Date.now(),
): number {
  if (!manualOverrideTimestamp) {
    return 0;
  }
  const timeSinceManual = now - manualOverrideTimestamp;
  if (timeSinceManual >= MANUAL_OVERRIDE_DURATION) {
    return 0;
  }
  return Math.ceil((MANUAL_OVERRIDE_DURATION - timeSinceManual) / (60 * 1000));
}

/**
 * Calculate expiration time for manual override
 * @param manualOverrideTimestamp - Timestamp when manual override was activated (undefined if not active)
 * @returns Expiration timestamp in milliseconds, or undefined if not active
 */
export function calculateExpirationTime(manualOverrideTimestamp: number | undefined): number | undefined {
  if (!manualOverrideTimestamp) {
    return undefined;
  }
  return manualOverrideTimestamp + MANUAL_OVERRIDE_DURATION;
}

/**
 * Check if we should log remaining time (to avoid spam)
 * @param lastLogTime - Timestamp of last log (undefined if never logged)
 * @param now - Current timestamp in milliseconds (defaults to Date.now())
 * @returns True if enough time has passed since last log, false otherwise
 */
export function shouldLogRemainingTime(
  lastLogTime: number | undefined,
  now: number = Date.now(),
): boolean {
  if (!lastLogTime) {
    return true;
  }
  return (now - lastLogTime) >= LOG_INTERVAL;
}

/**
 * Check if we should log expiration (only log once per expiration)
 * @param lastExpirationLog - Timestamp of last expiration log (undefined if never logged)
 * @param expirationTime - Expiration timestamp to check against
 * @returns True if this expiration hasn't been logged yet, false otherwise
 */
export function shouldLogExpiration(
  lastExpirationLog: number | undefined,
  expirationTime: number,
): boolean {
  if (!lastExpirationLog) {
    return true;
  }
  return lastExpirationLog < expirationTime;
}

/**
 * Get complete manual override state
 * @param manualOverrideTimestamp - Timestamp when manual override was activated (undefined if not active)
 * @param now - Current timestamp in milliseconds (defaults to Date.now())
 * @returns Complete manual override state object with isActive, remainingMinutes, timeSinceManual, and expirationTime
 */
export function getManualOverrideState(
  manualOverrideTimestamp: number | undefined,
  now: number = Date.now(),
): ManualOverrideState {
  if (!manualOverrideTimestamp) {
    return {
      isActive: false,
      remainingMinutes: 0,
      timeSinceManual: 0,
      expirationTime: 0,
    };
  }

  const timeSinceManual = now - manualOverrideTimestamp;
  const isActive = isManualOverrideActive(manualOverrideTimestamp, now);
  const remainingMinutes = calculateRemainingMinutes(manualOverrideTimestamp, now);
  const expirationTime = calculateExpirationTime(manualOverrideTimestamp) || 0;

  return {
    isActive,
    remainingMinutes,
    timeSinceManual,
    expirationTime,
  };
}
