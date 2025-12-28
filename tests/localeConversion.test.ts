/**
 * Tests for locale conversion logic
 * This mirrors the logic from device.ts getLocale()
 */

/**
 * Convert Homey language code to locale format
 * This mirrors the logic from device.ts getLocale()
 */
function convertLanguageToLocale(language: string | undefined): string {
  if (!language || language.length < 2) {
    return Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';
  }

  // If language is already in locale format (e.g., 'de-DE'), use it
  if (language.includes('-')) {
    return language;
  }

  // Otherwise, try to construct locale (default to same country code)
  const countryCode = language.toUpperCase();
  return `${language}-${countryCode}`;
}

describe('Locale Conversion', () => {
  describe('convertLanguageToLocale', () => {
    test('returns locale format when language already includes dash', () => {
      expect(convertLanguageToLocale('de-DE')).toBe('de-DE');
      expect(convertLanguageToLocale('en-US')).toBe('en-US');
      expect(convertLanguageToLocale('fr-FR')).toBe('fr-FR');
      expect(convertLanguageToLocale('nl-NL')).toBe('nl-NL');
    });

    test('converts simple language code to locale format', () => {
      expect(convertLanguageToLocale('de')).toBe('de-DE');
      expect(convertLanguageToLocale('en')).toBe('en-EN');
      expect(convertLanguageToLocale('fr')).toBe('fr-FR');
      expect(convertLanguageToLocale('nl')).toBe('nl-NL');
    });

    test('handles lowercase language codes', () => {
      expect(convertLanguageToLocale('de')).toBe('de-DE');
      expect(convertLanguageToLocale('en')).toBe('en-EN');
    });

    test('handles uppercase language codes', () => {
      expect(convertLanguageToLocale('DE')).toBe('DE-DE');
      expect(convertLanguageToLocale('EN')).toBe('EN-EN');
    });

    test('handles mixed case language codes', () => {
      expect(convertLanguageToLocale('De')).toBe('De-DE');
      expect(convertLanguageToLocale('eN')).toBe('eN-EN');
    });

    test('handles undefined language', () => {
      const result = convertLanguageToLocale(undefined);
      // Should fall back to system locale or 'en-US'
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    test('handles empty string', () => {
      const result = convertLanguageToLocale('');
      // Should fall back to system locale or 'en-US'
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    test('handles single character language code', () => {
      const result = convertLanguageToLocale('e');
      // Should fall back since length < 2
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    test('handles three-letter language codes', () => {
      expect(convertLanguageToLocale('eng')).toBe('eng-ENG');
      expect(convertLanguageToLocale('deu')).toBe('deu-DEU');
    });

    test('handles language codes with underscores', () => {
      // Underscores are not treated as separators, so they get converted
      expect(convertLanguageToLocale('de_DE')).toBe('de_DE-DE_DE'); // Gets converted
      expect(convertLanguageToLocale('en_GB')).toBe('en_GB-EN_GB'); // Gets converted
    });

    test('handles complex locale strings', () => {
      expect(convertLanguageToLocale('zh-Hans-CN')).toBe('zh-Hans-CN');
      expect(convertLanguageToLocale('en-US-x-private')).toBe('en-US-x-private');
    });
  });
});

describe('Manual Override Timing Logic', () => {
  const MANUAL_OVERRIDE_DURATION = 15 * 60 * 1000; // 15 minutes

  /**
   * Check if manual override is still active
   * This mirrors the logic from device.ts isManualOverrideActive()
   */
  function isManualOverrideActive(
    manualOverrideTimestamp: number | undefined,
    now: number = Date.now()
  ): boolean {
    if (!manualOverrideTimestamp) {
      return false;
    }

    const timeSinceManual = now - manualOverrideTimestamp;
    return timeSinceManual < MANUAL_OVERRIDE_DURATION;
  }

  describe('isManualOverrideActive', () => {
    test('returns false when no timestamp provided', () => {
      expect(isManualOverrideActive(undefined)).toBe(false);
    });

    test('returns true when override is still active', () => {
      const now = Date.now();
      const timestamp = now - (5 * 60 * 1000); // 5 minutes ago
      expect(isManualOverrideActive(timestamp, now)).toBe(true);
    });

    test('returns false when override has expired', () => {
      const now = Date.now();
      const timestamp = now - (20 * 60 * 1000); // 20 minutes ago
      expect(isManualOverrideActive(timestamp, now)).toBe(false);
    });

    test('returns true at exact boundary (just before expiry)', () => {
      const now = Date.now();
      const timestamp = now - (MANUAL_OVERRIDE_DURATION - 1000); // 1 second before expiry
      expect(isManualOverrideActive(timestamp, now)).toBe(true);
    });

    test('returns false at exact expiry time', () => {
      const now = Date.now();
      const timestamp = now - MANUAL_OVERRIDE_DURATION; // Exactly at expiry
      expect(isManualOverrideActive(timestamp, now)).toBe(false);
    });

    test('returns true immediately after override is set', () => {
      const now = Date.now();
      const timestamp = now; // Just set
      expect(isManualOverrideActive(timestamp, now)).toBe(true);
    });

    test('handles future timestamps (edge case)', () => {
      const now = Date.now();
      const timestamp = now + 1000; // Future timestamp
      expect(isManualOverrideActive(timestamp, now)).toBe(true); // Still considered active
    });

    test('calculates remaining time correctly', () => {
      const now = Date.now();
      const timestamp = now - (10 * 60 * 1000); // 10 minutes ago
      const isActive = isManualOverrideActive(timestamp, now);
      expect(isActive).toBe(true);

      // Should have ~5 minutes remaining
      const timeSinceManual = now - timestamp;
      const remaining = MANUAL_OVERRIDE_DURATION - timeSinceManual;
      expect(remaining).toBeCloseTo(5 * 60 * 1000, -3); // Within 1 second
    });
  });
});

describe('Automatic Control State Logic', () => {
  /**
   * Check if automatic control is active
   * This mirrors the logic from device.ts isAutomaticControlActive()
   */
  function isAutomaticControlActive(
    lowPriceEnabled: boolean,
    lowBatteryEnabled: boolean,
    lowPriceDeviceEnabled: boolean = false,
    lowBatteryDeviceEnabled: boolean = false
  ): boolean {
    return (lowPriceEnabled || lowPriceDeviceEnabled) ||
      (lowBatteryEnabled || lowBatteryDeviceEnabled);
  }

  describe('isAutomaticControlActive', () => {
    test('returns false when no automatic control is active', () => {
      expect(isAutomaticControlActive(false, false, false, false)).toBe(false);
    });

    test('returns true when low price is enabled', () => {
      expect(isAutomaticControlActive(true, false, false, false)).toBe(true);
    });

    test('returns true when low battery is enabled', () => {
      expect(isAutomaticControlActive(false, true, false, false)).toBe(true);
    });

    test('returns true when both are enabled', () => {
      expect(isAutomaticControlActive(true, true, false, false)).toBe(true);
    });

    test('returns true when low price device flag is set', () => {
      expect(isAutomaticControlActive(false, false, true, false)).toBe(true);
    });

    test('returns true when low battery device flag is set', () => {
      expect(isAutomaticControlActive(false, false, false, true)).toBe(true);
    });

    test('returns true when device flags are set even if settings are false', () => {
      expect(isAutomaticControlActive(false, false, true, true)).toBe(true);
    });

    test('returns true when any combination is active', () => {
      expect(isAutomaticControlActive(true, false, false, true)).toBe(true);
      expect(isAutomaticControlActive(false, true, true, false)).toBe(true);
      expect(isAutomaticControlActive(true, true, true, true)).toBe(true);
    });
  });
});

