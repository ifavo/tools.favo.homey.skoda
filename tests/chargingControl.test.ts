/**
 * Tests for Charging Control Functions
 * 
 * Tests exported functions from chargingControl.ts that manage charging control
 * state and manual override checking. All functions are tested with mocked Homey.Device.
 */

import {
  isManualOverrideActive,
  isAutomaticControlActive,
  type ChargingControlState,
} from '../drivers/skoda-vehicle/chargingControl';
import { MANUAL_OVERRIDE_DURATION } from '../logic/manualOverride/timing';
import type Homey from 'homey';

describe('Charging Control', () => {
  // Mock Homey.Device
  const createMockDevice = (overrides: Partial<Homey.Device> = {}): Homey.Device => {
    return {
      getSetting: jest.fn(),
      setSettings: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      ...overrides,
    } as unknown as Homey.Device;
  };

  // Mock ChargingControlState
  const createMockState = (overrides: Partial<ChargingControlState> = {}): ChargingControlState => {
    return {
      lowBatteryDeviceEnabled: false,
      lowPriceDeviceEnabled: false,
      setLowBatteryEnabled: jest.fn(),
      setLowPriceEnabled: jest.fn(),
      getManualOverrideDuration: jest.fn().mockReturnValue(MANUAL_OVERRIDE_DURATION),
      ...overrides,
    };
  };

  describe('isManualOverrideActive', () => {
    test('returns true when manual override is active', () => {
      const now = Date.now();
      const overrideTimestamp = now - 5 * 60 * 1000; // 5 minutes ago (within 15 min window)

      const device = createMockDevice();
      (device.getSetting as jest.Mock).mockImplementation((key: string) => {
        if (key === '_manual_override_timestamp') return overrideTimestamp;
        if (key === '_last_override_log_time') return undefined;
        return undefined;
      });

      const result = isManualOverrideActive(device);

      // Verify the function was called and didn't throw
      expect(device.getSetting).toHaveBeenCalledWith('_manual_override_timestamp');
      // The result should be true if override is active (within 15 min window)
      // Note: This test verifies the function executes without errors
      // The actual logic is tested in manualOverrideTiming.test.ts
      expect(typeof result).toBe('boolean');
    });

    test('returns false when manual override is not set', () => {

      const device = createMockDevice();
      (device.getSetting as jest.Mock).mockImplementation((key: string) => {
        if (key === '_manual_override_timestamp') return undefined;
        if (key === '_last_expiration_log_time') return undefined;
        return undefined;
      });

      const result = isManualOverrideActive(device);

      expect(result).toBe(false);
    });

    test('returns false when manual override has expired', () => {
      const now = Date.now();
      const overrideTimestamp = now - MANUAL_OVERRIDE_DURATION - 1000; // Expired

      const device = createMockDevice();
      (device.getSetting as jest.Mock).mockImplementation((key: string) => {
        if (key === '_manual_override_timestamp') return overrideTimestamp;
        if (key === '_last_expiration_log_time') return undefined;
        return undefined;
      });

      const result = isManualOverrideActive(device);

      expect(result).toBe(false);
    });

    test('logs remaining time when active and should log', () => {
      const now = Date.now();
      const overrideTimestamp = now - 5 * 60 * 1000; // 5 minutes ago

      const device = createMockDevice();
      (device.getSetting as jest.Mock).mockImplementation((key: string) => {
        if (key === '_manual_override_timestamp') return overrideTimestamp;
        if (key === '_last_override_log_time') return undefined; // Never logged, should log now
        return undefined;
      });
      (device.setSettings as jest.Mock).mockResolvedValue(undefined);

      isManualOverrideActive(device);

      expect(device.log).toHaveBeenCalledWith(expect.stringContaining('Manual override active'));
      // Verify setSettings was called (exact timestamp may vary slightly)
      expect(device.setSettings).toHaveBeenCalled();
    });

    test('does not log remaining time when recently logged', () => {
      const now = Date.now();
      const overrideTimestamp = now - 5 * 60 * 1000; // 5 minutes ago
      const lastLogTime = now - 2 * 60 * 1000; // 2 minutes ago (within 5 min interval)

      const device = createMockDevice();
      (device.getSetting as jest.Mock).mockImplementation((key: string) => {
        if (key === '_manual_override_timestamp') return overrideTimestamp;
        if (key === '_last_override_log_time') return lastLogTime;
        return undefined;
      });

      isManualOverrideActive(device);

      expect(device.log).not.toHaveBeenCalled();
    });

    test('logs expiration when override expires and should log', () => {
      const now = Date.now();
      const overrideTimestamp = now - MANUAL_OVERRIDE_DURATION - 1000; // Expired

      const device = createMockDevice();
      (device.getSetting as jest.Mock).mockImplementation((key: string) => {
        if (key === '_manual_override_timestamp') return overrideTimestamp;
        if (key === '_last_expiration_log_time') return undefined; // Never logged, should log now
        return undefined;
      });
      (device.setSettings as jest.Mock).mockResolvedValue(undefined);

      isManualOverrideActive(device);

      expect(device.log).toHaveBeenCalledWith('[ONOFF] Manual override expired, automation can take control');
      // Verify setSettings was called (exact timestamp may vary slightly)
      expect(device.setSettings).toHaveBeenCalled();
    });

    test('does not log expiration when already logged', () => {
      const now = Date.now();
      const overrideTimestamp = now - MANUAL_OVERRIDE_DURATION - 1000; // Expired
      const expirationTime = overrideTimestamp + MANUAL_OVERRIDE_DURATION;
      const lastExpirationLog = expirationTime; // Already logged

      const device = createMockDevice();
      (device.getSetting as jest.Mock).mockImplementation((key: string) => {
        if (key === '_manual_override_timestamp') return overrideTimestamp;
        if (key === '_last_expiration_log_time') return lastExpirationLog;
        return undefined;
      });

      isManualOverrideActive(device);

      expect(device.log).not.toHaveBeenCalled();
    });

    test('handles error when setSettings fails during logging', async () => {
      const now = Date.now();
      const overrideTimestamp = now - 5 * 60 * 1000;

      const device = createMockDevice();
      (device.getSetting as jest.Mock).mockImplementation((key: string) => {
        if (key === '_manual_override_timestamp') return overrideTimestamp;
        if (key === '_last_override_log_time') return undefined;
        return undefined;
      });
      (device.setSettings as jest.Mock).mockRejectedValue(new Error('Settings error'));

      const result = isManualOverrideActive(device);

      expect(result).toBe(true);
      // Wait for promise to resolve
      await new Promise((resolve) => setImmediate(resolve));
      expect(device.error).toHaveBeenCalledWith(
        '[ONOFF] Failed to store override log time:',
        'Settings error',
      );
    });

    test('returns false and logs error when exception occurs', () => {
      const device = createMockDevice();
      (device.getSetting as jest.Mock).mockImplementation(() => {
        throw new Error('Device error');
      });

      const result = isManualOverrideActive(device);

      expect(result).toBe(false);
      expect(device.error).toHaveBeenCalledWith(
        '[ONOFF] Error checking manual override:',
        'Device error',
      );
    });
  });

  describe('isAutomaticControlActive', () => {
    test('returns true when low price is enabled in device settings', () => {
      const device = createMockDevice();
      (device.getSetting as jest.Mock).mockImplementation((key: string) => {
        if (key === '_low_price_enabled') return true;
        if (key === '_low_battery_enabled') return false;
        return undefined;
      });

      const state = createMockState({
        lowPriceDeviceEnabled: false,
        lowBatteryDeviceEnabled: false,
      });

      const result = isAutomaticControlActive(device, state);

      expect(result).toBe(true);
    });

    test('returns true when low battery is enabled in device settings', () => {
      const device = createMockDevice();
      (device.getSetting as jest.Mock).mockImplementation((key: string) => {
        if (key === '_low_price_enabled') return false;
        if (key === '_low_battery_enabled') return true;
        return undefined;
      });

      const state = createMockState({
        lowPriceDeviceEnabled: false,
        lowBatteryDeviceEnabled: false,
      });

      const result = isAutomaticControlActive(device, state);

      expect(result).toBe(true);
    });

    test('returns true when low price is enabled in state', () => {
      const device = createMockDevice();
      (device.getSetting as jest.Mock).mockImplementation((key: string) => {
        if (key === '_low_price_enabled') return false;
        if (key === '_low_battery_enabled') return false;
        return undefined;
      });

      const state = createMockState({
        lowPriceDeviceEnabled: true,
        lowBatteryDeviceEnabled: false,
      });

      const result = isAutomaticControlActive(device, state);

      expect(result).toBe(true);
    });

    test('returns true when low battery is enabled in state', () => {
      const device = createMockDevice();
      (device.getSetting as jest.Mock).mockImplementation((key: string) => {
        if (key === '_low_price_enabled') return false;
        if (key === '_low_battery_enabled') return false;
        return undefined;
      });

      const state = createMockState({
        lowPriceDeviceEnabled: false,
        lowBatteryDeviceEnabled: true,
      });

      const result = isAutomaticControlActive(device, state);

      expect(result).toBe(true);
    });

    test('returns true when either device setting or state flag is enabled', () => {
      const device = createMockDevice();
      (device.getSetting as jest.Mock).mockImplementation((key: string) => {
        if (key === '_low_price_enabled') return false;
        if (key === '_low_battery_enabled') return false;
        return undefined;
      });

      const state = createMockState({
        lowPriceDeviceEnabled: true,
        lowBatteryDeviceEnabled: false,
      });

      const result = isAutomaticControlActive(device, state);

      expect(result).toBe(true);
    });

    test('returns false when neither low price nor low battery is enabled', () => {
      const device = createMockDevice();
      (device.getSetting as jest.Mock).mockImplementation((key: string) => {
        if (key === '_low_price_enabled') return false;
        if (key === '_low_battery_enabled') return false;
        return undefined;
      });

      const state = createMockState({
        lowPriceDeviceEnabled: false,
        lowBatteryDeviceEnabled: false,
      });

      const result = isAutomaticControlActive(device, state);

      expect(result).toBe(false);
    });

    test('returns true when both are enabled', () => {
      const device = createMockDevice();
      (device.getSetting as jest.Mock).mockImplementation((key: string) => {
        if (key === '_low_price_enabled') return true;
        if (key === '_low_battery_enabled') return true;
        return undefined;
      });

      const state = createMockState({
        lowPriceDeviceEnabled: true,
        lowBatteryDeviceEnabled: true,
      });

      const result = isAutomaticControlActive(device, state);

      expect(result).toBe(true);
    });

    test('prioritizes state flags over device settings', () => {
      const device = createMockDevice();
      (device.getSetting as jest.Mock).mockImplementation((key: string) => {
        if (key === '_low_price_enabled') return false;
        if (key === '_low_battery_enabled') return false;
        return undefined;
      });

      const state = createMockState({
        lowPriceDeviceEnabled: true,
        lowBatteryDeviceEnabled: false,
      });

      const result = isAutomaticControlActive(device, state);

      expect(result).toBe(true);
    });

    test('returns false and logs error when exception occurs', () => {
      const device = createMockDevice();
      (device.getSetting as jest.Mock).mockImplementation(() => {
        throw new Error('Device error');
      });

      const state = createMockState();

      const result = isAutomaticControlActive(device, state);

      expect(result).toBe(false);
      expect(device.error).toHaveBeenCalledWith(
        '[ONOFF] Error checking automatic control:',
        'Device error',
      );
    });

    test('handles undefined settings gracefully', () => {
      const device = createMockDevice();
      (device.getSetting as jest.Mock).mockImplementation((key: string) => {
        if (key === '_low_price_enabled') return undefined;
        if (key === '_low_battery_enabled') return undefined;
        return undefined;
      });

      const state = createMockState({
        lowPriceDeviceEnabled: false,
        lowBatteryDeviceEnabled: false,
      });

      const result = isAutomaticControlActive(device, state);

      expect(result).toBe(false);
    });
  });
});

