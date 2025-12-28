/**
 * Tests for Date Utilities
 */

import {
  getUTCDate,
  getTodayUTCDate,
  getTomorrowUTCDate,
  MILLISECONDS_PER_DAY,
  MILLISECONDS_PER_HOUR,
  MILLISECONDS_PER_MINUTE,
} from '../logic/utils/dateUtils';

describe('Date Utilities', () => {
  describe('Constants', () => {
    test('MILLISECONDS_PER_DAY is correct', () => {
      expect(MILLISECONDS_PER_DAY).toBe(24 * 60 * 60 * 1000);
      expect(MILLISECONDS_PER_DAY).toBe(86400000);
    });

    test('MILLISECONDS_PER_HOUR is correct', () => {
      expect(MILLISECONDS_PER_HOUR).toBe(60 * 60 * 1000);
      expect(MILLISECONDS_PER_HOUR).toBe(3600000);
    });

    test('MILLISECONDS_PER_MINUTE is correct', () => {
      expect(MILLISECONDS_PER_MINUTE).toBe(60 * 1000);
      expect(MILLISECONDS_PER_MINUTE).toBe(60000);
    });
  });

  describe('getUTCDate', () => {
    test('returns correct UTC date for known timestamp', () => {
      // 2025-12-18T00:00:00Z
      const timestamp = Date.UTC(2025, 11, 18, 0, 0, 0);
      expect(getUTCDate(timestamp)).toBe(18);
    });

    test('returns correct UTC date for different times of day', () => {
      const baseDate = Date.UTC(2025, 11, 18, 0, 0, 0);
      expect(getUTCDate(baseDate)).toBe(18);
      expect(getUTCDate(baseDate + MILLISECONDS_PER_HOUR * 12)).toBe(18);
      expect(getUTCDate(baseDate + MILLISECONDS_PER_HOUR * 23)).toBe(18);
    });

    test('handles month boundaries correctly', () => {
      // Dec 31, 2025
      const dec31 = Date.UTC(2025, 11, 31, 12, 0, 0);
      expect(getUTCDate(dec31)).toBe(31);

      // Jan 1, 2026
      const jan1 = Date.UTC(2026, 0, 1, 12, 0, 0);
      expect(getUTCDate(jan1)).toBe(1);

      // They should be different
      expect(getUTCDate(dec31)).not.toBe(getUTCDate(jan1));
    });

    test('handles year boundaries correctly', () => {
      // Dec 31, 2024
      const dec31_2024 = Date.UTC(2024, 11, 31, 12, 0, 0);
      expect(getUTCDate(dec31_2024)).toBe(31);

      // Jan 1, 2025
      const jan1_2025 = Date.UTC(2025, 0, 1, 12, 0, 0);
      expect(getUTCDate(jan1_2025)).toBe(1);
    });

    test('handles leap year February 29', () => {
      // Feb 29, 2024 (leap year)
      const feb29 = Date.UTC(2024, 1, 29, 12, 0, 0);
      expect(getUTCDate(feb29)).toBe(29);
    });

    test('handles different timezones correctly (always UTC)', () => {
      // Same moment in time, but getUTCDate should always return UTC date
      const timestamp = Date.UTC(2025, 11, 18, 23, 59, 59);
      expect(getUTCDate(timestamp)).toBe(18);
    });

    test('handles edge case: first day of month', () => {
      const firstDay = Date.UTC(2025, 0, 1, 0, 0, 0);
      expect(getUTCDate(firstDay)).toBe(1);
    });

    test('handles edge case: last day of month', () => {
      const lastDayJan = Date.UTC(2025, 0, 31, 23, 59, 59);
      expect(getUTCDate(lastDayJan)).toBe(31);

      const lastDayFeb = Date.UTC(2025, 1, 28, 23, 59, 59);
      expect(getUTCDate(lastDayFeb)).toBe(28);
    });

    test('handles very large timestamps', () => {
      const farFuture = Date.UTC(2100, 0, 1, 0, 0, 0);
      expect(getUTCDate(farFuture)).toBe(1);
    });

    test('handles very old timestamps', () => {
      const farPast = Date.UTC(1970, 0, 1, 0, 0, 0);
      expect(getUTCDate(farPast)).toBe(1);
    });
  });

  describe('getTodayUTCDate', () => {
    test('returns UTC date for current time when no argument provided', () => {
      const now = Date.now();
      const expected = new Date(now).getUTCDate();
      expect(getTodayUTCDate()).toBe(expected);
    });

    test('returns UTC date for provided timestamp', () => {
      const timestamp = Date.UTC(2025, 11, 18, 12, 0, 0);
      expect(getTodayUTCDate(timestamp)).toBe(18);
    });

    test('handles different times of day', () => {
      const baseTimestamp = Date.UTC(2025, 11, 18, 0, 0, 0);
      expect(getTodayUTCDate(baseTimestamp)).toBe(18);
      expect(getTodayUTCDate(baseTimestamp + MILLISECONDS_PER_HOUR * 12)).toBe(18);
      expect(getTodayUTCDate(baseTimestamp + MILLISECONDS_PER_HOUR * 23)).toBe(18);
    });
  });

  describe('getTomorrowUTCDate', () => {
    test('returns UTC date for tomorrow when no argument provided', () => {
      const now = Date.now();
      const tomorrow = new Date(now + MILLISECONDS_PER_DAY);
      const expected = tomorrow.getUTCDate();
      expect(getTomorrowUTCDate()).toBe(expected);
    });

    test('returns UTC date for day after provided timestamp', () => {
      const timestamp = Date.UTC(2025, 11, 18, 12, 0, 0);
      expect(getTomorrowUTCDate(timestamp)).toBe(19);
    });

    test('handles month boundaries correctly', () => {
      // Dec 31, 2025 -> Jan 1, 2026
      const dec31 = Date.UTC(2025, 11, 31, 12, 0, 0);
      expect(getTomorrowUTCDate(dec31)).toBe(1);
    });

    test('handles year boundaries correctly', () => {
      // Dec 31, 2024 -> Jan 1, 2025
      const dec31_2024 = Date.UTC(2024, 11, 31, 12, 0, 0);
      expect(getTomorrowUTCDate(dec31_2024)).toBe(1);
    });

    test('handles leap year correctly', () => {
      // Feb 28, 2024 (leap year) -> Feb 29, 2024
      const feb28 = Date.UTC(2024, 1, 28, 12, 0, 0);
      expect(getTomorrowUTCDate(feb28)).toBe(29);

      // Feb 29, 2024 -> Mar 1, 2024
      const feb29 = Date.UTC(2024, 1, 29, 12, 0, 0);
      expect(getTomorrowUTCDate(feb29)).toBe(1);
    });

    test('handles different times of day', () => {
      const baseTimestamp = Date.UTC(2025, 11, 18, 0, 0, 0);
      expect(getTomorrowUTCDate(baseTimestamp)).toBe(19);
      expect(getTomorrowUTCDate(baseTimestamp + MILLISECONDS_PER_HOUR * 12)).toBe(19);
      expect(getTomorrowUTCDate(baseTimestamp + MILLISECONDS_PER_HOUR * 23)).toBe(19);
    });
  });

  describe('Integration tests', () => {
    test('getTodayUTCDate and getTomorrowUTCDate work together', () => {
      const timestamp = Date.UTC(2025, 11, 18, 12, 0, 0);
      const today = getTodayUTCDate(timestamp);
      const tomorrow = getTomorrowUTCDate(timestamp);

      expect(today).toBe(18);
      expect(tomorrow).toBe(19);
      expect(tomorrow).toBe(today + 1);
    });

    test('handles month end correctly', () => {
      const lastDayOfMonth = Date.UTC(2025, 0, 31, 12, 0, 0); // Jan 31
      const today = getTodayUTCDate(lastDayOfMonth);
      const tomorrow = getTomorrowUTCDate(lastDayOfMonth);

      expect(today).toBe(31);
      expect(tomorrow).toBe(1); // Feb 1
    });

    test('consistency across multiple calls', () => {
      const timestamp = Date.UTC(2025, 11, 18, 12, 0, 0);
      const result1 = getUTCDate(timestamp);
      const result2 = getUTCDate(timestamp);
      const result3 = getUTCDate(timestamp);

      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
      expect(result1).toBe(18);
    });
  });
});

