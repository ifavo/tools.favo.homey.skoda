import type Homey from 'homey';
import type { ChargingControlState } from './chargingControl';

/**
 * Charging control state implementation
 * 
 * Manages the in-memory state of automatic charging control flags.
 * This class implements the ChargingControlState interface to provide
 * state management for low battery and low price charging control.
 */
export class ChargingControlStateImpl implements ChargingControlState {
  public lowBatteryDeviceEnabled = false;
  public lowPriceDeviceEnabled = false;
  private readonly device: Homey.Device;
  private readonly manualOverrideDuration: number;

  /**
   * Create a new charging control state instance
   * @param device - Homey device instance
   * @param manualOverrideDuration - Duration of manual override in milliseconds
   */
  constructor(device: Homey.Device, manualOverrideDuration: number) {
    this.device = device;
    this.manualOverrideDuration = manualOverrideDuration;
  }

  /**
   * Set low battery enabled flag
   * @param value - Whether low battery control is enabled
   */
  setLowBatteryEnabled(value: boolean): void {
    this.lowBatteryDeviceEnabled = value;
  }

  /**
   * Set low price enabled flag
   * @param value - Whether low price control is enabled
   */
  setLowPriceEnabled(value: boolean): void {
    this.lowPriceDeviceEnabled = value;
  }

  /**
   * Get manual override duration
   * @returns Manual override duration in milliseconds
   */
  getManualOverrideDuration(): number {
    return this.manualOverrideDuration;
  }
}

