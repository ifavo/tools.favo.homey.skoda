import type Homey from 'homey';
import type { PriceBlock, PriceCache } from '../../logic/lowPrice/types';
import { decideLowPriceCharging } from '../../logic/lowPrice/decideLowPriceCharging';
import {
  isManualOverrideActive as checkManualOverrideActive,
  calculateRemainingMinutes,
  shouldLogRemainingTime,
  shouldLogExpiration,
  calculateExpirationTime,
} from '../../logic/manualOverride/timing';
import { extractErrorMessage } from '../../logic/utils/errorUtils';
import { getSettingWithDefault, getTimezone } from './deviceHelpers';
import { loadPriceCache, findCheapestBlocksWithLogging } from './priceManager';

/**
 * Charging control state interface
 * Manages the state of automatic charging control
 */
export interface ChargingControlState {
  lowBatteryDeviceEnabled: boolean;
  lowPriceDeviceEnabled: boolean;
  setLowBatteryEnabled(value: boolean): void;
  setLowPriceEnabled(value: boolean): void;
  getManualOverrideDuration(): number;
}

/**
 * Check if manual control override is still active (within 15 minutes)
 * Only logs expiration once to avoid spam
 * @param device - Homey device instance
 * @returns True if manual override is active, false otherwise
 */
export function isManualOverrideActive(device: Homey.Device): boolean {
  try {
    const manualOverrideTimestamp = device.getSetting('_manual_override_timestamp') as number | undefined;
    const now = Date.now();
    const isActive = checkManualOverrideActive(manualOverrideTimestamp, now);

    if (isActive) {
      // Only log remaining time occasionally (every 5 minutes) to avoid spam
      const remainingMinutes = calculateRemainingMinutes(manualOverrideTimestamp, now);
      const lastLogTime = device.getSetting('_last_override_log_time') as number | undefined;
      if (shouldLogRemainingTime(lastLogTime, now)) {
        device.log(`[ONOFF] Manual override active, ${remainingMinutes} minute(s) remaining`);
        device.setSettings({ _last_override_log_time: now }).catch((error: unknown) => {
          device.error('[ONOFF] Failed to store override log time:', extractErrorMessage(error));
        });
      }
    } else {
      // Only log expiration once - check if we've already logged it
      const lastExpirationLog = device.getSetting('_last_expiration_log_time') as number | undefined;
      const expirationTime = calculateExpirationTime(manualOverrideTimestamp);

      // Only log if we haven't logged this expiration yet, or if it's a new expiration
      if (expirationTime && shouldLogExpiration(lastExpirationLog, expirationTime)) {
        device.log('[ONOFF] Manual override expired, automation can take control');
        device.setSettings({ _last_expiration_log_time: now }).catch((error: unknown) => {
          device.error('[ONOFF] Failed to store expiration log time:', extractErrorMessage(error));
        });
      }
    }

    return isActive;
  } catch (error: unknown) {
    device.error('[ONOFF] Error checking manual override:', extractErrorMessage(error));
    return false;
  }
}

/**
 * Check if automatic control (low price or low battery) is currently active
 * @param device - Homey device instance
 * @param state - Charging control state object
 * @returns True if automatic control is active, false otherwise
 */
export function isAutomaticControlActive(device: Homey.Device, state: ChargingControlState): boolean {
  try {
    // Check if device was enabled due to low price or low battery
    const lowPriceEnabled = device.getSetting('_low_price_enabled') as boolean;
    const lowBatteryEnabled = device.getSetting('_low_battery_enabled') as boolean;

    // Also check in-memory flags as they might be more up-to-date
    return (lowPriceEnabled || state.lowPriceDeviceEnabled)
      || (lowBatteryEnabled || state.lowBatteryDeviceEnabled);
  } catch (error: unknown) {
    device.error('[ONOFF] Error checking automatic control:', extractErrorMessage(error));
    return false;
  }
}

/**
 * Turn on charging device
 * @param device - Homey device instance
 * @param state - Charging control state object
 * @param dueToLowBattery - True if turning on due to low battery, false if due to low price
 */
export async function turnOnChargingSelf(
  device: Homey.Device,
  state: ChargingControlState,
  dueToLowBattery: boolean,
): Promise<void> {
  try {
    await device.setCapabilityValue('onoff', true);

    if (dueToLowBattery) {
      state.setLowBatteryEnabled(true);
      await device.setSettings({ _low_battery_enabled: true }).catch((error: unknown) => {
        device.error('[LOW_BATTERY] Failed to store low battery enabled flag:', extractErrorMessage(error));
      });
      device.log('[LOW_BATTERY] Self onoff turned ON (low battery)');
    } else {
      state.setLowPriceEnabled(true);
      await device.setSettings({ _low_price_enabled: true }).catch((error: unknown) => {
        device.error('[LOW_PRICE] Failed to store low price enabled flag:', extractErrorMessage(error));
      });
      device.log('[LOW_PRICE] Self onoff turned ON (low price)');
    }
  } catch (error: unknown) {
    const errorMessage = extractErrorMessage(error);
    device.error('[CHARGING] Failed to turn on self onoff:', errorMessage);
  }
}

/**
 * Turn off charging device
 * @param device - Homey device instance
 * @param state - Charging control state object
 */
export async function turnOffChargingSelf(
  device: Homey.Device,
  state: ChargingControlState,
): Promise<void> {
  try {
    await device.setCapabilityValue('onoff', false);

    // Clear both flags
    state.setLowBatteryEnabled(false);
    state.setLowPriceEnabled(false);
    await device.setSettings({
      _low_battery_enabled: false,
      _low_price_enabled: false,
    }).catch((error: unknown) => {
      device.error('[CHARGING] Failed to clear low battery/price enabled flags:', extractErrorMessage(error));
    });

    device.log('Self onoff turned OFF');
  } catch (error: unknown) {
    const errorMessage = extractErrorMessage(error);
    device.error('[CHARGING] Failed to turn off self onoff:', errorMessage);
  }
}

/**
 * Restore low battery device state from settings on init
 * @param device - Homey device instance
 * @param state - Charging control state object
 */
export async function restoreLowBatteryState(
  device: Homey.Device,
  state: ChargingControlState,
): Promise<void> {
  try {
    const enabled = device.getSetting('_low_battery_enabled') as boolean;
    if (enabled === true) {
      state.setLowBatteryEnabled(true);
      device.log('[LOW_BATTERY] Restored state: device was enabled due to low battery');
    }
  } catch (error: unknown) {
    // Ignore errors, state will be reset on next check
  }
}

/**
 * Check battery level and control charging device if configured
 * @param device - Homey device instance
 * @param state - Charging control state object
 * @param batteryLevel - Current battery level percentage
 */
export async function checkLowBatteryControl(
  device: Homey.Device,
  state: ChargingControlState,
  batteryLevel: number,
): Promise<void> {
  try {
    const threshold = device.getSetting('low_battery_threshold') as number;

    // Skip if not configured
    if (!threshold) {
      return;
    }

    // Check if manual override is still active
    // Note: Low battery control still respects manual override, but low battery takes priority
    // So we only check override when battery is above threshold (turning off)
    if (batteryLevel >= threshold && isManualOverrideActive(device)) {
      device.log('[LOW_BATTERY] Skipping turn-off - manual override still active');
      return;
    }

    device.log(`[LOW_BATTERY] Checking battery: ${batteryLevel}% (threshold: ${threshold}%)`);

    // Check if battery is below threshold
    if (batteryLevel < threshold) {
      // Low battery takes priority - turn on even if manual override is active
      // Turn device ON if not already enabled due to low battery
      if (!state.lowBatteryDeviceEnabled) {
        device.log(`[LOW_BATTERY] Battery below threshold (${batteryLevel}% < ${threshold}%), turning ON self onoff`);
        await turnOnChargingSelf(device, state, true);
      } else {
        device.log('[LOW_BATTERY] Device already enabled due to low battery');
      }
    } else if (state.lowBatteryDeviceEnabled) {
      // Battery is above threshold
      // Turn off if it was enabled due to low battery (but respect manual override)
      device.log(`[LOW_BATTERY] Battery above threshold (${batteryLevel}% >= ${threshold}%), turning OFF self onoff`);
      await turnOffChargingSelf(device, state);
    }
  } catch (error: unknown) {
    device.error('[LOW_BATTERY] Error in low battery control:', extractErrorMessage(error));
  }
}

/**
 * Check low price charging and control device accordingly
 * This uses cached prices (doesn't fetch from API - that's done by the 15-minute interval)
 * Respects manual override (15 minutes after manual control)
 * @param device - Homey device instance
 * @param state - Charging control state object
 */
export async function checkLowPriceCharging(
  device: Homey.Device,
  state: ChargingControlState,
): Promise<void> {
  try {
    // Check if manual override is still active
    if (isManualOverrideActive(device)) {
      device.log('[LOW_PRICE] Skipping automation - manual override still active');
      return;
    }

    const blocksCount = getSettingWithDefault(device, 'low_price_blocks_count', 8);
    // Auto-detect timezone if not configured, fallback to Homey's timezone
    const timezone = getSettingWithDefault(device, 'price_timezone', getTimezone(device));

    device.log(`[LOW_PRICE] Checking low price charging (cheapest ${blocksCount} blocks)`);

    // Load cache from store (don't fetch - use cached data)
    const cache = await loadPriceCache(device);

    // Find cheapest blocks from cached price data (recomputed each time)
    const cheapest = findCheapestBlocksWithLogging(device, cache, blocksCount);

    // Use isolated decision logic
    const now = Date.now();
    const enableLowPrice = true; // Already checked above
    const batteryLevel = device.getCapabilityValue('measure_battery') as number | null;
    const threshold = device.getSetting('low_battery_threshold') as number | null;
    const wasOnDueToPrice = device.getSetting('_low_price_enabled') as boolean;

    const decision = decideLowPriceCharging(cheapest, now, {
      enableLowPrice,
      batteryLevel,
      lowBatteryThreshold: threshold,
      manualOverrideActive: isManualOverrideActive(device),
      wasOnDueToPrice,
    });

    // Execute decision
    if (decision === 'turnOn') {
      device.log('[LOW_PRICE] Current time is in cheapest period, turning ON self onoff');
      await turnOnChargingSelf(device, state, false); // false = not due to low battery
    } else if (decision === 'turnOff') {
      device.log('[LOW_PRICE] Current time is NOT in cheapest period, turning OFF self onoff');
      await turnOffChargingSelf(device, state);
    }

  } catch (error: unknown) {
    const errorMessage = extractErrorMessage(error);
    device.error('[LOW_PRICE] Error in low price charging:', errorMessage);
  }
}

/**
 * Check battery level and control charging (self on/off) if configured
 * Low battery takes priority over low price charging
 * Respects manual override (15 minutes after manual control)
 * @param device - Homey device instance
 * @param state - Charging control state object
 * @param batteryLevel - Current battery level percentage
 */
export async function checkChargingControl(
  device: Homey.Device,
  state: ChargingControlState,
  batteryLevel: number,
): Promise<void> {
  // Check if manual override is still active
  if (isManualOverrideActive(device)) {
    device.log('[CHARGING_CONTROL] Skipping automation - manual override still active');
    return;
  }

  const threshold = device.getSetting('low_battery_threshold') as number;

  // Check low battery first (takes priority)
  if (threshold && batteryLevel < threshold) {
    await checkLowBatteryControl(device, state, batteryLevel);
    return; // Low battery takes priority, skip price check
  }

  // If low battery was previously on, turn off when recovered
  if (state.lowBatteryDeviceEnabled) {
    await turnOffChargingSelf(device, state);
  }

  // Check low price charging if enabled
  const enableLowPrice = device.getSetting('enable_low_price_charging') as boolean;
  if (enableLowPrice) {
    await checkLowPriceCharging(device, state);
  } else if (state.lowPriceDeviceEnabled) {
    // If low price is disabled, ensure off if it was on due to low price
    await turnOffChargingSelf(device, state);
  }
}
