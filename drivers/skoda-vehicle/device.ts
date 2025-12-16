'use strict';

import Homey from 'homey';

const BASE_URL = 'https://mysmob.api.connect.skoda-auto.cz';

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
    renders?: {
      lightMode?: {
        oneX?: string;
      };
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
    errors: unknown[];
  };
  timestamp: string;
}

interface PriceBlock {
  start: number;
  end: number;
  price: number;
}

type PriceCache = Record<string, PriceBlock>;

interface HomeyDeviceApi {
  setCapabilityValue(capabilityId: string, value: any): Promise<void>;
}

interface HomeyDevicesManager {
  getDevice(options: { id: string }): Promise<HomeyDeviceApi | undefined>;
}

class SkodaVehicleDevice extends Homey.Device {

  private pollingInterval?: NodeJS.Timeout;
  private priceUpdateInterval?: NodeJS.Timeout;
  private infoUpdateInterval?: NodeJS.Timeout;
  private readonly POLL_INTERVAL = 60000; // 60 seconds
  private readonly PRICE_UPDATE_INTERVAL = 15 * 60 * 1000; // 15 minutes
  private readonly INFO_UPDATE_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours (once per day)
  private lowBatteryDeviceEnabled = false; // Track if device was enabled due to low battery
  private lowPriceDeviceEnabled = false; // Track if device was enabled due to low price

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('SkodaVehicleDevice has been initialized');
    
    // Ensure VIN is stored from data, store, or settings
    const vin = this.getStoreValue('vin') || this.getData().vin || this.getSetting('vin');
    if (vin) {
      await this.setStoreValue('vin', vin);
      await this.setSettings({ vin: vin as string });
      this.log(`Device initialized with VIN: ${vin}`);
    } else {
      this.log('VIN not found, will be auto-detected on first status refresh');
    }
    
    // Restore low battery device state
    await this.restoreLowBatteryState();
    
    // Start polling for status updates
    await this.startPolling();
    
    // Start price update interval if low price charging is enabled
    const enableLowPrice = this.getSetting('enable_low_price_charging') as boolean;
    if (enableLowPrice) {
      await this.startPriceUpdates();
    }
    
    // Start vehicle info update interval (once per day)
    await this.startInfoUpdates();
    
    // Register capability listeners if needed
    this.registerCapabilityListener('locked', this.onCapabilityLocked.bind(this));
    this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.stopPolling();
    this.stopPriceUpdates();
    this.stopInfoUpdates();
    this.log('SkodaVehicleDevice has been deleted');
  }

  /**
   * Get access token from app
   */
  async getAccessToken(): Promise<string> {
    const app = this.homey.app as any;
    return await app.getAccessToken();
  }

  /**
   * Get vehicle status from API
   */
  async getVehicleStatus(accessToken: string, vin: string): Promise<VehicleStatus> {
    const statusUrl = `${BASE_URL}/api/v2/vehicle-status/${vin}`;
    const chargingUrl = `${BASE_URL}/api/v1/charging/${vin}`;

    const [statusResponse, chargingResponse] = await Promise.all([
      fetch(statusUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }),
      fetch(chargingUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }),
    ]);

    if (!statusResponse.ok) {
      const text = await statusResponse.text();
      throw new Error(`Get status failed ${statusResponse.status}: ${text}`);
    }

    if (!chargingResponse.ok) {
      const text = await chargingResponse.text();
      throw new Error(`Get charging status failed ${chargingResponse.status}: ${text}`);
    }

    const status = await statusResponse.json() as VehicleStatus['status'];
    const charging = await chargingResponse.json() as VehicleStatus['charging'];

    return {
      status,
      charging,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Update device capabilities from status
   */
  async updateCapabilities(status: VehicleStatus): Promise<void> {
    try {
      const { status: vehicleStatus, charging } = status;
      const vin = this.getStoreValue('vin') || this.getSetting('vin') || this.getData().vin;

      // Lock status
      const isLocked = vehicleStatus.overall.locked === 'YES' || 
                       vehicleStatus.overall.reliableLockStatus === 'LOCKED';
      await this.setCapabilityValue('locked', isLocked).catch(this.error);

      // Door contact (OPEN = alarm, CLOSED = no alarm)
      const doorsOpen = vehicleStatus.overall.doors === 'OPEN';
      await this.setCapabilityValue('alarm_contact.door', doorsOpen).catch(this.error);

      // Trunk contact
      const trunkOpen = vehicleStatus.detail.trunk === 'OPEN';
      await this.setCapabilityValue('alarm_contact.trunk', trunkOpen).catch(this.error);

      // Bonnet contact
      const bonnetOpen = vehicleStatus.detail.bonnet === 'OPEN';
      await this.setCapabilityValue('alarm_contact.bonnet', bonnetOpen).catch(this.error);

      // Window contact
      const windowsOpen = vehicleStatus.overall.windows === 'OPEN';
      await this.setCapabilityValue('alarm_contact.window', windowsOpen).catch(this.error);

      // Light contact
      const lightsOn = vehicleStatus.overall.lights === 'ON';
      await this.setCapabilityValue('alarm_contact.light', lightsOn).catch(this.error);

      // Battery/Charging capabilities
      const batteryLevel = charging.status.battery.stateOfChargeInPercent;
      await this.setCapabilityValue('measure_battery', batteryLevel).catch(this.error);

      // Remaining range (convert meters to kilometers)
      const rangeKm = charging.status.battery.remainingCruisingRangeInMeters / 1000;
      await this.setCapabilityValue('measure_distance', Math.round(rangeKm)).catch(this.error);

      // Charging power from API
      const chargingPower = charging.status.chargePowerInKw;
      this.log(`[POWER] Current charging power: ${chargingPower} kW`);
      await this.setCapabilityValue('measure_power', chargingPower).catch(this.error);

      // Charging state (on/off)
      const isCharging = charging.status.state === 'CHARGING' || 
                        charging.status.state === 'CHARGING_AC' ||
                        charging.status.state === 'CHARGING_DC';
      await this.setCapabilityValue('onoff', isCharging).catch(this.error);

      // Ensure VIN is stored in both store and settings
      if (vin) {
        await this.setStoreValue('vin', vin);
        const currentVinSetting = this.getSetting('vin');
        if (!currentVinSetting || currentVinSetting !== vin) {
          await this.setSettings({ vin: vin as string });
        }
      }

      // Store full status in device settings for reference
      await this.setSettings({
        vin: vin || this.getSetting('vin') || '',
        lastStatus: JSON.stringify(status),
        lastUpdate: new Date().toISOString(),
      }).catch(this.error);

      // Check and control charging device (low battery takes priority)
      await this.checkChargingControl(batteryLevel);

      // Update device image from status if available
      await this.updateDeviceImage(status);

      this.log(`Capabilities updated successfully for VIN: ${vin || 'unknown'}`);
    } catch (error) {
      this.error('Error updating capabilities:', error);
      throw error;
    }
  }

  /**
   * Fetch and update vehicle status
   */
  async refreshStatus(): Promise<void> {
    try {
      const accessToken = await this.getAccessToken();
      
      let vin = this.getStoreValue('vin') || this.getSetting('vin') || this.getData().vin;
      
      // Auto-detect VIN if not stored
      if (!vin) {
        this.log('VIN not found, attempting to auto-detect...');
        const app = this.homey.app as any;
        const vehicles = await app.listVehicles(accessToken);
        if (vehicles.length > 0) {
          vin = vehicles[0].vin;
          await this.setStoreValue('vin', vin);
          await this.setSettings({ vin: vin as string });
          this.log(`Auto-detected VIN: ${vin}`);
        } else {
          throw new Error('No vehicles found and VIN not configured');
        }
      }

      const status = await this.getVehicleStatus(accessToken, vin);
      await this.updateCapabilities(status);

      this.log(`Status refreshed for VIN: ${vin}`);
    } catch (error) {
      this.error('Error refreshing status:', error);
      this.setUnavailable(`Error: ${error instanceof Error ? error.message : String(error)}`).catch(this.error);
    }
  }

  /**
   * Start polling for status updates
   */
  async startPolling(): Promise<void> {
    this.stopPolling();
    
    // Initial refresh
    await this.refreshStatus();
    this.setAvailable().catch(this.error);

    // Set up interval
    this.pollingInterval = this.homey.setInterval(() => {
      this.refreshStatus().catch(this.error);
    }, this.POLL_INTERVAL);
  }

  /**
   * Stop polling for status updates
   */
  stopPolling(): void {
    if (this.pollingInterval) {
      this.homey.clearInterval(this.pollingInterval);
      this.pollingInterval = undefined;
    }
  }

  /**
   * Start price update interval (runs every 15 minutes)
   */
  async startPriceUpdates(): Promise<void> {
    this.stopPriceUpdates();
    
    // Initial price update
    await this.updatePricesAndCheckCharging();
    
    // Set up interval for price updates
    this.priceUpdateInterval = this.homey.setInterval(() => {
      this.updatePricesAndCheckCharging().catch(this.error);
    }, this.PRICE_UPDATE_INTERVAL);
    
    this.log(`[LOW_PRICE] Started price update interval (every ${this.PRICE_UPDATE_INTERVAL / 60000} minutes)`);
  }

  /**
   * Stop price update interval
   */
  stopPriceUpdates(): void {
    if (this.priceUpdateInterval) {
      this.homey.clearInterval(this.priceUpdateInterval);
      this.priceUpdateInterval = undefined;
      this.log('[LOW_PRICE] Stopped price update interval');
    }
  }

  /**
   * Start vehicle info update interval (runs once per day)
   */
  async startInfoUpdates(): Promise<void> {
    this.stopInfoUpdates();
    
    // Check if we need to fetch info immediately (if never fetched or last fetch was more than 24h ago)
    const lastInfoFetch = this.getSetting('_last_info_fetch') as number | undefined;
    const now = Date.now();
    const shouldFetchNow = !lastInfoFetch || (now - lastInfoFetch) >= this.INFO_UPDATE_INTERVAL;
    
    if (shouldFetchNow) {
      this.log('[INFO] Fetching vehicle info immediately (never fetched or cache expired)');
      await this.refreshVehicleInfo().catch(this.error);
    } else {
      const hoursUntilNext = Math.ceil((this.INFO_UPDATE_INTERVAL - (now - lastInfoFetch)) / (60 * 60 * 1000));
      this.log(`[INFO] Vehicle info cache still valid, will refresh in ${hoursUntilNext} hour(s)`);
    }
    
    // Set up interval for daily info updates
    this.infoUpdateInterval = this.homey.setInterval(() => {
      this.refreshVehicleInfo().catch(this.error);
    }, this.INFO_UPDATE_INTERVAL);
    
    this.log(`[INFO] Started vehicle info update interval (every ${this.INFO_UPDATE_INTERVAL / (60 * 60 * 1000)} hours)`);
  }

  /**
   * Stop vehicle info update interval
   */
  stopInfoUpdates(): void {
    if (this.infoUpdateInterval) {
      this.homey.clearInterval(this.infoUpdateInterval);
      this.infoUpdateInterval = undefined;
      this.log('[INFO] Stopped vehicle info update interval');
    }
  }

  /**
   * Fetch and update vehicle info (specification, renders, license plate, etc.)
   */
  async refreshVehicleInfo(): Promise<void> {
    try {
      const vin = this.getStoreValue('vin') || this.getSetting('vin') || this.getData().vin;
      if (!vin) {
        this.log('[INFO] VIN not available, skipping vehicle info fetch');
        return;
      }

      this.log(`[INFO] Fetching vehicle info for VIN: ${vin}`);
      const accessToken = await this.getAccessToken();
      const app = this.homey.app as any;
      const info = await app.getVehicleInfo(accessToken, vin);

      // Store license plate
      if (info.licensePlate) {
        await this.setSettings({ 
          license_plate: info.licensePlate,
        }).catch(this.error);
        this.log(`[INFO] License plate stored: ${info.licensePlate}`);
      }

      // Store vehicle name if different
      if (info.name) {
        const currentName = this.getName();
        if (currentName !== info.name) {
          await this.setSettings({ 
            vehicle_name: info.name,
          }).catch(this.error);
          this.log(`[INFO] Vehicle name stored: ${info.name}`);
        }
      }

      // Store specification data
      if (info.specification) {
        await this.setSettings({
          vehicle_model: info.specification.model || '',
          vehicle_title: info.specification.title || '',
          vehicle_model_year: info.specification.modelYear || '',
        }).catch(this.error);
        this.log(`[INFO] Vehicle specification stored: ${info.specification.model || 'N/A'}`);
      }

      // Extract and store image URL from composite_renders
      // Prefer HOME view, fallback to UNMODIFIED_EXTERIOR_SIDE
      let imageUrl: string | undefined;
      
      if (info.compositeRenders && info.compositeRenders.length > 0) {
        // Try HOME view first
        const homeRender = info.compositeRenders.find((r: { viewType: string }) => r.viewType === 'HOME');
        if (homeRender && homeRender.layers && homeRender.layers.length > 0) {
          // Get the base layer (order 0)
          const baseLayer = homeRender.layers.find((l: { order: number }) => l.order === 0);
          if (baseLayer && baseLayer.url) {
            imageUrl = baseLayer.url;
            this.log(`[INFO] Found HOME view image URL`);
          }
        }
        
        // Fallback to UNMODIFIED_EXTERIOR_SIDE
        if (!imageUrl) {
          const sideRender = info.compositeRenders.find((r: { viewType: string }) => r.viewType === 'UNMODIFIED_EXTERIOR_SIDE');
          if (sideRender && sideRender.layers && sideRender.layers.length > 0) {
            const baseLayer = sideRender.layers.find((l: { order: number }) => l.order === 0);
            if (baseLayer && baseLayer.url) {
              imageUrl = baseLayer.url;
              this.log(`[INFO] Found UNMODIFIED_EXTERIOR_SIDE view image URL`);
            }
          }
        }
      }

      if (imageUrl) {
        this.log(`[INFO] Image URL from vehicle info: ${imageUrl}`);
        await this.setSettings({ 
          _vehicle_image_url: imageUrl,
        }).catch(this.error);
        
        // Update device image immediately
        await this.updateDeviceImageFromUrl(imageUrl);
      } else {
        this.log('[INFO] No image URL found in composite_renders');
      }

      // Store last fetch timestamp
      await this.setSettings({ 
        _last_info_fetch: Date.now(),
      }).catch(this.error);

      this.log('[INFO] Vehicle info refreshed successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.error('[INFO] Failed to refresh vehicle info:', errorMessage);
      // Don't throw - info update failure shouldn't break device operation
    }
  }

  /**
   * Update prices and check if charging should be controlled
   */
  async updatePricesAndCheckCharging(): Promise<void> {
    try {
      const deviceId = this.getSetting('low_battery_device_id') as string;
      if (!deviceId || deviceId.trim().length === 0) {
        return;
      }

      const enableLowPrice = this.getSetting('enable_low_price_charging') as boolean;
      if (!enableLowPrice) {
        return;
      }

      this.log('[LOW_PRICE] Updating prices from aWATTar API');
      
      // Auto-detect timezone if not configured, fallback to Homey's timezone
      const timezone = (this.getSetting('price_timezone') as string) || this.getTimezone();
      const hoursCount = (this.getSetting('low_price_hours_count') as number) || 2;

      // Load cache from store
      const cache = await this.loadPriceCache();

      // Fetch and update prices
      const updatedCache = await this.fetchAndUpdatePrices(cache);

      // Find cheapest hours
      const cheapest = this.findCheapestHours(updatedCache, hoursCount);

      // Check if current time is in cheap period
      const now = Date.now();
      const isCheapNow = cheapest.some((b: PriceBlock) => now >= b.start && now < b.end);

      // Control device (only if battery is not low - low battery takes priority)
      const batteryLevel = this.getCapabilityValue('measure_battery') as number;
      const threshold = this.getSetting('low_battery_threshold') as number;
      
      if (threshold && batteryLevel < threshold) {
        this.log('[LOW_PRICE] Battery is low, skipping price-based control (low battery takes priority)');
        return;
      }

      if (isCheapNow) {
        this.log('[LOW_PRICE] Current time is in cheapest period, turning ON self onoff');
        await this.turnOnChargingSelf(false);
      } else {
        const wasOnDueToPrice = this.getSetting('_low_price_enabled') as boolean;
        if (wasOnDueToPrice) {
          this.log('[LOW_PRICE] Current time is NOT in cheapest period, turning OFF self onoff');
          await this.turnOffChargingSelf();
        }
      }

      // Update status
      await this.updatePriceStatus(cheapest, timezone);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.error('[LOW_PRICE] Error in price update:', errorMessage);
    }
  }

  /**
   * Handle locked capability change (if device supports locking/unlocking)
   */
  async onCapabilityLocked(value: boolean): Promise<void> {
    this.log(`Locked capability changed to: ${value}`);
    // Note: The API might support lock/unlock commands, but that's not in the provided code
    // For now, this is read-only, but we keep the listener for future implementation
  }

  /**
   * Handle onoff capability change (manual user control)
   * This allows manual control - automatic control happens via checkChargingControl
   */
  async onCapabilityOnOff(value: boolean): Promise<void> {
    this.log(`[ONOFF] Manual control: ${value}`);
    // Clear automatic control flags when user manually controls
    if (!value) {
      this.lowBatteryDeviceEnabled = false;
      this.lowPriceDeviceEnabled = false;
      await this.setSettings({ 
        _low_battery_enabled: false,
        _low_price_enabled: false,
      }).catch(this.error);
      this.log('[ONOFF] Cleared automatic control flags due to manual off');
    }
    // The capability value is already set by Homey, we just log and clear flags
  }

  /**
   * Check battery level and control charging (self on/off) if configured
   * Low battery takes priority over low price charging
   */
  async checkChargingControl(batteryLevel: number): Promise<void> {
    const threshold = this.getSetting('low_battery_threshold') as number;

    // Check low battery first (takes priority)
    if (threshold && batteryLevel < threshold) {
      await this.checkLowBatteryControl(batteryLevel);
      return; // Low battery takes priority, skip price check
    }

    // If low battery was previously on, turn off when recovered
    if (this.lowBatteryDeviceEnabled) {
      await this.turnOffChargingSelf();
    }

    // Check low price charging if enabled
    const enableLowPrice = this.getSetting('enable_low_price_charging') as boolean;
    if (enableLowPrice) {
      await this.checkLowPriceCharging();
    } else {
      // If low price is disabled, ensure off if it was on due to low price
      if (this.lowPriceDeviceEnabled) {
        await this.turnOffChargingSelf();
      }
    }
  }

  /**
   * Check battery level and control charging device if configured
   */
  async checkLowBatteryControl(batteryLevel: number): Promise<void> {
    try {
      const threshold = this.getSetting('low_battery_threshold') as number;

      // Skip if not configured
      if (!threshold) {
        return;
      }

      this.log(`[LOW_BATTERY] Checking battery: ${batteryLevel}% (threshold: ${threshold}%)`);

      // Check if battery is below threshold
      if (batteryLevel < threshold) {
        // Turn device ON if not already enabled due to low battery
        if (!this.lowBatteryDeviceEnabled) {
          this.log(`[LOW_BATTERY] Battery below threshold (${batteryLevel}% < ${threshold}%), turning ON self onoff`);
          await this.turnOnChargingSelf(true);
        } else {
          this.log(`[LOW_BATTERY] Device already enabled due to low battery`);
        }
      } else {
        // Battery is above threshold
        if (this.lowBatteryDeviceEnabled) {
          // Turn off if it was enabled due to low battery
          this.log(`[LOW_BATTERY] Battery above threshold (${batteryLevel}% >= ${threshold}%), turning OFF self onoff`);
          await this.turnOffChargingSelf();
        }
      }
    } catch (error) {
      this.error('[LOW_BATTERY] Error in low battery control:', error);
    }
  }

  /**
   * Check low price charging and control device accordingly
   * This uses cached prices (doesn't fetch from API - that's done by the 15-minute interval)
   */
  async checkLowPriceCharging(): Promise<void> {
    try {
      const hoursCount = (this.getSetting('low_price_hours_count') as number) || 2;
      // Auto-detect timezone if not configured, fallback to Homey's timezone
      const timezone = (this.getSetting('price_timezone') as string) || this.getTimezone();

      this.log(`[LOW_PRICE] Checking low price charging (cheapest ${hoursCount} hours)`);

      // Load cache from store (don't fetch - use cached data)
      const cache = await this.loadPriceCache();

      // Find cheapest hours from cache
      const cheapest = this.findCheapestHours(cache, hoursCount);

      // Check if current time is in cheap period
      const now = Date.now();
      const isCheapNow = cheapest.some((b: PriceBlock) => now >= b.start && now < b.end);

      // Control device
      if (isCheapNow) {
        this.log(`[LOW_PRICE] Current time is in cheapest period, turning ON self onoff`);
        await this.turnOnChargingSelf(false); // false = not due to low battery
      } else {
        // Check if device was on due to low price, turn off if needed
        const wasOnDueToPrice = this.getSetting('_low_price_enabled') as boolean;
        if (wasOnDueToPrice) {
          this.log(`[LOW_PRICE] Current time is NOT in cheapest period, turning OFF self onoff`);
          await this.turnOffChargingSelf();
        }
      }

      // Update status with next cheap times
      await this.updatePriceStatus(cheapest, timezone);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.error('[LOW_PRICE] Error in low price charging:', errorMessage);
    }
  }

  /**
   * Load price cache from device store
   */
  async loadPriceCache(): Promise<PriceCache> {
    try {
      const cached = await this.getStoreValue('price_cache');
      if (cached) {
        return cached as PriceCache;
      }
      return {};
    } catch (error) {
      this.log('[LOW_PRICE] Could not load price cache from store, starting fresh');
      return {};
    }
  }

  /**
   * Fetch prices from aWATTar API and update cache
   */
  async fetchAndUpdatePrices(cache: PriceCache): Promise<PriceCache> {
    try {
      const response = await fetch('https://api.awattar.de/v1/marketdata');
      if (!response.ok) {
        throw new Error(`aWATTar API failed: ${response.status}`);
      }

      const json = await response.json() as { data: Array<{ start_timestamp: number; end_timestamp: number; marketprice: number }> };

      // Update cache with new prices
      for (const p of json.data) {
        cache[p.start_timestamp] = {
          start: p.start_timestamp,
          end: p.end_timestamp,
          price: p.marketprice / 1000, // Convert to €/kWh
        };
      }

      // Save cache to device store
      await this.savePriceCache(cache);

      this.log(`[LOW_PRICE] Updated price cache with ${json.data.length} price blocks`);
      return cache;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.error(`[LOW_PRICE] Failed to fetch prices:`, errorMessage);
      return cache; // Return existing cache on error
    }
  }

  /**
   * Save price cache to device store
   */
  async savePriceCache(cache: PriceCache): Promise<void> {
    try {
      await this.setStoreValue('price_cache', cache);
    } catch (error) {
      this.error('[LOW_PRICE] Failed to save cache:', error);
    }
  }

  /**
   * Find cheapest hours from cache
   */
  findCheapestHours(cache: PriceCache, count: number): Array<PriceBlock> {
    const now = Date.now();
    const todayUTC = new Date().getUTCDate();
    const tomorrowUTC = new Date(now + 86400000).getUTCDate();

    // Filter relevant blocks (today and tomorrow)
    const relevantBlocks = Object.values(cache).filter((b: PriceBlock) => {
      const d = new Date(b.start).getUTCDate();
      return d === todayUTC || d === tomorrowUTC;
    }) as Array<{ start: number; end: number; price: number }>;

    // Sort by price and take cheapest N hours
    const cheapest = [...relevantBlocks]
      .sort((a, b) => a.price - b.price)
      .slice(0, count);

    return cheapest;
  }

  /**
   * Get locale from Homey i18n or fallback to system default
   */
  private getLocale(): string {
    try {
      const language = this.homey.i18n.getLanguage();
      // Convert Homey language code (e.g., 'en', 'de') to locale format (e.g., 'en-US', 'de-DE')
      if (language && language.length >= 2) {
        // If language is already in locale format (e.g., 'de-DE'), use it
        if (language.includes('-')) {
          return language;
        }
        // Otherwise, try to construct locale (default to same country code)
        const countryCode = language.toUpperCase();
        return `${language}-${countryCode}`;
      }
    } catch (error) {
      this.log('[LOCALE] Could not get locale from Homey i18n, using system default');
    }
    // Fallback to system locale
    return Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';
  }

  /**
   * Get timezone from Homey clock or fallback to system default
   */
  private getTimezone(): string {
    try {
      return this.homey.clock.getTimezone();
    } catch (error) {
      this.log('[TIMEZONE] Could not get timezone from Homey clock, using system default');
      // Fallback to system timezone
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    }
  }

  /**
   * Update status variable with next cheap charging times
   */
  async updatePriceStatus(cheapest: Array<PriceBlock>, timezone: string): Promise<void> {
    try {
      const now = Date.now();
      const future = cheapest
        .filter((b) => b.start > now)
        .sort((a, b) => a.start - b.start);

      // Auto-detect locale and timezone
      const locale = this.getLocale();
      const detectedTimezone = timezone || this.getTimezone();

      let listString = 'Unknown';

      if (future.length > 0) {
        listString = future
          .map((b) => {
            const start = new Date(b.start).toLocaleString(locale, {
              timeZone: detectedTimezone,
              hour: '2-digit',
              minute: '2-digit',
            });
            return start;
          })
          .join(', ');
      } else if (cheapest.length > 0) {
        const nextBlock = cheapest[cheapest.length - 1];
        if (nextBlock.start > Date.now()) {
          const start = new Date(nextBlock.start).toLocaleString(locale, {
            timeZone: detectedTimezone,
            hour: '2-digit',
            minute: '2-digit',
          });
          const end = new Date(nextBlock.end).toLocaleString(locale, {
            timeZone: detectedTimezone,
            hour: '2-digit',
            minute: '2-digit',
          });
          listString = `${start}–${end}`;
        }
      }

      // Store in device settings (visible as attribute)
      await this.setSettings({ 
        next_charging_times: listString,
      }).catch(this.error);
      this.log(`[LOW_PRICE] Next charging times: ${listString}`);
    } catch (error) {
      this.error(`[LOW_PRICE] Failed to update status:`, error);
    }
  }

  /**
   * Turn on charging device
   */
  async turnOnChargingSelf(dueToLowBattery: boolean): Promise<void> {
    try {
      await this.setCapabilityValue('onoff', true);
      
      if (dueToLowBattery) {
        this.lowBatteryDeviceEnabled = true;
        await this.setSettings({ _low_battery_enabled: true }).catch(this.error);
        this.log('[LOW_BATTERY] Self onoff turned ON (low battery)');
      } else {
        this.lowPriceDeviceEnabled = true;
        await this.setSettings({ _low_price_enabled: true }).catch(this.error);
        this.log('[LOW_PRICE] Self onoff turned ON (low price)');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.error('Failed to turn on self onoff:', errorMessage);
    }
  }

  /**
   * Turn off charging device
   */
  async turnOffChargingSelf(): Promise<void> {
    try {
      await this.setCapabilityValue('onoff', false);
      
      // Clear both flags
      this.lowBatteryDeviceEnabled = false;
      this.lowPriceDeviceEnabled = false;
      await this.setSettings({ 
        _low_battery_enabled: false,
        _low_price_enabled: false,
      }).catch(this.error);
      
      this.log('Self onoff turned OFF');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.error('Failed to turn off self onoff:', errorMessage);
    }
  }

  /**
   * Restore low battery device state from settings on init
   */
  async restoreLowBatteryState(): Promise<void> {
    try {
      const enabled = this.getSetting('_low_battery_enabled') as boolean;
      if (enabled === true) {
        this.lowBatteryDeviceEnabled = true;
        this.log('[LOW_BATTERY] Restored state: device was enabled due to low battery');
      }
    } catch (error) {
      // Ignore errors, state will be reset on next check
    }
  }

  /**
   * Update device image from stored URL (from vehicle info)
   */
  async updateDeviceImageFromUrl(imageUrl: string): Promise<void> {
    if (!imageUrl || typeof imageUrl !== 'string' || imageUrl.length === 0) {
      this.log('[IMAGE] Invalid image URL provided');
      return;
    }

    this.log(`[IMAGE] Image URL: ${imageUrl}`);
    this.log(`[IMAGE] Updating device image`);
    
    try {
      // Create an Image instance using Homey SDK 3 Image API
      const myImage = await this.homey.images.createImage();
      
      // Set the image URL
      myImage.setUrl(imageUrl);
      
      // Update the image
      await myImage.update();
      
      // Assign the image to the device as background
      await this.setAlbumArtImage(myImage);
      
      this.log(`[IMAGE] Device background image set successfully with URL: ${imageUrl}`);
    } catch (imageError) {
      const errorMessage = imageError instanceof Error ? imageError.message : String(imageError);
      this.error(`[IMAGE] Failed to set device image with URL ${imageUrl}:`, errorMessage);
    }
  }

  /**
   * Update device image from stored URL (called during status updates)
   * Uses the image URL stored from vehicle info endpoint
   */
  async updateDeviceImage(status: VehicleStatus): Promise<void> {
    try {
      // Try to get image URL from stored settings (from vehicle info endpoint)
      const storedImageUrl = this.getSetting('_vehicle_image_url') as string | undefined;
      
      if (storedImageUrl && typeof storedImageUrl === 'string' && storedImageUrl.length > 0) {
        // Use stored image URL from vehicle info
        await this.updateDeviceImageFromUrl(storedImageUrl);
      } else {
        // Fallback: try to get from status (though this is usually broken)
        const imageUrl = status.status.renders?.lightMode?.oneX;
        if (imageUrl && typeof imageUrl === 'string' && imageUrl.length > 0) {
          this.log(`[IMAGE] Using fallback image URL from status: ${imageUrl}`);
          await this.updateDeviceImageFromUrl(imageUrl);
        } else {
          this.log('[IMAGE] No image URL available (neither from stored info nor status)');
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.error('[IMAGE] Failed to update device image:', errorMessage);
      // Don't throw - image update failure shouldn't break status updates
    }
  }

}

module.exports = SkodaVehicleDevice;

