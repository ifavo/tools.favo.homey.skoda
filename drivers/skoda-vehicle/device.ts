'use strict';

import Homey from 'homey';
import type { PriceBlock } from '../../logic/lowPrice/types';
import { TibberPriceSource } from '../../logic/lowPrice/sources/tibber';
import { SmardPriceSource } from '../../logic/lowPrice/sources/smard';
import type { PriceDataSource } from '../../logic/lowPrice/priceSource';
import { decideLowPriceCharging } from '../../logic/lowPrice/decideLowPriceCharging';
import { MANUAL_OVERRIDE_DURATION as OVERRIDE_DURATION } from '../../logic/manualOverride/timing';
import { extractErrorMessage } from '../../logic/utils/errorUtils';
import { MILLISECONDS_PER_MINUTE, MILLISECONDS_PER_HOUR, MILLISECONDS_PER_DAY, getMillisecondsUntilNext15MinuteBoundary } from '../../logic/utils/dateUtils';
import { resolveVin, getSettingWithDefault, getTimezone } from './deviceHelpers';
import {
  loadPriceCache,
  fetchAndUpdatePrices,
  findCheapestBlocksWithLogging,
  updatePriceStatus,
} from './priceManager';
import {
  type ChargingControlState,
  isManualOverrideActive,
  turnOnChargingSelf,
  turnOffChargingSelf,
  restoreLowBatteryState,
  checkChargingControl,
  checkLowBatteryControl,
  checkLowPriceCharging,
} from './chargingControl';
import { refreshStatus as refreshVehicleStatus } from './statusManager';
import { refreshVehicleInfo } from './vehicleInfo';
import { ChargingControlStateImpl } from './chargingControlState';

class SkodaVehicleDevice extends Homey.Device {

  private pollingInterval?: NodeJS.Timeout;
  private priceUpdateInterval?: NodeJS.Timeout;
  private priceUpdateBoundaryTimeout?: ReturnType<typeof this.homey.setTimeout>;
  private infoUpdateInterval?: NodeJS.Timeout;
  private readonly POLL_INTERVAL = 60 * MILLISECONDS_PER_MINUTE; // 60 seconds
  private readonly PRICE_UPDATE_INTERVAL = 15 * MILLISECONDS_PER_MINUTE; // 15 minutes
  private readonly INFO_UPDATE_INTERVAL = MILLISECONDS_PER_DAY; // 24 hours (once per day)
  private readonly MANUAL_OVERRIDE_DURATION = OVERRIDE_DURATION; // 15 minutes in milliseconds
  private priceSource!: PriceDataSource; // Initialized in onInit
  private chargingState!: ChargingControlStateImpl; // Initialized in onInit

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    // Set up global error handlers to prevent crashes
    process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
      this.error('[UNHANDLED] Unhandled promise rejection:', extractErrorMessage(reason));
      // Don't crash - log and continue
    });

    process.on('uncaughtException', (error: Error) => {
      this.error('[UNHANDLED] Uncaught exception:', extractErrorMessage(error));
      // Don't crash - log and continue
    });

    try {
      this.log('SkodaVehicleDevice has been initialized');

      // Initialize charging control state
      this.chargingState = new ChargingControlStateImpl(this, this.MANUAL_OVERRIDE_DURATION);

      // Ensure VIN is stored from data, store, or settings
      try {
        const vin = resolveVin(this);
        if (vin) {
          await this.setStoreValue('vin', vin);
          await this.setSettings({ vin: vin as string });
          this.log(`Device initialized with VIN: ${vin}`);
        } else {
          this.log('VIN not found, will be auto-detected on first status refresh');
        }
      } catch (error: unknown) {
        this.error('[INIT] Failed to initialize VIN:', extractErrorMessage(error));
        // Continue initialization even if VIN setup fails
      }

      // Initialize price data source
      // Use Tibber if token is configured, otherwise use SMARD
      const tibberTokenSetting = this.homey.settings.get('tibber_token') as string | undefined;
      const tibberToken = tibberTokenSetting && tibberTokenSetting.trim() !== '' ? tibberTokenSetting : undefined;

      if (tibberToken) {
        this.priceSource = new TibberPriceSource(tibberToken, 'de');
        this.log('[LOW_PRICE] Using Tibber API as price data source');
      } else {
        this.priceSource = new SmardPriceSource('DE-LU');
        this.log('[LOW_PRICE] Using SMARD API as price data source (no Tibber token configured)');
      }

      // Restore low battery device state
      try {
        await restoreLowBatteryState(this, this.chargingState);
      } catch (error: unknown) {
        this.error('[INIT] Failed to restore low battery state:', extractErrorMessage(error));
        // Continue initialization
      }

      // Start polling for status updates
      try {
        await this.startPolling();
      } catch (error: unknown) {
        this.error('[INIT] Failed to start polling:', extractErrorMessage(error));
        // Try to restart polling after a delay
        setTimeout(() => {
          this.startPolling().catch((retryError: unknown) => {
            this.error('[INIT] Failed to restart polling:', extractErrorMessage(retryError));
          });
        }, 5000);
      }

      // Always start price updates to show next charging times (even if feature is disabled)
      try {
        // Don't set "Fetching prices..." here - let startPriceUpdates handle it
        // This avoids setting it before the capability is properly registered
        await this.startPriceUpdates();
      } catch (error: unknown) {
        this.error('[INIT] Failed to start price updates:', extractErrorMessage(error));
        // Set error message if initialization fails
        try {
          await this.setCapabilityValue('next_charging_times', 'Failed to start price updates');
        } catch (capError: unknown) {
          // Capability might not be registered yet, that's okay
        }
        // Continue initialization
      }

      // Start vehicle info update interval (once per day)
      try {
        await this.startInfoUpdates();
      } catch (error: unknown) {
        this.error('[INIT] Failed to start info updates:', extractErrorMessage(error));
        // Continue initialization
      }

      // Register capability listeners if needed
      try {
        this.registerCapabilityListener('locked', this.onCapabilityLocked.bind(this));
        this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));
      } catch (error: unknown) {
        this.error('[INIT] Failed to register capability listeners:', extractErrorMessage(error));
        // Continue initialization
      }

      this.log('[INIT] Device initialization completed');
    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      this.error('[INIT] Critical error during initialization:', errorMessage);
      // Set device as unavailable but don't throw - allow recovery
      this.setUnavailable(`Initialization error: ${errorMessage.substring(0, 50)}`).catch((setError: unknown) => {
        this.error('[INIT] Failed to set unavailable status:', extractErrorMessage(setError));
      });
    }
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
   * Fetch and update vehicle status with improved error handling and 401 recovery
   */
  async refreshStatus(): Promise<void> {
    await refreshVehicleStatus(this, this.chargingState);
  }

  /**
   * Start polling for status updates with error recovery
   */
  async startPolling(): Promise<void> {
    this.stopPolling();

    // Initial status refresh with error handling
    try {
      await this.refreshStatus();
      await this.setAvailable();
    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      this.error('[POLLING] Initial status refresh failed:', errorMessage);
      // Don't throw - continue to set up interval
    }

    // Set up interval with comprehensive error handling
    this.pollingInterval = this.homey.setInterval(() => {
      this.refreshStatus().catch((error: unknown) => {
        const errorMessage = extractErrorMessage(error);
        this.error('[POLLING] Status refresh failed:', errorMessage);
        // Don't crash - interval will retry on next cycle
        // Set device as unavailable if error persists
        this.setUnavailable(`Status update error: ${errorMessage.substring(0, 50)}`).catch((setError: unknown) => {
          this.error('[POLLING] Failed to set unavailable status:', extractErrorMessage(setError));
        });
      });
    }, this.POLL_INTERVAL);

    this.log('[POLLING] Started polling interval');
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
   * Start price update interval (runs every 15 minutes) with error recovery
   * Always runs to update next charging times display, even if low price charging is disabled
   * Aligns to 15-minute block boundaries (:00, :15, :30, :45) to match price data intervals
   */
  async startPriceUpdates(): Promise<void> {
    this.stopPriceUpdates();

    // Calculate delay until next 15-minute boundary
    const now = Date.now();
    const delayUntilBoundary = getMillisecondsUntilNext15MinuteBoundary(now);
    
    // Initial price update with error handling (run immediately to populate cache)
    try {
      await this.updatePricesAndCheckCharging();
    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      this.error('[LOW_PRICE] Initial price update failed:', errorMessage);
      // Set capability value to show error message
      try {
        await this.setCapabilityValue('next_charging_times', 'Failed to fetch prices - will retry');
      } catch (capError: unknown) {
        // Capability might not be registered yet, that's okay
        this.log('[LOW_PRICE] Could not set next_charging_times capability on error');
      }
      // Don't throw - continue to set up interval
    }

    // Schedule first update at the next 15-minute boundary
    this.priceUpdateBoundaryTimeout = this.homey.setTimeout(() => {
      // Clear the timeout reference since it's now executed
      this.priceUpdateBoundaryTimeout = undefined;
      
      // Run update at boundary
      this.updatePricesAndCheckCharging().catch((error: unknown) => {
        const errorMessage = extractErrorMessage(error);
        this.error('[LOW_PRICE] Price update failed:', errorMessage);
      });
      
      // Then set up regular interval aligned to boundaries
      this.priceUpdateInterval = this.homey.setInterval(() => {
        this.updatePricesAndCheckCharging().catch((error: unknown) => {
          const errorMessage = extractErrorMessage(error);
          this.error('[LOW_PRICE] Price update failed:', errorMessage);
          // Don't crash - interval will retry on next cycle
        });
      }, this.PRICE_UPDATE_INTERVAL);
    }, delayUntilBoundary);

    const nextBoundaryDate = new Date(now + delayUntilBoundary);
    const nextBoundaryTime = nextBoundaryDate.toLocaleTimeString();
    this.log(`[LOW_PRICE] Started price update interval (every ${this.PRICE_UPDATE_INTERVAL / MILLISECONDS_PER_MINUTE} minutes), first update at ${nextBoundaryTime} (aligned to 15-minute boundaries)`);
  }

  /**
   * Stop price update interval
   */
  stopPriceUpdates(): void {
    if (this.priceUpdateInterval) {
      this.homey.clearInterval(this.priceUpdateInterval);
      this.priceUpdateInterval = undefined;
    }
    if (this.priceUpdateBoundaryTimeout !== undefined) {
      this.homey.clearTimeout(this.priceUpdateBoundaryTimeout);
      this.priceUpdateBoundaryTimeout = undefined;
    }
    if (this.priceUpdateInterval || this.priceUpdateBoundaryTimeout !== undefined) {
      this.log('[LOW_PRICE] Stopped price update interval');
    }
  }

  /**
   * Start vehicle info update interval (runs once per day) with error recovery
   */
  async startInfoUpdates(): Promise<void> {
    this.stopInfoUpdates();

    // Check if we need to fetch info immediately (if never fetched or last fetch was more than 24h ago)
    try {
      const lastInfoFetch = this.getSetting('_last_info_fetch') as number | undefined;
      const now = Date.now();
      const shouldFetchNow = !lastInfoFetch || (now - lastInfoFetch) >= this.INFO_UPDATE_INTERVAL;

      if (shouldFetchNow) {
        this.log('[INFO] Fetching vehicle info immediately (never fetched or cache expired)');
        try {
          await this.refreshVehicleInfo();
        } catch (error: unknown) {
          const errorMessage = extractErrorMessage(error);
          this.error('[INFO] Initial vehicle info fetch failed:', errorMessage);
          // Don't throw - continue to set up interval
        }
      } else {
        const hoursUntilNext = Math.ceil((this.INFO_UPDATE_INTERVAL - (now - lastInfoFetch)) / MILLISECONDS_PER_HOUR);
        this.log(`[INFO] Vehicle info cache still valid, will refresh in ${hoursUntilNext} hour(s)`);
      }
    } catch (error: unknown) {
      this.error('[INFO] Error checking info cache:', extractErrorMessage(error));
      // Continue to set up interval
    }

    // Set up interval for daily info updates with error handling
    this.infoUpdateInterval = this.homey.setInterval(() => {
      this.refreshVehicleInfo().catch((error: unknown) => {
        const errorMessage = extractErrorMessage(error);
        this.error('[INFO] Vehicle info refresh failed:', errorMessage);
        // Don't crash - interval will retry on next cycle
      });
    }, this.INFO_UPDATE_INTERVAL);

    this.log(`[INFO] Started vehicle info update interval (every ${this.INFO_UPDATE_INTERVAL / MILLISECONDS_PER_HOUR} hours)`);
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
   * Fetch and update vehicle info (specification, renders, license plate, etc.) with error recovery
   */
  async refreshVehicleInfo(): Promise<void> {
    await refreshVehicleInfo(this);
  }

  /**
   * Check battery level and control charging (self on/off) if configured
   * Low battery takes priority over low price charging
   * Respects manual override (15 minutes after manual control)
   */
  async checkChargingControl(batteryLevel: number): Promise<void> {
    await checkChargingControl(this, this.chargingState, batteryLevel);
  }

  /**
   * Check battery level and control charging device if configured
   */
  async checkLowBatteryControl(batteryLevel: number): Promise<void> {
    await checkLowBatteryControl(this, this.chargingState, batteryLevel);
  }

  /**
   * Check low price charging and control device accordingly
   * This uses cached prices (doesn't fetch from API - that's done by the 15-minute interval)
   * Respects manual override (15 minutes after manual control)
   */
  async checkLowPriceCharging(): Promise<void> {
    await checkLowPriceCharging(this, this.chargingState);
  }

  /**
   * Update prices and check if charging should be controlled
   * Always fetches prices to update next charging times display, even if feature is disabled
   */
  async updatePricesAndCheckCharging(): Promise<void> {
    try {
      this.log('[LOW_PRICE] Updating prices from price data source');

      // Auto-detect timezone if not configured, fallback to Homey's timezone
      const timezone = getSettingWithDefault(this, 'price_timezone', getTimezone(this));
      const blocksCount = getSettingWithDefault(this, 'low_price_blocks_count', 8);

      // Log configured number of cheapest blocks for debugging
      this.log(`[LOW_PRICE] Configured number of cheapest blocks: ${blocksCount}`);

      // Always load cache and fetch prices to update display
      const cache = await loadPriceCache(this);
      const updatedCache = await fetchAndUpdatePrices(this, cache, this.priceSource);

      // DEBUG STEP 1: log current hour cache (raw price data) in a JSON-friendly way
      try {
        const cacheArray = Object.values(updatedCache)
          .sort((a: PriceBlock, b: PriceBlock) => a.start - b.start);
        const debugCache = cacheArray.map((b: PriceBlock) => ({
          start: b.start,
          end: b.end,
          price: b.price,
        }));
        this.log(`[LOW_PRICE_DEBUG] price_cache=${JSON.stringify(debugCache)}`);
      } catch (debugError: unknown) {
        const errorMessage = extractErrorMessage(debugError);
        this.error('[LOW_PRICE_DEBUG] Failed to log price cache:', errorMessage);
      }

      // Find cheapest blocks (recomputed each time from cached price data)
      const cheapest = findCheapestBlocksWithLogging(this, updatedCache, blocksCount);

      // Always update status display (even if feature is disabled)
      await updatePriceStatus(this, cheapest, timezone);

      // Only control charging if feature is enabled
      const enableLowPrice = this.getSetting('enable_low_price_charging') as boolean;
      if (!enableLowPrice) {
        this.log('[LOW_PRICE] Low price charging is disabled, but prices updated for display');
        return;
      }

      // Use isolated decision logic
      const now = Date.now();
      const batteryLevel = this.getCapabilityValue('measure_battery') as number | null;
      const threshold = this.getSetting('low_battery_threshold') as number | null;
      const wasOnDueToPrice = this.getSetting('_low_price_enabled') as boolean;

      const decision = decideLowPriceCharging(cheapest, now, {
        enableLowPrice,
        batteryLevel,
        lowBatteryThreshold: threshold,
        manualOverrideActive: isManualOverrideActive(this),
        wasOnDueToPrice,
      });

      // Execute decision
      if (decision === 'turnOn') {
        this.log('[LOW_PRICE] Current time is in cheapest period, turning ON self onoff');
        await turnOnChargingSelf(this, this.chargingState, false);
      } else if (decision === 'turnOff') {
        this.log('[LOW_PRICE] Current time is NOT in cheapest period, turning OFF self onoff');
        await turnOffChargingSelf(this, this.chargingState);
      }
      // noChange - decision logic already handled the reason

    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      this.error('[LOW_PRICE] Error in price update:', errorMessage);
      // Update capability to show error
      try {
        await this.setCapabilityValue('next_charging_times', `Error: ${errorMessage.substring(0, 30)}...`);
      } catch (capError: unknown) {
        // Ignore if capability not available
      }
    }
  }

  /**
   * Handle locked capability change (if device supports locking/unlocking)
   */
  async onCapabilityLocked(value: boolean): Promise<void> {
    try {
      this.log(`[LOCKED] Capability changed to: ${value}`);
      // Note: The API might support lock/unlock commands, but that's not in the provided code
      // For now, this is read-only, but we keep the listener for future implementation
    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      this.error('[LOCKED] Error handling locked capability change:', errorMessage);
      // Don't throw - capability listener errors shouldn't crash the device
    }
  }

  /**
   * Handle onoff capability change (manual user control)
   * This allows manual control - automatic control happens via checkChargingControl
   */
  async onCapabilityOnOff(value: boolean): Promise<void> {
    try {
      this.log(`[ONOFF] Manual control: ${value}`);

      // Store timestamp of manual control
      const now = Date.now();
      try {
        await this.setSettings({
          _manual_override_timestamp: now,
          _last_override_log_time: now, // Reset log time for new override
          _last_expiration_log_time: 0, // Clear expiration log time so we log when it expires
        });
        this.log(`[ONOFF] Manual override set, will remain active for ${this.MANUAL_OVERRIDE_DURATION / MILLISECONDS_PER_MINUTE} minutes`);
      } catch (error: unknown) {
        this.error('[ONOFF] Failed to store manual override timestamp:', extractErrorMessage(error));
        // Continue even if storage fails
      }

      // Clear automatic control flags when user manually controls
      if (!value) {
        try {
          this.chargingState.setLowBatteryEnabled(false);
          this.chargingState.setLowPriceEnabled(false);
          await this.setSettings({
            _low_battery_enabled: false,
            _low_price_enabled: false,
          });
          this.log('[ONOFF] Cleared automatic control flags due to manual off');
        } catch (error: unknown) {
          this.error('[ONOFF] Failed to clear automatic control flags:', extractErrorMessage(error));
          // Continue even if clearing fails
        }
      }
      // The capability value is already set by Homey, we just log and clear flags
    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      this.error('[ONOFF] Error handling onoff capability change:', errorMessage);
      // Don't throw - capability listener errors shouldn't crash the device
    }
  }

}

module.exports = SkodaVehicleDevice;
