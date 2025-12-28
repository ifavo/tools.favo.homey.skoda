/**
 * Vehicle Status to Capability Mapping
 *
 * Pure functions for converting VehicleStatus API responses to Homey capability values.
 * This module is isolated from Homey dependencies to enable comprehensive testing.
 */

import type { VehicleStatus } from '../skodaApi/apiClient';

// Capability names match Homey's naming convention (snake_case)
// eslint-disable-next-line @typescript-eslint/naming-convention
export interface CapabilityValues {
  locked: boolean;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  alarm_contact_door: boolean;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  alarm_contact_trunk: boolean;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  alarm_contact_bonnet: boolean;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  alarm_contact_window: boolean;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  alarm_contact_light: boolean;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  measure_battery: number;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  measure_distance: number;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  measure_power: number;
  onoff: boolean;
}

/**
 * Extract locked state from vehicle status
 * @param status - Vehicle status object
 * @returns True if vehicle is locked, false otherwise
 */
export function extractLockedState(status: VehicleStatus['status']): boolean {
  return status.overall.locked === 'YES' || status.overall.reliableLockStatus === 'LOCKED';
}

/**
 * Extract door contact state from vehicle status
 * @param status - Vehicle status object
 * @returns True if doors are open, false otherwise
 */
export function extractDoorContact(status: VehicleStatus['status']): boolean {
  return status.overall.doors === 'OPEN';
}

/**
 * Extract trunk contact state from vehicle status
 * @param status - Vehicle status object
 * @returns True if trunk is open, false otherwise
 */
export function extractTrunkContact(status: VehicleStatus['status']): boolean {
  return status.detail.trunk === 'OPEN';
}

/**
 * Extract bonnet contact state from vehicle status
 * @param status - Vehicle status object
 * @returns True if bonnet is open, false otherwise
 */
export function extractBonnetContact(status: VehicleStatus['status']): boolean {
  return status.detail.bonnet === 'OPEN';
}

/**
 * Extract window contact state from vehicle status
 * @param status - Vehicle status object
 * @returns True if windows are open, false otherwise
 */
export function extractWindowContact(status: VehicleStatus['status']): boolean {
  return status.overall.windows === 'OPEN';
}

/**
 * Extract light contact state from vehicle status
 * @param status - Vehicle status object
 * @returns True if lights are on, false otherwise
 */
export function extractLightContact(status: VehicleStatus['status']): boolean {
  return status.overall.lights === 'ON';
}

/**
 * Extract battery level from charging status
 * @param charging - Charging status object
 * @returns Battery level as percentage (0-100)
 */
export function extractBatteryLevel(charging: VehicleStatus['charging']): number {
  return charging.status.battery.stateOfChargeInPercent;
}

/**
 * Extract remaining range in kilometers from charging status
 * @param charging - Charging status object
 * @returns Remaining range in kilometers (rounded)
 */
export function extractRemainingRange(charging: VehicleStatus['charging']): number {
  const rangeMeters = charging.status.battery.remainingCruisingRangeInMeters;
  return Math.round(rangeMeters / 1000);
}

/**
 * Extract charging power from charging status
 * @param charging - Charging status object
 * @returns Charging power in kilowatts
 */
export function extractChargingPower(charging: VehicleStatus['charging']): number {
  return charging.status.chargePowerInKw;
}

/**
 * Charging states that indicate active charging
 */
const CHARGING_STATES = ['CHARGING', 'CHARGING_AC', 'CHARGING_DC'] as const;

/**
 * Extract charging state (on/off) from charging status
 * @param charging - Charging status object
 * @returns True if vehicle is actively charging, false otherwise
 */
export function extractChargingState(charging: VehicleStatus['charging']): boolean {
  return CHARGING_STATES.includes(charging.status.state as typeof CHARGING_STATES[number]);
}

/**
 * Map entire VehicleStatus to capability values
 * @param status - Complete vehicle status object
 * @returns Object with all capability values mapped
 */
export function mapVehicleStatusToCapabilities(status: VehicleStatus): CapabilityValues {
  const { status: vehicleStatus, charging } = status;
  return {
    locked: extractLockedState(vehicleStatus),
    alarm_contact_door: extractDoorContact(vehicleStatus),
    alarm_contact_trunk: extractTrunkContact(vehicleStatus),
    alarm_contact_bonnet: extractBonnetContact(vehicleStatus),
    alarm_contact_window: extractWindowContact(vehicleStatus),
    alarm_contact_light: extractLightContact(vehicleStatus),
    measure_battery: extractBatteryLevel(charging),
    measure_distance: extractRemainingRange(charging),
    measure_power: extractChargingPower(charging),
    onoff: extractChargingState(charging),
  };
}
