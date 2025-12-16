'use strict';

import Homey from 'homey';

const BASE_URL = 'https://mysmob.api.connect.skoda-auto.cz';

interface Vehicle {
  vin: string;
  name: string;
}

interface VehicleStatus {
  status: {
    overall: {
      doorsLocked: string;
      locked: string;
      doors: string;
      windows: string;
      lights: string;
      reliableLockStatus: string;
    };
    detail: {
      sunroof: string;
      trunk: string;
      bonnet: string;
    };
    carCapturedTimestamp: string;
  };
  charging: {
    status: {
      chargingRateInKilometersPerHour: number;
      chargePowerInKw: number;
      remainingTimeToFullyChargedInMinutes: number;
      state: string;
      battery: {
        remainingCruisingRangeInMeters: number;
        stateOfChargeInPercent: number;
      };
    };
    settings: {
      targetStateOfChargeInPercent: number;
      batteryCareModeTargetValueInPercent: number;
      preferredChargeMode: string;
      availableChargeModes: string[];
      chargingCareMode: string;
      autoUnlockPlugWhenCharged: string;
      maxChargeCurrentAc: string;
    };
    carCapturedTimestamp: string;
    errors: any[];
  };
  timestamp: string;
}

class SkodaVehicleDriver extends Homey.Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('SkodaVehicleDriver has been initialized');
  }

  /**
   * Get access token from app
   */
  async getAccessToken(): Promise<string> {
    const app = this.homey.app as any;
    // Prefer stored access token first to avoid unnecessary refreshes
    if (typeof app.getStoredAccessTokenOrRefresh === 'function') {
      return await app.getStoredAccessTokenOrRefresh();
    }
    return await app.getAccessToken();
  }

  /**
   * List vehicles from garage with 401/403 recovery
   */
  async listVehicles(accessToken: string, retryOnAuth: boolean = true): Promise<Vehicle[]> {
    this.log('[PAIR] listVehicles: preparing request to garage API');
    const url =
      `${BASE_URL}/api/v2/garage?connectivityGenerations=MOD1` +
      `&connectivityGenerations=MOD2&connectivityGenerations=MOD3` +
      `&connectivityGenerations=MOD4`;

    this.log(`[PAIR] listVehicles: GET ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    this.log(`[PAIR] listVehicles: response status ${response.status}`);

    if (!response.ok) {
      const text = await response.text();
      const status = response.status;
      
      // Handle 401/403 by refreshing token and retrying
      if ((status === 401 || status === 403) && retryOnAuth) {
        this.log('[PAIR] 401/403 error detected, refreshing token and retrying');
        try {
          const app = this.homey.app as any;
          if (app.handleAuthError) {
            const newAccessToken = await app.handleAuthError();
            // Retry with new token (don't retry again to prevent infinite loops)
            return await this.listVehicles(newAccessToken, false);
          } else {
            throw new Error('handleAuthError method not available');
          }
        } catch (recoveryError) {
          const errorMessage = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
          this.error('[PAIR] Failed to recover from 401/403:', errorMessage);
          throw new Error(`List vehicles failed ${status}: Authentication recovery failed`);
        }
      }
      
      throw new Error(`List vehicles failed ${status}: ${text}`);
    }

    const data = await response.json() as { vehicles?: Vehicle[] };
    const vehicles = data.vehicles || [];
    this.log(`[PAIR] listVehicles: received ${vehicles.length} vehicle(s)`);
    vehicles.slice(0, 5).forEach((v, i) => {
      this.log(`[PAIR] vehicle #${i + 1}: name="${v.name || 'Unnamed'}" vin="${v.vin}"`);
    });

    return data.vehicles || [];
  }

  /**
   * onPairListDevices is called when a user is adding a device
   * and the 'list_devices' view is being shown.
   */
  async onPairListDevices() {
    try {
      this.log('[PAIR] ===== Starting vehicle discovery =====');
      
      // Get access token (will refresh if needed)
      let accessToken: string;
      try {
        this.log('[PAIR] Getting access token...');
        accessToken = await this.getAccessToken();
        this.log(`[PAIR] Access token obtained successfully (length: ${accessToken.length})`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
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
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
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
        
        this.log(`[PAIR] Device object created:`, JSON.stringify(deviceObj));
        return deviceObj;
      });

      this.log(`[PAIR] ===== Returning ${deviceList.length} device(s) for pairing =====`);
      this.log(`[PAIR] Device names: ${deviceList.map(d => d.name).join(', ')}`);
      
      if (deviceList.length === 0) {
        this.error('[PAIR] No devices to return for pairing');
        throw new Error('No vehicles found. Please ensure your Skoda Connect account has at least one vehicle.');
      }
      
      return deviceList;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.error('Error in onPairListDevices:', errorMessage);
      throw error;
    }
  }

}

module.exports = SkodaVehicleDriver;

