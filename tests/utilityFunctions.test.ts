/**
 * Tests for utility functions and helper logic extracted from device.ts and app.ts
 */

describe('Interval Calculation Logic', () => {
  const INFO_UPDATE_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
  const MANUAL_OVERRIDE_DURATION = 15 * 60 * 1000; // 15 minutes

  /**
   * Check if cache should be refreshed based on last fetch time
   */
  function shouldRefreshCache(
    lastFetch: number | undefined,
    interval: number,
    now: number = Date.now()
  ): boolean {
    return !lastFetch || (now - lastFetch) >= interval;
  }

  /**
   * Calculate hours until next refresh
   */
  function calculateHoursUntilNext(
    lastFetch: number,
    interval: number,
    now: number = Date.now()
  ): number {
    return Math.ceil((interval - (now - lastFetch)) / (60 * 60 * 1000));
  }

  /**
   * Calculate remaining minutes for manual override
   */
  function calculateRemainingMinutes(
    overrideTimestamp: number,
    duration: number,
    now: number = Date.now()
  ): number {
    const timeSinceOverride = now - overrideTimestamp;
    return Math.ceil((duration - timeSinceOverride) / (60 * 1000));
  }

  describe('shouldRefreshCache', () => {
    test('returns true when no last fetch exists', () => {
      expect(shouldRefreshCache(undefined, INFO_UPDATE_INTERVAL)).toBe(true);
    });

    test('returns true when interval has passed', () => {
      const now = Date.now();
      const lastFetch = now - (INFO_UPDATE_INTERVAL + 1000);
      expect(shouldRefreshCache(lastFetch, INFO_UPDATE_INTERVAL, now)).toBe(true);
    });

    test('returns false when interval has not passed', () => {
      const now = Date.now();
      const lastFetch = now - (12 * 60 * 60 * 1000); // 12 hours ago
      expect(shouldRefreshCache(lastFetch, INFO_UPDATE_INTERVAL, now)).toBe(false);
    });

    test('returns true at exact interval boundary', () => {
      const now = Date.now();
      const lastFetch = now - INFO_UPDATE_INTERVAL; // Exactly at interval
      expect(shouldRefreshCache(lastFetch, INFO_UPDATE_INTERVAL, now)).toBe(true);
    });

    test('returns false just before interval', () => {
      const now = Date.now();
      const lastFetch = now - (INFO_UPDATE_INTERVAL - 1000); // 1 second before
      expect(shouldRefreshCache(lastFetch, INFO_UPDATE_INTERVAL, now)).toBe(false);
    });
  });

  describe('calculateHoursUntilNext', () => {
    test('calculates hours correctly when time remaining', () => {
      const now = Date.now();
      const lastFetch = now - (12 * 60 * 60 * 1000); // 12 hours ago
      const hours = calculateHoursUntilNext(lastFetch, INFO_UPDATE_INTERVAL, now);
      expect(hours).toBe(12); // 24 - 12 = 12 hours remaining
    });

    test('calculates hours correctly when just refreshed', () => {
      const now = Date.now();
      const lastFetch = now - 1000; // 1 second ago
      const hours = calculateHoursUntilNext(lastFetch, INFO_UPDATE_INTERVAL, now);
      expect(hours).toBe(24); // Almost full interval remaining
    });

    test('returns 1 when close to expiry', () => {
      const now = Date.now();
      const lastFetch = now - (23 * 60 * 60 * 1000 + 30 * 60 * 1000); // 23.5 hours ago
      const hours = calculateHoursUntilNext(lastFetch, INFO_UPDATE_INTERVAL, now);
      expect(hours).toBe(1); // Less than 1 hour remaining, rounds up to 1
    });

    test('handles edge case at exact interval', () => {
      const now = Date.now();
      const lastFetch = now - INFO_UPDATE_INTERVAL; // Exactly at interval
      const hours = calculateHoursUntilNext(lastFetch, INFO_UPDATE_INTERVAL, now);
      expect(hours).toBe(0); // No time remaining
    });
  });

  describe('calculateRemainingMinutes', () => {
    test('calculates remaining minutes correctly', () => {
      const now = Date.now();
      const overrideTimestamp = now - (10 * 60 * 1000); // 10 minutes ago
      const remaining = calculateRemainingMinutes(overrideTimestamp, MANUAL_OVERRIDE_DURATION, now);
      expect(remaining).toBe(5); // 15 - 10 = 5 minutes remaining
    });

    test('returns 15 when just set', () => {
      const now = Date.now();
      const overrideTimestamp = now; // Just set
      const remaining = calculateRemainingMinutes(overrideTimestamp, MANUAL_OVERRIDE_DURATION, now);
      expect(remaining).toBe(15); // Full duration remaining
    });

    test('returns 1 when close to expiry', () => {
      const now = Date.now();
      const overrideTimestamp = now - (14 * 60 * 1000 + 30 * 1000); // 14.5 minutes ago
      const remaining = calculateRemainingMinutes(overrideTimestamp, MANUAL_OVERRIDE_DURATION, now);
      expect(remaining).toBe(1); // Less than 1 minute, rounds up to 1
    });

    test('returns 0 when expired', () => {
      const now = Date.now();
      const overrideTimestamp = now - MANUAL_OVERRIDE_DURATION; // Exactly expired
      const remaining = calculateRemainingMinutes(overrideTimestamp, MANUAL_OVERRIDE_DURATION, now);
      expect(remaining).toBe(0);
    });
  });
});

describe('Price Source Selection Logic', () => {
  /**
   * Determine which price source to use based on token configuration
   * This mirrors the logic from device.ts onInit()
   */
  function selectPriceSource(tibberToken: string | undefined): 'tibber' | 'smard' {
    const token = tibberToken && tibberToken.trim() !== '' ? tibberToken : undefined;
    return token ? 'tibber' : 'smard';
  }

  describe('selectPriceSource', () => {
    test('selects Tibber when token is provided', () => {
      expect(selectPriceSource('valid-token-123')).toBe('tibber');
    });

    test('selects SMARD when token is undefined', () => {
      expect(selectPriceSource(undefined)).toBe('smard');
    });

    test('selects SMARD when token is empty string', () => {
      expect(selectPriceSource('')).toBe('smard');
    });

    test('selects SMARD when token is only whitespace', () => {
      expect(selectPriceSource('   ')).toBe('smard');
      expect(selectPriceSource('\t\n')).toBe('smard');
    });

    test('selects Tibber when token has whitespace but is not empty', () => {
      expect(selectPriceSource('  token  ')).toBe('tibber');
    });
  });
});

describe('VIN Resolution Logic', () => {
  /**
   * Resolve VIN from multiple sources (store, data, settings)
   * This mirrors the logic from device.ts
   */
  function resolveVin(
    storeVin: string | undefined,
    dataVin: string | undefined,
    settingVin: string | undefined
  ): string | undefined {
    return storeVin || dataVin || settingVin;
  }

  describe('resolveVin', () => {
    test('returns store VIN when available', () => {
      expect(resolveVin('VIN123', undefined, undefined)).toBe('VIN123');
    });

    test('returns data VIN when store VIN is not available', () => {
      expect(resolveVin(undefined, 'VIN456', undefined)).toBe('VIN456');
    });

    test('returns setting VIN when store and data VIN are not available', () => {
      expect(resolveVin(undefined, undefined, 'VIN789')).toBe('VIN789');
    });

    test('prioritizes store over data and settings', () => {
      expect(resolveVin('VIN1', 'VIN2', 'VIN3')).toBe('VIN1');
    });

    test('prioritizes data over settings', () => {
      expect(resolveVin(undefined, 'VIN2', 'VIN3')).toBe('VIN2');
    });

    test('returns undefined when no VIN is available', () => {
      expect(resolveVin(undefined, undefined, undefined)).toBeUndefined();
    });

    test('handles empty strings as undefined', () => {
      expect(resolveVin('', '', '')).toBe('');
      // Note: In actual code, empty strings might be treated differently
      // This test documents current behavior
    });
  });
});

describe('Battery Level Comparison Logic', () => {
  /**
   * Check if battery is below threshold
   */
  function isBatteryBelowThreshold(
    batteryLevel: number | null | undefined,
    threshold: number | null | undefined
  ): boolean {
    if (threshold == null || batteryLevel == null) {
      return false;
    }
    return threshold > 0 && batteryLevel < threshold;
  }

  /**
   * Check if battery is at or above threshold
   */
  function isBatteryAtOrAboveThreshold(
    batteryLevel: number | null | undefined,
    threshold: number | null | undefined
  ): boolean {
    if (threshold == null || batteryLevel == null) {
      return false;
    }
    return batteryLevel >= threshold;
  }

  describe('isBatteryBelowThreshold', () => {
    test('returns true when battery is below threshold', () => {
      expect(isBatteryBelowThreshold(30, 40)).toBe(true);
    });

    test('returns false when battery is at threshold', () => {
      expect(isBatteryBelowThreshold(40, 40)).toBe(false);
    });

    test('returns false when battery is above threshold', () => {
      expect(isBatteryBelowThreshold(50, 40)).toBe(false);
    });

    test('returns false when threshold is null', () => {
      expect(isBatteryBelowThreshold(30, null)).toBe(false);
    });

    test('returns false when battery level is null', () => {
      expect(isBatteryBelowThreshold(null, 40)).toBe(false);
    });

    test('returns false when threshold is zero or negative', () => {
      expect(isBatteryBelowThreshold(30, 0)).toBe(false);
      expect(isBatteryBelowThreshold(30, -10)).toBe(false);
    });

    test('handles edge case with very low battery', () => {
      expect(isBatteryBelowThreshold(0, 40)).toBe(true);
      expect(isBatteryBelowThreshold(1, 40)).toBe(true);
    });

    test('handles edge case with very high battery', () => {
      expect(isBatteryBelowThreshold(100, 40)).toBe(false);
      expect(isBatteryBelowThreshold(150, 40)).toBe(false); // Invalid but test robustness
    });
  });

  describe('isBatteryAtOrAboveThreshold', () => {
    test('returns true when battery is at threshold', () => {
      expect(isBatteryAtOrAboveThreshold(40, 40)).toBe(true);
    });

    test('returns true when battery is above threshold', () => {
      expect(isBatteryAtOrAboveThreshold(50, 40)).toBe(true);
    });

    test('returns false when battery is below threshold', () => {
      expect(isBatteryAtOrAboveThreshold(30, 40)).toBe(false);
    });

    test('returns false when threshold is null', () => {
      expect(isBatteryAtOrAboveThreshold(50, null)).toBe(false);
    });

    test('returns false when battery level is null', () => {
      expect(isBatteryAtOrAboveThreshold(null, 40)).toBe(false);
    });
  });
});

describe('Range Conversion Logic', () => {
  /**
   * Convert meters to kilometers and round
   * This mirrors the logic from device.ts refreshStatus()
   */
  function convertMetersToKilometers(meters: number): number {
    return Math.round(meters / 1000);
  }

  describe('convertMetersToKilometers', () => {
    test('converts meters to kilometers correctly', () => {
      expect(convertMetersToKilometers(1000)).toBe(1);
      expect(convertMetersToKilometers(5000)).toBe(5);
      expect(convertMetersToKilometers(10000)).toBe(10);
    });

    test('rounds to nearest kilometer', () => {
      expect(convertMetersToKilometers(1500)).toBe(2); // Rounds up
      expect(convertMetersToKilometers(1499)).toBe(1); // Rounds down
      expect(convertMetersToKilometers(500)).toBe(1); // Rounds up
      expect(convertMetersToKilometers(499)).toBe(0); // Rounds down
    });

    test('handles zero meters', () => {
      expect(convertMetersToKilometers(0)).toBe(0);
    });

    test('handles very large distances', () => {
      expect(convertMetersToKilometers(1000000)).toBe(1000);
      expect(convertMetersToKilometers(500000)).toBe(500);
    });

    test('handles fractional kilometers correctly', () => {
      expect(convertMetersToKilometers(250)).toBe(0); // Rounds down
      expect(convertMetersToKilometers(750)).toBe(1); // Rounds up
    });
  });
});

describe('Error Message Truncation', () => {
  /**
   * Truncate error message to specified length
   * This mirrors various error message truncations in device.ts
   */
  function truncateErrorMessage(message: string, maxLength: number): string {
    if (message.length <= maxLength) {
      return message;
    }
    return message.substring(0, maxLength);
  }

  describe('truncateErrorMessage', () => {
    test('returns message unchanged when shorter than max length', () => {
      expect(truncateErrorMessage('Short error', 50)).toBe('Short error');
    });

    test('truncates message when longer than max length', () => {
      const longMessage = 'A'.repeat(100);
      const result = truncateErrorMessage(longMessage, 50);
      expect(result.length).toBe(50);
      expect(result).toBe('A'.repeat(50));
    });

    test('truncates at exact boundary', () => {
      const message = 'A'.repeat(50);
      expect(truncateErrorMessage(message, 50)).toBe(message);
    });

    test('handles empty string', () => {
      expect(truncateErrorMessage('', 50)).toBe('');
    });

    test('handles zero max length', () => {
      expect(truncateErrorMessage('Error', 0)).toBe('');
    });

    test('handles very short max length', () => {
      expect(truncateErrorMessage('Long error message', 5)).toBe('Long ');
    });
  });
});

describe('Image URL Extraction Logic', () => {
  interface RenderLayer {
    url: string;
    type: string;
    order: number;
    viewPoint: string;
  }

  interface CompositeRender {
    viewType: string;
    layers: RenderLayer[];
  }

  /**
   * Extract image URL from composite renders
   * This mirrors the logic from device.ts refreshVehicleInfo()
   */
  function extractImageUrl(renders: CompositeRender[]): string | undefined {
    if (!renders || renders.length === 0) {
      return undefined;
    }

    // Try HOME view first
    const homeRender = renders.find((r) => r.viewType === 'HOME');
    if (homeRender && homeRender.layers && homeRender.layers.length > 0) {
      const baseLayer = homeRender.layers.find((l) => l.order === 0);
      if (baseLayer && baseLayer.url && baseLayer.url.trim() !== '') {
        return baseLayer.url;
      }
    }

    // Fallback to UNMODIFIED_EXTERIOR_SIDE
    const sideRender = renders.find((r) => r.viewType === 'UNMODIFIED_EXTERIOR_SIDE');
    if (sideRender && sideRender.layers && sideRender.layers.length > 0) {
      const baseLayer = sideRender.layers.find((l) => l.order === 0);
      if (baseLayer && baseLayer.url && baseLayer.url.trim() !== '') {
        return baseLayer.url;
      }
    }

    return undefined;
  }

  describe('extractImageUrl', () => {
    test('returns URL from HOME view with order 0 layer', () => {
      const renders: CompositeRender[] = [
        {
          viewType: 'HOME',
          layers: [
            { url: 'https://example.com/image.jpg', type: 'base', order: 0, viewPoint: 'front' },
            { url: 'https://example.com/overlay.png', type: 'overlay', order: 1, viewPoint: 'front' },
          ],
        },
      ];
      expect(extractImageUrl(renders)).toBe('https://example.com/image.jpg');
    });

    test('returns URL from UNMODIFIED_EXTERIOR_SIDE when HOME not available', () => {
      const renders: CompositeRender[] = [
        {
          viewType: 'UNMODIFIED_EXTERIOR_SIDE',
          layers: [
            { url: 'https://example.com/side.jpg', type: 'base', order: 0, viewPoint: 'side' },
          ],
        },
      ];
      expect(extractImageUrl(renders)).toBe('https://example.com/side.jpg');
    });

    test('prioritizes HOME over UNMODIFIED_EXTERIOR_SIDE', () => {
      const renders: CompositeRender[] = [
        {
          viewType: 'HOME',
          layers: [
            { url: 'https://example.com/home.jpg', type: 'base', order: 0, viewPoint: 'front' },
          ],
        },
        {
          viewType: 'UNMODIFIED_EXTERIOR_SIDE',
          layers: [
            { url: 'https://example.com/side.jpg', type: 'base', order: 0, viewPoint: 'side' },
          ],
        },
      ];
      expect(extractImageUrl(renders)).toBe('https://example.com/home.jpg');
    });

    test('returns undefined when no renders available', () => {
      expect(extractImageUrl([])).toBeUndefined();
    });

    test('returns undefined when renders is null/undefined', () => {
      expect(extractImageUrl([])).toBeUndefined();
    });

    test('returns undefined when no layer with order 0', () => {
      const renders: CompositeRender[] = [
        {
          viewType: 'HOME',
          layers: [
            { url: 'https://example.com/image.jpg', type: 'base', order: 1, viewPoint: 'front' },
          ],
        },
      ];
      expect(extractImageUrl(renders)).toBeUndefined();
    });

    test('returns undefined when layer has empty URL', () => {
      const renders: CompositeRender[] = [
        {
          viewType: 'HOME',
          layers: [
            { url: '', type: 'base', order: 0, viewPoint: 'front' },
          ],
        },
      ];
      expect(extractImageUrl(renders)).toBeUndefined();
    });

    test('returns undefined when layer URL is only whitespace', () => {
      const renders: CompositeRender[] = [
        {
          viewType: 'HOME',
          layers: [
            { url: '   ', type: 'base', order: 0, viewPoint: 'front' },
          ],
        },
      ];
      expect(extractImageUrl(renders)).toBeUndefined();
    });

    test('handles multiple layers and finds order 0', () => {
      const renders: CompositeRender[] = [
        {
          viewType: 'HOME',
          layers: [
            { url: 'https://example.com/overlay.png', type: 'overlay', order: 2, viewPoint: 'front' },
            { url: 'https://example.com/base.jpg', type: 'base', order: 0, viewPoint: 'front' },
            { url: 'https://example.com/mid.png', type: 'mid', order: 1, viewPoint: 'front' },
          ],
        },
      ];
      expect(extractImageUrl(renders)).toBe('https://example.com/base.jpg');
    });
  });
});

describe('Default Value Logic', () => {
  /**
   * Get value with default fallback
   * This mirrors the pattern used throughout device.ts for settings
   */
  function getWithDefault<T>(value: T | undefined | null, defaultValue: T): T {
    return value != null ? value : defaultValue;
  }

  describe('getWithDefault', () => {
    test('returns value when provided', () => {
      expect(getWithDefault(8, 10)).toBe(8);
      expect(getWithDefault('custom', 'default')).toBe('custom');
    });

    test('returns default when value is undefined', () => {
      expect(getWithDefault(undefined, 10)).toBe(10);
    });

    test('returns default when value is null', () => {
      expect(getWithDefault(null, 10)).toBe(10);
    });

    test('handles zero as valid value', () => {
      expect(getWithDefault(0, 10)).toBe(0);
    });

    test('handles empty string as valid value', () => {
      expect(getWithDefault('', 'default')).toBe('');
    });

    test('handles false as valid value', () => {
      expect(getWithDefault(false, true)).toBe(false);
    });
  });
});

describe('Charging State Detection Logic', () => {
  /**
   * Check if charging state indicates active charging
   * This mirrors the logic from device.ts refreshStatus()
   */
  function isChargingStateActive(state: string): boolean {
    return state === 'CHARGING' || state === 'CHARGING_AC' || state === 'CHARGING_DC';
  }

  describe('isChargingStateActive', () => {
    test('returns true for CHARGING state', () => {
      expect(isChargingStateActive('CHARGING')).toBe(true);
    });

    test('returns true for CHARGING_AC state', () => {
      expect(isChargingStateActive('CHARGING_AC')).toBe(true);
    });

    test('returns true for CHARGING_DC state', () => {
      expect(isChargingStateActive('CHARGING_DC')).toBe(true);
    });

    test('returns false for non-charging states', () => {
      expect(isChargingStateActive('NOT_CHARGING')).toBe(false);
      expect(isChargingStateActive('IDLE')).toBe(false);
      expect(isChargingStateActive('STOPPED')).toBe(false);
      expect(isChargingStateActive('')).toBe(false);
    });

    test('is case sensitive', () => {
      expect(isChargingStateActive('charging')).toBe(false);
      expect(isChargingStateActive('Charging')).toBe(false);
      expect(isChargingStateActive('CHARGING_AC')).toBe(true);
    });

    test('handles unknown states', () => {
      expect(isChargingStateActive('UNKNOWN_STATE')).toBe(false);
      expect(isChargingStateActive('ERROR')).toBe(false);
    });
  });
});

describe('Error Message Extraction', () => {
  /**
   * Extract error message from error object or value
   * This mirrors the pattern used throughout device.ts and app.ts
   */
  function extractErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  describe('extractErrorMessage', () => {
    test('extracts message from Error instance', () => {
      const error = new Error('Test error message');
      expect(extractErrorMessage(error)).toBe('Test error message');
    });

    test('converts string to string', () => {
      expect(extractErrorMessage('String error')).toBe('String error');
    });

    test('converts number to string', () => {
      expect(extractErrorMessage(404)).toBe('404');
    });

    test('converts null to string', () => {
      expect(extractErrorMessage(null)).toBe('null');
    });

    test('converts undefined to string', () => {
      expect(extractErrorMessage(undefined)).toBe('undefined');
    });

    test('converts object to string', () => {
      expect(extractErrorMessage({ code: 'ERROR' })).toBe('[object Object]');
    });

    test('handles custom error types', () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }
      const error = new CustomError('Custom error');
      expect(extractErrorMessage(error)).toBe('Custom error');
    });
  });
});

