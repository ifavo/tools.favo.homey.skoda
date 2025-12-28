/**
 * Tests for Device Helpers
 * 
 * Tests device helper functions that work with Homey.Device instances.
 * All functions are tested with mocked Homey.Device objects.
 */

import {
  resolveVin,
  getSettingWithDefault,
  updateCapabilitySafely,
  getAccessToken,
  getLocale,
  getTimezone,
} from '../drivers/skoda-vehicle/deviceHelpers';
import type Homey from 'homey';

describe('Device Helpers', () => {
  // Mock Homey.Device
  const createMockDevice = (overrides: Partial<Homey.Device> = {}): Homey.Device => {
    return {
      getStoreValue: jest.fn(),
      getData: jest.fn(() => ({})),
      getSetting: jest.fn(),
      setSettings: jest.fn(),
      setCapabilityValue: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      homey: {
        app: {},
        i18n: {
          getLanguage: jest.fn(),
        },
        clock: {
          getTimezone: jest.fn(),
        },
      } as unknown as Homey.Homey,
      ...overrides,
    } as unknown as Homey.Device;
  };

  describe('resolveVin', () => {
    test('returns VIN from store when available', () => {
      const device = createMockDevice();
      (device.getStoreValue as jest.Mock).mockReturnValue('VIN123');
      (device.getData as jest.Mock).mockReturnValue({ vin: 'VIN456' });
      (device.getSetting as jest.Mock).mockReturnValue('VIN789');

      expect(resolveVin(device)).toBe('VIN123');
      expect(device.getStoreValue).toHaveBeenCalledWith('vin');
      expect(device.getData).not.toHaveBeenCalled();
      expect(device.getSetting).not.toHaveBeenCalled();
    });

    test('returns VIN from data when store is not available', () => {
      const device = createMockDevice();
      (device.getStoreValue as jest.Mock).mockReturnValue(undefined);
      (device.getData as jest.Mock).mockReturnValue({ vin: 'VIN456' });
      (device.getSetting as jest.Mock).mockReturnValue('VIN789');

      expect(resolveVin(device)).toBe('VIN456');
      expect(device.getStoreValue).toHaveBeenCalledWith('vin');
      expect(device.getData).toHaveBeenCalled();
      expect(device.getSetting).not.toHaveBeenCalled();
    });

    test('returns VIN from settings when store and data are not available', () => {
      const device = createMockDevice();
      (device.getStoreValue as jest.Mock).mockReturnValue(undefined);
      (device.getData as jest.Mock).mockReturnValue({});
      (device.getSetting as jest.Mock).mockReturnValue('VIN789');

      expect(resolveVin(device)).toBe('VIN789');
      expect(device.getStoreValue).toHaveBeenCalledWith('vin');
      expect(device.getData).toHaveBeenCalled();
      expect(device.getSetting).toHaveBeenCalledWith('vin');
    });

    test('returns undefined when no VIN is available', () => {
      const device = createMockDevice();
      (device.getStoreValue as jest.Mock).mockReturnValue(undefined);
      (device.getData as jest.Mock).mockReturnValue({});
      (device.getSetting as jest.Mock).mockReturnValue(undefined);

      expect(resolveVin(device)).toBeUndefined();
    });

    test('prioritizes store over data and settings', () => {
      const device = createMockDevice();
      (device.getStoreValue as jest.Mock).mockReturnValue('STORE_VIN');
      (device.getData as jest.Mock).mockReturnValue({ vin: 'DATA_VIN' });
      (device.getSetting as jest.Mock).mockReturnValue('SETTING_VIN');

      expect(resolveVin(device)).toBe('STORE_VIN');
    });

    test('handles empty string from store as falsy', () => {
      const device = createMockDevice();
      (device.getStoreValue as jest.Mock).mockReturnValue('');
      (device.getData as jest.Mock).mockReturnValue({ vin: 'DATA_VIN' });

      expect(resolveVin(device)).toBe('DATA_VIN');
    });
  });

  describe('getSettingWithDefault', () => {
    test('returns setting value when available', () => {
      const device = createMockDevice();
      (device.getSetting as jest.Mock).mockReturnValue(42);

      expect(getSettingWithDefault(device, 'test_key', 10)).toBe(42);
      expect(device.getSetting).toHaveBeenCalledWith('test_key');
    });

    test('returns default value when setting is undefined', () => {
      const device = createMockDevice();
      (device.getSetting as jest.Mock).mockReturnValue(undefined);

      expect(getSettingWithDefault(device, 'test_key', 10)).toBe(10);
    });

    test('returns default value when setting is null', () => {
      const device = createMockDevice();
      (device.getSetting as jest.Mock).mockReturnValue(null);

      expect(getSettingWithDefault(device, 'test_key', 10)).toBe(10);
    });

    test('handles zero as valid value', () => {
      const device = createMockDevice();
      (device.getSetting as jest.Mock).mockReturnValue(0);

      expect(getSettingWithDefault(device, 'test_key', 10)).toBe(0);
    });

    test('handles false as valid value', () => {
      const device = createMockDevice();
      (device.getSetting as jest.Mock).mockReturnValue(false);

      expect(getSettingWithDefault(device, 'test_key', true)).toBe(false);
    });

    test('handles empty string as valid value', () => {
      const device = createMockDevice();
      (device.getSetting as jest.Mock).mockReturnValue('');

      expect(getSettingWithDefault(device, 'test_key', 'default')).toBe('');
    });

    test('works with different types', () => {
      const device = createMockDevice();
      (device.getSetting as jest.Mock).mockReturnValue('custom');

      expect(getSettingWithDefault(device, 'test_key', 'default')).toBe('custom');
      expect(getSettingWithDefault(device, 'test_key', 100)).toBe('custom');
    });
  });

  describe('updateCapabilitySafely', () => {
    test('updates capability value successfully', async () => {
      const device = createMockDevice();
      (device.setCapabilityValue as jest.Mock).mockResolvedValue(undefined);

      await updateCapabilitySafely(device, 'onoff', true, 'TEST');

      expect(device.setCapabilityValue).toHaveBeenCalledWith('onoff', true);
      expect(device.error).not.toHaveBeenCalled();
    });

    test('logs error without throwing when capability update fails', async () => {
      const device = createMockDevice();
      const error = new Error('Capability update failed');
      (device.setCapabilityValue as jest.Mock).mockRejectedValue(error);

      await updateCapabilitySafely(device, 'onoff', false, 'TEST');

      expect(device.setCapabilityValue).toHaveBeenCalledWith('onoff', false);
      expect(device.error).toHaveBeenCalledWith('[TEST] Failed to update onoff:', 'Capability update failed');
    });

    test('handles different capability IDs', async () => {
      const device = createMockDevice();
      (device.setCapabilityValue as jest.Mock).mockResolvedValue(undefined);

      await updateCapabilitySafely(device, 'measure_battery', 80, 'BATTERY');
      await updateCapabilitySafely(device, 'measure_temperature', 20.5, 'TEMP');

      expect(device.setCapabilityValue).toHaveBeenCalledWith('measure_battery', 80);
      expect(device.setCapabilityValue).toHaveBeenCalledWith('measure_temperature', 20.5);
    });

    test('handles different value types', async () => {
      const device = createMockDevice();
      (device.setCapabilityValue as jest.Mock).mockResolvedValue(undefined);

      await updateCapabilitySafely(device, 'test', 'string', 'TEST');
      await updateCapabilitySafely(device, 'test', 123, 'TEST');
      await updateCapabilitySafely(device, 'test', true, 'TEST');
      await updateCapabilitySafely(device, 'test', null, 'TEST');

      expect(device.setCapabilityValue).toHaveBeenCalledTimes(4);
    });
  });

  describe('getAccessToken', () => {
    test('returns access token from app', async () => {
      const mockApp = {
        getAccessToken: jest.fn().mockResolvedValue('test-token-123'),
      };
      const device = createMockDevice({
        homey: {
          app: mockApp,
        } as unknown as Homey.Homey,
      });

      const token = await getAccessToken(device);

      expect(token).toBe('test-token-123');
      expect(mockApp.getAccessToken).toHaveBeenCalled();
      expect(device.error).not.toHaveBeenCalled();
    });

    test('throws error when app.getAccessToken fails', async () => {
      const mockApp = {
        getAccessToken: jest.fn().mockRejectedValue(new Error('Token fetch failed')),
      };
      const device = createMockDevice({
        homey: {
          app: mockApp,
        } as unknown as Homey.Homey,
      });

      await expect(getAccessToken(device)).rejects.toThrow('Access token error: Token fetch failed');
      expect(device.error).toHaveBeenCalledWith('[TOKEN] Failed to get access token:', 'Token fetch failed');
    });

    test('handles non-Error exceptions', async () => {
      const mockApp = {
        getAccessToken: jest.fn().mockRejectedValue('String error'),
      };
      const device = createMockDevice({
        homey: {
          app: mockApp,
        } as unknown as Homey.Homey,
      });

      await expect(getAccessToken(device)).rejects.toThrow('Access token error: String error');
      expect(device.error).toHaveBeenCalledWith('[TOKEN] Failed to get access token:', 'String error');
    });
  });

  describe('getLocale', () => {
    test('returns locale from Homey i18n when available', () => {
      const device = createMockDevice();
      (device.homey.i18n.getLanguage as jest.Mock).mockReturnValue('en');

      const locale = getLocale(device);

      expect(locale).toBe('en-EN');
      expect(device.homey.i18n.getLanguage).toHaveBeenCalled();
    });

    test('returns locale as-is when already in locale format', () => {
      const device = createMockDevice();
      (device.homey.i18n.getLanguage as jest.Mock).mockReturnValue('de-DE');

      const locale = getLocale(device);

      expect(locale).toBe('de-DE');
    });

    test('constructs locale from language code', () => {
      const device = createMockDevice();
      (device.homey.i18n.getLanguage as jest.Mock).mockReturnValue('fr');

      const locale = getLocale(device);

      expect(locale).toBe('fr-FR');
    });

    test('falls back to system locale when i18n fails', () => {
      const device = createMockDevice();
      (device.homey.i18n.getLanguage as jest.Mock).mockImplementation(() => {
        throw new Error('i18n error');
      });

      const locale = getLocale(device);

      expect(locale).toBe(Intl.DateTimeFormat().resolvedOptions().locale || 'en-US');
      expect(device.log).toHaveBeenCalledWith('[LOCALE] Could not get locale from Homey i18n, using system default');
    });

    test('falls back to system locale when language is too short', () => {
      const device = createMockDevice();
      (device.homey.i18n.getLanguage as jest.Mock).mockReturnValue('e');

      const locale = getLocale(device);

      expect(locale).toBe(Intl.DateTimeFormat().resolvedOptions().locale || 'en-US');
    });

    test('falls back to en-US when system locale is unavailable', () => {
      const device = createMockDevice();
      (device.homey.i18n.getLanguage as jest.Mock).mockImplementation(() => {
        throw new Error('i18n error');
      });

      // Mock Intl.DateTimeFormat to return undefined
      const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
      Intl.DateTimeFormat.prototype.resolvedOptions = jest.fn().mockReturnValue({ locale: undefined });

      const locale = getLocale(device);

      expect(locale).toBe('en-US');

      // Restore original
      Intl.DateTimeFormat.prototype.resolvedOptions = originalResolvedOptions;
    });

    test('handles null language gracefully', () => {
      const device = createMockDevice();
      (device.homey.i18n.getLanguage as jest.Mock).mockReturnValue(null);

      const locale = getLocale(device);

      expect(locale).toBe(Intl.DateTimeFormat().resolvedOptions().locale || 'en-US');
    });
  });

  describe('getTimezone', () => {
    test('returns timezone from Homey clock when available', () => {
      const device = createMockDevice();
      (device.homey.clock.getTimezone as jest.Mock).mockReturnValue('Europe/Berlin');

      const timezone = getTimezone(device);

      expect(timezone).toBe('Europe/Berlin');
      expect(device.homey.clock.getTimezone).toHaveBeenCalled();
    });

    test('falls back to system timezone when Homey clock fails', () => {
      const device = createMockDevice();
      (device.homey.clock.getTimezone as jest.Mock).mockImplementation(() => {
        throw new Error('Clock error');
      });

      const timezone = getTimezone(device);

      expect(timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
      expect(device.log).toHaveBeenCalledWith('[TIMEZONE] Could not get timezone from Homey clock, using system default');
    });

    test('falls back to UTC when system timezone is unavailable', () => {
      const device = createMockDevice();
      (device.homey.clock.getTimezone as jest.Mock).mockImplementation(() => {
        throw new Error('Clock error');
      });

      // Mock Intl.DateTimeFormat to return undefined
      const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
      Intl.DateTimeFormat.prototype.resolvedOptions = jest.fn().mockReturnValue({ timeZone: undefined });

      const timezone = getTimezone(device);

      expect(timezone).toBe('UTC');

      // Restore original
      Intl.DateTimeFormat.prototype.resolvedOptions = originalResolvedOptions;
    });

    test('handles different timezone formats', () => {
      const device = createMockDevice();
      (device.homey.clock.getTimezone as jest.Mock).mockReturnValue('America/New_York');

      const timezone = getTimezone(device);

      expect(timezone).toBe('America/New_York');
    });
  });
});

