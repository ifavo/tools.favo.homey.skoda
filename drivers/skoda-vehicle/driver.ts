'use strict';

import Homey from 'homey';
import { fetchVehicles, type Vehicle } from '../../logic/skodaApi/apiClient';
import { extractErrorMessage } from '../../logic/utils/errorUtils';

/**
 * Interface for SkodaApp methods used by the driver
 */
interface SkodaAppInterface {
  getStoredAccessTokenOrRefresh?(): Promise<string>;
  getAccessToken(): Promise<string>;
  executeWithAuthRecovery?<T>(
    apiCall: (accessToken: string) => Promise<T>,
    context?: string,
  ): Promise<T>;
}

class SkodaVehicleDriver extends Homey.Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit(): Promise<void> {
    this.log('SkodaVehicleDriver has been initialized');
  }

  /**
   * Get access token from app
   * @returns Access token string
   */
  async getAccessToken(): Promise<string> {
    const app = this.homey.app as unknown as SkodaAppInterface;
    // Prefer stored access token first to avoid unnecessary refreshes
    if (app.getStoredAccessTokenOrRefresh && typeof app.getStoredAccessTokenOrRefresh === 'function') {
      return app.getStoredAccessTokenOrRefresh();
    }
    return app.getAccessToken();
  }

  /**
   * List vehicles from garage with automatic 401/403 recovery
   * @param accessToken - Access token for API calls
   * @returns Array of vehicles
   */
  async listVehicles(accessToken: string): Promise<Vehicle[]> {
    const app = this.homey.app as unknown as SkodaAppInterface;

    // Use the app's central auth recovery function if available
    if (app.executeWithAuthRecovery && typeof app.executeWithAuthRecovery === 'function') {
      return app.executeWithAuthRecovery(async (token: string) => {
        return this.listVehiclesInternal(token);
      }, 'PAIR');
    }

    // Fallback to direct call if recovery function not available
    return this.listVehiclesInternal(accessToken);
  }

  /**
   * Internal method to list vehicles (without auth recovery)
   */
  private async listVehiclesInternal(accessToken: string): Promise<Vehicle[]> {
    this.log('[PAIR] listVehicles: preparing request to garage API');

    const vehicles = await fetchVehicles(accessToken);

    this.log(`[PAIR] listVehicles: received ${vehicles.length} vehicle(s)`);
    vehicles.slice(0, 5).forEach((v, i) => {
      this.log(`[PAIR] vehicle #${i + 1}: name="${v.name || 'Unnamed'}" vin="${v.vin}"`);
    });

    return vehicles;
  }

  /**
   * onPairListDevices is called when a user is adding a device
   * and the 'list_devices' view is being shown.
   * @returns Array of device objects for pairing
   */
  async onPairListDevices(): Promise<Array<{
    name: string;
    data: { id: string };
    store: { vin: string };
    settings: { vin: string };
  }>> {
    try {
      this.log('[PAIR] ===== Starting vehicle discovery =====');

      // Get access token (will refresh if needed)
      let accessToken: string;
      try {
        this.log('[PAIR] Getting access token...');
        accessToken = await this.getAccessToken();
        this.log(`[PAIR] Access token obtained successfully (length: ${accessToken.length})`);
      } catch (error: unknown) {
        const errorMessage = extractErrorMessage(error);
        this.error('Failed to get access token:', errorMessage);

        if (errorMessage.includes('Refresh token not configured')) {
          throw new Error('Refresh token not configured. Please set it in App Settings → Skoda → Refresh Token');
        } else if (errorMessage.includes('401') || errorMessage.includes('403')) {
          throw new Error('Authentication failed. Your refresh token may be invalid or expired. Please check your refresh token in App Settings.');
        } else {
          throw new Error(`Failed to authenticate: ${errorMessage}`);
        }
      }

      // List vehicles
      let vehicles: Vehicle[];
      try {
        this.log('[PAIR] Fetching vehicles from API...');
        vehicles = await this.listVehicles(accessToken);
        this.log(`[PAIR] Found ${vehicles.length} vehicle(s)`);
        vehicles.forEach((v, i) => {
          this.log(`[PAIR] Vehicle ${i + 1}: ${v.name || 'Unnamed'} (VIN: ${v.vin})`);
        });
      } catch (error: unknown) {
        const errorMessage = extractErrorMessage(error);
        this.error('Failed to list vehicles:', errorMessage);

        if (errorMessage.includes('401') || errorMessage.includes('403')) {
          throw new Error('Authentication failed. Your access token may be invalid. Please check your refresh token in App Settings.');
        } else if (errorMessage.includes('404')) {
          throw new Error('API endpoint not found. Please ensure you are using a valid Skoda Connect account.');
        } else {
          throw new Error(`Failed to fetch vehicles: ${errorMessage}`);
        }
      }

      if (vehicles.length === 0) {
        throw new Error('No vehicles found. Please ensure your Skoda Connect account has at least one vehicle registered.');
      }

      // Return vehicle list - ensure proper structure for Homey SDK 3
      this.log('[PAIR] Preparing device list...');
      const deviceList = vehicles.map((vehicle) => {
        const deviceName = vehicle.name || `Skoda Vehicle ${vehicle.vin}`;
        this.log(`[PAIR] Preparing device: ${deviceName} (VIN: ${vehicle.vin})`);

        const deviceObj = {
          name: deviceName,
          data: {
            id: vehicle.vin,
          },
          store: {
            vin: vehicle.vin,
          },
          settings: {
            vin: vehicle.vin,
          },
        };

        this.log('[PAIR] Device object created:', JSON.stringify(deviceObj));
        return deviceObj;
      });

      this.log(`[PAIR] ===== Returning ${deviceList.length} device(s) for pairing =====`);
      this.log(`[PAIR] Device names: ${deviceList.map((d) => d.name).join(', ')}`);

      if (deviceList.length === 0) {
        this.error('[PAIR] No devices to return for pairing');
        throw new Error('No vehicles found. Please ensure your Skoda Connect account has at least one vehicle.');
      }

      return deviceList;
    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      this.error('Error in onPairListDevices:', errorMessage);
      throw error;
    }
  }

}

module.exports = SkodaVehicleDriver;
