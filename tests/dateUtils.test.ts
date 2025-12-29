/**
 * Tests for Date Utilities
 */

import {
  getUTCDate,
  getTodayUTCDate,
  getTomorrowUTCDate,
  getMillisecondsUntilNext15MinuteBoundary,
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

  describe('getMillisecondsUntilNext15MinuteBoundary', () => {
    const FIFTEEN_MINUTES_MS = 15 * MILLISECONDS_PER_MINUTE;

    test('calculates correct delay for time before first boundary (00:00)', () => {
      // 01:11 -> should go to 01:15 (4 minutes = 240000 ms)
      const timestamp = new Date('2025-12-18T01:11:30.500Z').getTime();
      const delay = getMillisecondsUntilNext15MinuteBoundary(timestamp);
      const expected = 4 * MILLISECONDS_PER_MINUTE - (30 * 1000 + 500); // 4 min - 30.5 sec
      expect(delay).toBe(expected);
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThan(FIFTEEN_MINUTES_MS);
    });

    test('calculates correct delay for time in first block (00:00-00:14)', () => {
      // 01:05:30 -> should go to 01:15:00 (9 minutes 30 seconds = 570000 ms)
      const timestamp = new Date('2025-12-18T01:05:30.000Z').getTime();
      const delay = getMillisecondsUntilNext15MinuteBoundary(timestamp);
      const expected = 9 * MILLISECONDS_PER_MINUTE + 30 * 1000;
      expect(delay).toBe(expected);
    });

    test('calculates correct delay for time in second block (00:15-00:29)', () => {
      // 01:26:45 -> should go to 01:30:00 (3 minutes 15 seconds = 195000 ms)
      const timestamp = new Date('2025-12-18T01:26:45.000Z').getTime();
      const delay = getMillisecondsUntilNext15MinuteBoundary(timestamp);
      const expected = 3 * MILLISECONDS_PER_MINUTE + 15 * 1000;
      expect(delay).toBe(expected);
    });

    test('calculates correct delay for time in third block (00:30-00:44)', () => {
      // 01:35:20 -> should go to 01:45:00 (9 minutes 40 seconds = 580000 ms)
      const timestamp = new Date('2025-12-18T01:35:20.000Z').getTime();
      const delay = getMillisecondsUntilNext15MinuteBoundary(timestamp);
      const expected = 9 * MILLISECONDS_PER_MINUTE + 40 * 1000;
      expect(delay).toBe(expected);
    });

    test('calculates correct delay for time in fourth block (00:45-00:59)', () => {
      // 01:56:10 -> should go to 02:00:00 (3 minutes 50 seconds = 230000 ms)
      const timestamp = new Date('2025-12-18T01:56:10.000Z').getTime();
      const delay = getMillisecondsUntilNext15MinuteBoundary(timestamp);
      const expected = 3 * MILLISECONDS_PER_MINUTE + 50 * 1000;
      expect(delay).toBe(expected);
    });

    test('handles exactly on boundary - moves to next boundary', () => {
      // 01:15:00 -> should go to 01:30:00 (15 minutes)
      const timestamp = new Date('2025-12-18T01:15:00.000Z').getTime();
      const delay = getMillisecondsUntilNext15MinuteBoundary(timestamp);
      expect(delay).toBe(FIFTEEN_MINUTES_MS);
    });

    test('handles exactly on :00 boundary', () => {
      // 01:00:00 -> should go to 01:15:00 (15 minutes)
      const timestamp = new Date('2025-12-18T01:00:00.000Z').getTime();
      const delay = getMillisecondsUntilNext15MinuteBoundary(timestamp);
      expect(delay).toBe(FIFTEEN_MINUTES_MS);
    });

    test('handles exactly on :30 boundary', () => {
      // 01:30:00 -> should go to 01:45:00 (15 minutes)
      const timestamp = new Date('2025-12-18T01:30:00.000Z').getTime();
      const delay = getMillisecondsUntilNext15MinuteBoundary(timestamp);
      expect(delay).toBe(FIFTEEN_MINUTES_MS);
    });

    test('handles exactly on :45 boundary', () => {
      // 01:45:00 -> should go to 02:00:00 (15 minutes)
      const timestamp = new Date('2025-12-18T01:45:00.000Z').getTime();
      const delay = getMillisecondsUntilNext15MinuteBoundary(timestamp);
      expect(delay).toBe(FIFTEEN_MINUTES_MS);
    });

    test('handles end of hour correctly (wraps to next hour)', () => {
      // 01:59:30 -> should go to 02:00:00 (30 seconds)
      const timestamp = new Date('2025-12-18T01:59:30.000Z').getTime();
      const delay = getMillisecondsUntilNext15MinuteBoundary(timestamp);
      expect(delay).toBe(30 * 1000);
    });

    test('handles milliseconds correctly', () => {
      // 01:11:30.500 -> should go to 01:15:00 (3 min 29.5 sec = 209500 ms)
      const timestamp = new Date('2025-12-18T01:11:30.500Z').getTime();
      const delay = getMillisecondsUntilNext15MinuteBoundary(timestamp);
      const expected = 3 * MILLISECONDS_PER_MINUTE + 29 * 1000 + 500;
      expect(delay).toBe(expected);
    });

    test('handles just before boundary (1 second before)', () => {
      // 01:14:59 -> should go to 01:15:00 (1 second)
      const timestamp = new Date('2025-12-18T01:14:59.000Z').getTime();
      const delay = getMillisecondsUntilNext15MinuteBoundary(timestamp);
      expect(delay).toBe(1000);
    });

    test('handles just after boundary (1 second after)', () => {
      // 01:15:01 -> should go to 01:30:00 (14 min 59 sec)
      const timestamp = new Date('2025-12-18T01:15:01.000Z').getTime();
      const delay = getMillisecondsUntilNext15MinuteBoundary(timestamp);
      const expected = 14 * MILLISECONDS_PER_MINUTE + 59 * 1000;
      expect(delay).toBe(expected);
    });

    test('returns positive delay for all times', () => {
      // Test various times throughout the day
      const testTimes = [
        '2025-12-18T00:00:00.000Z',
        '2025-12-18T00:07:30.000Z',
        '2025-12-18T00:15:00.000Z',
        '2025-12-18T00:22:45.000Z',
        '2025-12-18T00:30:00.000Z',
        '2025-12-18T00:37:15.000Z',
        '2025-12-18T00:45:00.000Z',
        '2025-12-18T00:52:30.000Z',
        '2025-12-18T01:00:00.000Z',
        '2025-12-18T12:30:00.000Z',
        '2025-12-18T23:45:00.000Z',
        '2025-12-18T23:59:59.999Z',
      ];

      testTimes.forEach((timeStr) => {
        const timestamp = new Date(timeStr).getTime();
        const delay = getMillisecondsUntilNext15MinuteBoundary(timestamp);
        expect(delay).toBeGreaterThan(0);
        expect(delay).toBeLessThanOrEqual(FIFTEEN_MINUTES_MS);
      });
    });

    test('delay is always less than or equal to 15 minutes', () => {
      // Test random times
      for (let hour = 0; hour < 24; hour++) {
        for (let minute = 0; minute < 60; minute += 7) {
          const timestamp = new Date(`2025-12-18T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`).getTime();
          const delay = getMillisecondsUntilNext15MinuteBoundary(timestamp);
          expect(delay).toBeGreaterThan(0);
          expect(delay).toBeLessThanOrEqual(FIFTEEN_MINUTES_MS);
        }
      }
    });

    test('works with Date.now() when no argument provided', () => {
      const now = Date.now();
      const delay = getMillisecondsUntilNext15MinuteBoundary();
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(FIFTEEN_MINUTES_MS);
    });

    test('verifies actual boundary time is correct', () => {
      // 01:11:30 -> should result in boundary at 01:15:00
      const timestamp = new Date('2025-12-18T01:11:30.000Z').getTime();
      const delay = getMillisecondsUntilNext15MinuteBoundary(timestamp);
      const boundaryTime = timestamp + delay;
      const boundaryDate = new Date(boundaryTime);
      
      expect(boundaryDate.getUTCMinutes()).toBe(15);
      expect(boundaryDate.getUTCSeconds()).toBe(0);
      expect(boundaryDate.getUTCMilliseconds()).toBe(0);
    });

    test('verifies boundary wraps to next hour correctly', () => {
      // 01:56:30 -> should result in boundary at 02:00:00
      const timestamp = new Date('2025-12-18T01:56:30.000Z').getTime();
      const delay = getMillisecondsUntilNext15MinuteBoundary(timestamp);
      const boundaryTime = timestamp + delay;
      const boundaryDate = new Date(boundaryTime);
      
      expect(boundaryDate.getUTCHours()).toBe(2);
      expect(boundaryDate.getUTCMinutes()).toBe(0);
      expect(boundaryDate.getUTCSeconds()).toBe(0);
      expect(boundaryDate.getUTCMilliseconds()).toBe(0);
    });

    test('handles edge case: 23:59:59 wraps to 00:00:00 next day', () => {
      // 23:59:59 -> should go to 00:00:00 next day
      const timestamp = new Date('2025-12-18T23:59:59.000Z').getTime();
      const delay = getMillisecondsUntilNext15MinuteBoundary(timestamp);
      expect(delay).toBe(1000); // 1 second
      
      const boundaryTime = timestamp + delay;
      const boundaryDate = new Date(boundaryTime);
      expect(boundaryDate.getUTCHours()).toBe(0);
      expect(boundaryDate.getUTCMinutes()).toBe(0);
      expect(boundaryDate.getUTCDate()).toBe(19); // Next day
    });
  });
});

