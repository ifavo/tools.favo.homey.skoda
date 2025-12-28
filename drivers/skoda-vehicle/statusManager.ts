import type Homey from 'homey';
import {
  fetchVehicleStatus,
  type VehicleStatus,
  isAuthError,
} from '../../logic/skodaApi/apiClient';
import {
  extractLockedState,
  extractDoorContact,
  extractTrunkContact,
  extractBonnetContact,
  extractWindowContact,
  extractLightContact,
  extractBatteryLevel,
  extractRemainingRange,
  extractChargingPower,
  extractChargingState,
} from '../../logic/vehicleStatus/capabilityMapping';
import { extractErrorMessage } from '../../logic/utils/errorUtils';
import { resolveVin, getAccessToken, updateCapabilitySafely } from './deviceHelpers';
import { isManualOverrideActive, isAutomaticControlActive, checkChargingControl } from './chargingControl';
import type { ChargingControlState } from './chargingControl';
import { updateDeviceImage } from './vehicleInfo';

/**
 * Status management module for handling vehicle status polling and capability updates
 */

/**
 * Get vehicle status from API with improved error handling
 * Throws errors with status codes included in message for 401/403 detection
 * @param device - Homey device instance
 * @param accessToken - Access token for API authentication
 * @param vin - Vehicle identification number
 * @returns Vehicle status object
 */
export async function getVehicleStatus(
  device: Homey.Device,
  accessToken: string,
  vin: string,
): Promise<VehicleStatus> {
  try {
    const status = await fetchVehicleStatus(accessToken, vin);
    return status;
  } catch (error: unknown) {
    device.error('[API] Error fetching vehicle status:', extractErrorMessage(error));

    // Check if it's an auth error for logging
    if (isAuthError(error)) {
      device.error('[API] Authentication error detected (401/403)');
    }

    // Re-throw the error to preserve status codes
    throw error;
  }
}

/**
 * Update device capabilities from status with improved error handling
 * @param device - Homey device instance
 * @param status - Vehicle status object
 * @param state - Charging control state object
 */
export async function updateCapabilities(
  device: Homey.Device,
  status: VehicleStatus,
  state: ChargingControlState,
): Promise<void> {
  try {
    const { status: vehicleStatus, charging } = status;
    const vin = resolveVin(device);

    // Update capabilities with individual error handling - don't let one failure stop others
    const isLocked = extractLockedState(vehicleStatus);
    await updateCapabilitySafely(device, 'locked', isLocked, 'CAPABILITIES');

    const doorsOpen = extractDoorContact(vehicleStatus);
    await updateCapabilitySafely(device, 'alarm_contact.door', doorsOpen, 'CAPABILITIES');

    const trunkOpen = extractTrunkContact(vehicleStatus);
    await updateCapabilitySafely(device, 'alarm_contact.trunk', trunkOpen, 'CAPABILITIES');

    const bonnetOpen = extractBonnetContact(vehicleStatus);
    await updateCapabilitySafely(device, 'alarm_contact.bonnet', bonnetOpen, 'CAPABILITIES');

    const windowsOpen = extractWindowContact(vehicleStatus);
    await updateCapabilitySafely(device, 'alarm_contact.window', windowsOpen, 'CAPABILITIES');

    const lightsOn = extractLightContact(vehicleStatus);
    await updateCapabilitySafely(device, 'alarm_contact.light', lightsOn, 'CAPABILITIES');

    // Battery/Charging capabilities
    let batteryLevel = 0;
    try {
      batteryLevel = extractBatteryLevel(charging);
      await device.setCapabilityValue('measure_battery', batteryLevel);
    } catch (error: unknown) {
      device.error('[CAPABILITIES] Failed to update battery:', extractErrorMessage(error));
    }

    const rangeKm = extractRemainingRange(charging);
    await updateCapabilitySafely(device, 'measure_distance', rangeKm, 'CAPABILITIES');

    try {
      const chargingPower = extractChargingPower(charging);
      device.log(`[POWER] Current charging power: ${chargingPower} kW`);
      await device.setCapabilityValue('measure_power', chargingPower);
    } catch (error: unknown) {
      device.error('[CAPABILITIES] Failed to update power:', extractErrorMessage(error));
    }

    // Charging state (on/off) - only update from API if manual override is not active AND automatic control is not active
    try {
      const isCharging = extractChargingState(charging);

      // Check if automatic control is active (low price or low battery)
      const isAutomaticControlActiveValue = isAutomaticControlActive(device, state);

      if (!isManualOverrideActive(device) && !isAutomaticControlActiveValue) {
        await device.setCapabilityValue('onoff', isCharging);
        device.log(`[ONOFF] Updated from API: ${isCharging ? 'ON' : 'OFF'} (charging state: ${charging.status.state})`);
      } else {
        const currentOnOff = device.getCapabilityValue('onoff');
        if (isManualOverrideActive(device)) {
          device.log(`[ONOFF] Skipping API update (manual override active), keeping current state: ${currentOnOff ? 'ON' : 'OFF'}`);
        } else if (isAutomaticControlActiveValue) {
          device.log(`[ONOFF] Skipping API update (automatic control active), keeping current state: ${currentOnOff ? 'ON' : 'OFF'}`);
        }
      }
    } catch (error: unknown) {
      device.error('[CAPABILITIES] Failed to update onoff:', extractErrorMessage(error));
    }

    // Ensure VIN is stored in both store and settings
    if (vin) {
      try {
        await device.setStoreValue('vin', vin);
        const currentVinSetting = device.getSetting('vin');
        if (!currentVinSetting || currentVinSetting !== vin) {
          await device.setSettings({ vin: vin as string });
        }
      } catch (error: unknown) {
        device.error('[CAPABILITIES] Failed to store VIN:', extractErrorMessage(error));
      }
    }

    // Store full status in device settings for reference
    try {
      await device.setSettings({
        vin: vin || device.getSetting('vin') || '',
        lastStatus: JSON.stringify(status),
        lastUpdate: new Date().toISOString(),
      });
    } catch (error: unknown) {
      device.error('[CAPABILITIES] Failed to store status:', extractErrorMessage(error));
    }

    // Check and control charging device (low battery takes priority)
    // Wrap in try-catch to prevent crashes
    try {
      await checkChargingControl(device, state, batteryLevel);
    } catch (error: unknown) {
      device.error('[CAPABILITIES] Failed to check charging control:', extractErrorMessage(error));
      // Don't throw - continue with image update
    }

    // Update device image from status if available
    try {
      await updateDeviceImage(device, status);
    } catch (error: unknown) {
      device.error('[CAPABILITIES] Failed to update device image:', extractErrorMessage(error));
      // Don't throw - image update failure shouldn't break status updates
    }

    device.log(`Capabilities updated successfully for VIN: ${vin || 'unknown'}`);
  } catch (error: unknown) {
    device.error('[CAPABILITIES] Critical error updating capabilities:', extractErrorMessage(error));
    // Don't throw - let the polling interval continue
  }
}

/**
 * Fetch and update vehicle status with improved error handling and 401 recovery
 * @param device - Homey device instance
 * @param state - Charging control state object
 */
export async function refreshStatus(
  device: Homey.Device,
  state: ChargingControlState,
): Promise<void> {
  try {
    let accessToken: string;
    try {
      accessToken = await getAccessToken(device);
    } catch (tokenError: unknown) {
      const errorMessage = extractErrorMessage(tokenError);
      device.error('[STATUS] Failed to get access token:', errorMessage);
      // Try to recover by forcing token refresh
      try {
        const app = device.homey.app as unknown as { handleAuthError?: () => Promise<string> };
        if (app.handleAuthError) {
          device.log('[STATUS] Attempting to recover from token error');
          accessToken = await app.handleAuthError();
        } else {
          throw tokenError; // Re-throw if recovery method not available
        }
      } catch (recoveryError: unknown) {
        const recoveryMessage = extractErrorMessage(recoveryError);
        device.error('[STATUS] Token recovery failed:', recoveryMessage);
        device.setUnavailable(`Token error: ${recoveryMessage.substring(0, 50)}`).catch((setError: unknown) => {
          device.error('[STATUS] Failed to set unavailable status:', extractErrorMessage(setError));
        });
        return; // Exit early
      }
    }

    let vin = resolveVin(device);

    // Auto-detect VIN if not stored
    if (!vin) {
      device.log('VIN not found, attempting to auto-detect...');
      try {
        const app = device.homey.app as unknown as {
          executeWithAuthRecovery?: <T>(apiCall: (token: string) => Promise<T>, context?: string) => Promise<T>;
          listVehicles: (token: string) => Promise<Array<{ vin: string; name: string }>>;
        };
        // Use central auth recovery if available
        const vehicles = await (app && typeof app.executeWithAuthRecovery === 'function'
          ? app.executeWithAuthRecovery(async (token: string) => app.listVehicles(token), 'STATUS')
          : app.listVehicles(accessToken));

        if (vehicles && vehicles.length > 0) {
          vin = vehicles[0].vin;
          await device.setStoreValue('vin', vin);
          await device.setSettings({ vin: vin as string });
          device.log(`Auto-detected VIN: ${vin}`);
        } else {
          throw new Error('No vehicles found and VIN not configured');
        }
      } catch (vinError: unknown) {
        const errorMessage = extractErrorMessage(vinError);
        device.error('[STATUS] Failed to auto-detect VIN:', errorMessage);
        device.setUnavailable(`VIN detection failed: ${errorMessage.substring(0, 50)}`).catch((setError: unknown) => {
          device.error('[STATUS] Failed to set unavailable status:', extractErrorMessage(setError));
        });
        return; // Exit early, don't throw
      }
    }

    // Use central auth recovery for getVehicleStatus
    // At this point, vin is guaranteed to be defined (checked above)
    let status: VehicleStatus;
    try {
      const app = device.homey.app as unknown as {
        executeWithAuthRecovery?: <T>(apiCall: (token: string) => Promise<T>, context?: string) => Promise<T>;
      };
      if (app && typeof app.executeWithAuthRecovery === 'function') {
        status = await app.executeWithAuthRecovery(async (token: string) => {
          return getVehicleStatus(device, token, vin as string);
        }, 'STATUS');
      } else {
        // Fallback to direct call if recovery function not available
        status = await getVehicleStatus(device, accessToken, vin as string);
      }
    } catch (apiError: unknown) {
      const errorMessage = extractErrorMessage(apiError);
      device.error('[STATUS] Failed to get vehicle status:', errorMessage);
      device.setUnavailable(`Status error: ${errorMessage.substring(0, 50)}`).catch((setError: unknown) => {
        device.error('[STATUS] Failed to set unavailable status:', extractErrorMessage(setError));
      });
      return; // Exit early
    }

    await updateCapabilities(device, status, state);

    // Mark device as available after successful update
    await device.setAvailable().catch((setError: unknown) => {
      device.error('[STATUS] Failed to set available status:', extractErrorMessage(setError));
    });

    device.log(`Status refreshed for VIN: ${vin}`);
  } catch (error: unknown) {
    const errorMessage = extractErrorMessage(error);
    device.error('[STATUS] Error refreshing status:', errorMessage);

    // Set unavailable but don't throw - allow interval to retry
    device.setUnavailable(`Error: ${errorMessage.substring(0, 100)}`).catch((setError: unknown) => {
      device.error('[STATUS] Failed to set unavailable status:', extractErrorMessage(setError));
    });

    // Don't throw - let the interval continue running
  }
}

