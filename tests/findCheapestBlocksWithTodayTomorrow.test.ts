import type { PriceBlock, PriceCache } from '../logic/lowPrice/types';
import { getTodayUTCDayStartMs, getTomorrowUTCDayStartMs, getUTCDayKey, getUTCDayStartMs } from '../logic/utils/dateUtils';
import { findCheapestBlocks } from '../logic/lowPrice/findCheapestHours';

describe('block identification (today vs tomorrow, future vs past)', () => {
  function createTestCache(now: number, opts?: { tomorrowBasePrice?: number }): PriceCache {
    const today = new Date(now);
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const blockDuration = 15 * 60 * 1000;
    const tomorrowBasePrice = opts?.tomorrowBasePrice ?? 0.05;
    const todayKey = getUTCDayKey(today.getTime());
    const tomorrowKey = getUTCDayKey(tomorrow.getTime());
    const todayBlocks: PriceBlock[] = [];
    const tomorrowBlocks: PriceBlock[] = [];

    for (let i = 0; i < 96; i++) {
      const start = today.getTime() + i * blockDuration;
      todayBlocks.push({ start, end: start + blockDuration, price: 0.10 + (i % 10) * 0.01 });
    }
    for (let i = 0; i < 96; i++) {
      const start = tomorrow.getTime() + i * blockDuration;
      tomorrowBlocks.push({ start, end: start + blockDuration, price: tomorrowBasePrice + (i % 10) * 0.01 });
    }

    return { [todayKey]: todayBlocks, [tomorrowKey]: tomorrowBlocks };
  }

  test('finds cheapest blocks from today when future blocks available', () => {
    const now = Date.UTC(2025, 11, 18, 12, 0, 0); // 2025-12-18 12:00 UTC
    // Make tomorrow more expensive so the algorithm deterministically prefers today.
    const cache = createTestCache(now, { tomorrowBasePrice: 0.30 });

    const cheapest = findCheapestBlocks(cache, 8, now);

    // Should find blocks from today (future blocks)
    expect(cheapest.length).toBeGreaterThan(0);
    const firstBlock = cheapest[0];
    expect(getUTCDayStartMs(firstBlock.start)).toBe(getTodayUTCDayStartMs(now));
    expect(firstBlock.start).toBeGreaterThan(now); // All should be future
  });

  test('finds cheapest blocks from tomorrow when all today blocks are in past', () => {
    // Set time to end of day (23:45)
    const now = Date.UTC(2025, 11, 18, 23, 45, 0); // 2025-12-18 23:45 UTC
    const cache = createTestCache(now);

    const cheapest = findCheapestBlocks(cache, 8, now);

    // Should find blocks from tomorrow since all today blocks are in past
    expect(cheapest.length).toBeGreaterThan(0);
    const firstBlock = cheapest[0];
    expect(getUTCDayStartMs(firstBlock.start)).toBe(getTomorrowUTCDayStartMs(now));
    expect(firstBlock.start).toBeGreaterThan(now); // All should be future
  });

  test('only returns future blocks', () => {
    const now = Date.UTC(2025, 11, 18, 12, 0, 0); // 2025-12-18 12:00 UTC
    const cache = createTestCache(now);

    const cheapest = findCheapestBlocks(cache, 8, now);

    // All returned blocks should be in the future
    expect(cheapest.every((b) => b.start > now)).toBe(true);
  });

  test('sorts blocks by time after selecting by price', () => {
    const now = Date.UTC(2025, 11, 18, 12, 0, 0); // 2025-12-18 12:00 UTC
    const cache = createTestCache(now);

    const cheapest = findCheapestBlocks(cache, 8, now);

    // Blocks should be sorted by time (ascending)
    for (let i = 1; i < cheapest.length; i++) {
      expect(cheapest[i].start).toBeGreaterThan(cheapest[i - 1].start);
    }
  });

  test('returns empty array when no relevant blocks available', () => {
    const now = Date.UTC(2025, 11, 18, 12, 0, 0);
    const cache: PriceCache = {}; // Empty cache

    const cheapest = findCheapestBlocks(cache, 8, now);
    expect(cheapest).toHaveLength(0);
  });

  test('returns fewer blocks when not enough future blocks available', () => {
    const now = Date.UTC(2025, 11, 18, 23, 30, 0); // Near end of day
    const cache = createTestCache(now);

    // Request 8 blocks but only 2 future blocks available from today
    const cheapest = findCheapestBlocks(cache, 8, now);

    // Should return available future blocks (from tomorrow)
    expect(cheapest.length).toBeGreaterThan(0);
    expect(cheapest.length).toBeLessThanOrEqual(8);
    expect(cheapest.every((b) => b.start > now)).toBe(true);
  });

  test('does not treat same day-of-month from previous month/year as today (regression)', () => {
    const now = Date.UTC(2026, 0, 20, 7, 55, 0);
    const todayStart = getTodayUTCDayStartMs(now);
    const tomorrowStart = getTomorrowUTCDayStartMs(now);
    const blockDuration = 15 * 60 * 1000;

    const oldMonthSameDay = Date.UTC(2025, 11, 20, 1, 0, 0);
    const todayBlock = {
      start: todayStart + 12 * blockDuration,
      end: todayStart + 13 * blockDuration,
      price: 0.10,
    };
    const tomorrowBlock = {
      start: tomorrowStart + 4 * blockDuration,
      end: tomorrowStart + 5 * blockDuration,
      price: 0.09,
    };

    const cache: PriceCache = {
      [getUTCDayKey(oldMonthSameDay)]: [{
        start: oldMonthSameDay,
        end: oldMonthSameDay + blockDuration,
        price: 0.0001,
      }],
      [getUTCDayKey(todayBlock.start)]: [todayBlock],
      [getUTCDayKey(tomorrowBlock.start)]: [tomorrowBlock],
    };

    const cheapest = findCheapestBlocks(cache, 8, now);

    // Ensure result never includes the old month/year block
    expect(cheapest.some((b) => b.start === oldMonthSameDay)).toBe(false);
    // And it still finds something relevant (today or tomorrow) in the future
    expect(cheapest.length).toBeGreaterThan(0);
    expect(cheapest.every((b) => getUTCDayStartMs(b.start) === todayStart || getUTCDayStartMs(b.start) === tomorrowStart)).toBe(true);
  });
});

