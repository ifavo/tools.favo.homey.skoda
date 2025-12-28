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
 */
export function calculateExpirationTime(manualOverrideTimestamp: number | undefined): number | undefined {
  if (!manualOverrideTimestamp) {
    return undefined;
  }
  return manualOverrideTimestamp + MANUAL_OVERRIDE_DURATION;
}

/**
 * Check if we should log remaining time (to avoid spam)
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
  const isActive = timeSinceManual < MANUAL_OVERRIDE_DURATION;
  const remainingMinutes = isActive
    ? Math.ceil((MANUAL_OVERRIDE_DURATION - timeSinceManual) / (60 * 1000))
    : 0;
  const expirationTime = manualOverrideTimestamp + MANUAL_OVERRIDE_DURATION;

  return {
    isActive,
    remainingMinutes,
    timeSinceManual,
    expirationTime,
  };
}
