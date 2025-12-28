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
 */
export function extractLockedState(status: VehicleStatus['status']): boolean {
  return status.overall.locked === 'YES' || status.overall.reliableLockStatus === 'LOCKED';
}

/**
 * Extract door contact state from vehicle status
 */
export function extractDoorContact(status: VehicleStatus['status']): boolean {
  return status.overall.doors === 'OPEN';
}

/**
 * Extract trunk contact state from vehicle status
 */
export function extractTrunkContact(status: VehicleStatus['status']): boolean {
  return status.detail.trunk === 'OPEN';
}

/**
 * Extract bonnet contact state from vehicle status
 */
export function extractBonnetContact(status: VehicleStatus['status']): boolean {
  return status.detail.bonnet === 'OPEN';
}

/**
 * Extract window contact state from vehicle status
 */
export function extractWindowContact(status: VehicleStatus['status']): boolean {
  return status.overall.windows === 'OPEN';
}

/**
 * Extract light contact state from vehicle status
 */
export function extractLightContact(status: VehicleStatus['status']): boolean {
  return status.overall.lights === 'ON';
}

/**
 * Extract battery level from charging status
 */
export function extractBatteryLevel(charging: VehicleStatus['charging']): number {
  return charging.status.battery.stateOfChargeInPercent;
}

/**
 * Extract remaining range in kilometers from charging status
 */
export function extractRemainingRange(charging: VehicleStatus['charging']): number {
  const rangeMeters = charging.status.battery.remainingCruisingRangeInMeters;
  return Math.round(rangeMeters / 1000);
}

/**
 * Extract charging power from charging status
 */
export function extractChargingPower(charging: VehicleStatus['charging']): number {
  return charging.status.chargePowerInKw;
}

/**
 * Extract charging state (on/off) from charging status
 */
export function extractChargingState(charging: VehicleStatus['charging']): boolean {
  const state = charging.status.state;
  return state === 'CHARGING' || state === 'CHARGING_AC' || state === 'CHARGING_DC';
}

/**
 * Map entire VehicleStatus to capability values
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
