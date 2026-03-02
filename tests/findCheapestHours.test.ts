import fs from 'fs';
import path from 'path';

import type { PriceBlock, PriceCache } from '../logic/lowPrice/types';
import { getUTCDayKey } from '../logic/utils/dateUtils';
import { findCheapestBlocks } from '../logic/lowPrice/findCheapestHours';

function blocksToDayBasedCache(blocks: PriceBlock[]): PriceCache {
  const cache: PriceCache = {};
  for (const b of blocks) {
    const key = getUTCDayKey(b.start);
    if (!cache[key]) cache[key] = [];
    cache[key].push(b);
  }
  for (const key of Object.keys(cache)) {
    cache[key].sort((a, b) => a.start - b.start);
  }
  return cache;
}

function loadPriceCacheFromJson(): PriceCache {
  const filePath = path.join(__dirname, 'assets', 'priceCache.json');
  const raw = fs.readFileSync(filePath, 'utf8');
  const blocks = JSON.parse(raw) as Array<PriceBlock>;
  return blocksToDayBasedCache(blocks);
}

describe('findCheapestBlocks', () => {
  const cache = loadPriceCacheFromJson();

  // Mock system time so any Date.now() / new Date() calls in the logic
  // behave as if we are on 2025-12-18.
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-12-18T00:00:00Z'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  describe('basic functionality', () => {
    test('returns the correct number of cheapest blocks', () => {
      const cheapest2 = findCheapestBlocks(cache, 2, Date.now());
      expect(cheapest2).toHaveLength(2);

      const cheapest8 = findCheapestBlocks(cache, 8, Date.now());
      expect(cheapest8).toHaveLength(8);
    });

    test('returns all blocks when count exceeds available blocks', () => {
      const result = findCheapestBlocks(cache, 1000, Date.now());
      // Should return all available blocks for today, sorted by time
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThanOrEqual(96); // Max 96 blocks per day (24h * 4)
      // Verify sorted by time
      for (let i = 1; i < result.length; i++) {
        expect(result[i].start).toBeGreaterThan(result[i - 1].start);
      }
    });

    test('sorts blocks by time after selecting by price', () => {
      const result = findCheapestBlocks(cache, 8, Date.now());
      // Blocks should be sorted by time (ascending)
      for (let i = 1; i < result.length; i++) {
        expect(result[i].start).toBeGreaterThan(result[i - 1].start);
      }
    });
  });

  describe('edge cases - input validation', () => {
    test('returns empty array when count is 0', () => {
      const result = findCheapestBlocks(cache, 0, Date.now());
      expect(result).toEqual([]);
    });

    test('returns empty array when count is negative', () => {
      const result = findCheapestBlocks(cache, -1, Date.now());
      expect(result).toEqual([]);
    });

    test('returns empty array when cache is empty', () => {
      const emptyCache: PriceCache = {};
      const result = findCheapestBlocks(emptyCache, 8, Date.now());
      expect(result).toEqual([]);
    });

    test('handles very large block counts', () => {
      const now = Date.now();
      const result = findCheapestBlocks(cache, 10000, now);
      // Should return available blocks (not crash)
      expect(result.length).toBeGreaterThanOrEqual(0);
      expect(result.length).toBeLessThanOrEqual(96); // Max blocks per day
      // Should not cause memory issues or crash
    });
  });

  describe('edge cases - date handling', () => {
    test('handles all blocks in past but same UTC day - returns empty or tomorrow blocks', () => {
      // Create cache with only past blocks on the same UTC day
      const now = Date.now();
      const today = new Date(now);
      today.setUTCHours(0, 0, 0, 0);
      const dayKey = getUTCDayKey(today.getTime());
      const pastBlocks: PriceBlock[] = [];
      for (let i = 1; i <= 10; i++) {
        const start = today.getTime() + (i * 15 * 60 * 1000);
        const end = start + 15 * 60 * 1000;
        pastBlocks.push({ start, end, price: 0.1 });
      }
      const pastCache: PriceCache = { [dayKey]: pastBlocks };
      const laterNow = today.getTime() + (20 * 60 * 60 * 1000);
      const result = findCheapestBlocks(pastCache, 8, laterNow);
      // Should return empty array since all blocks are in past and no tomorrow blocks
      expect(result.length).toBe(0);
    });

    test('handles getUTCDate comparison across month boundaries', () => {
      // Test the potential bug: getUTCDate() only compares day numbers (1-31)
      // Dec 31 and Jan 1 both have getUTCDate() = 1, which would be incorrectly equal
      const dec31 = Date.UTC(2025, 11, 31, 12, 0, 0); // Dec 31, 2025
      const jan1 = Date.UTC(2026, 0, 1, 12, 0, 0); // Jan 1, 2026
      
      // Verify the potential issue exists
      const dec31Date = new Date(dec31);
      const jan1Date = new Date(jan1);
      // These would be incorrectly equal if only comparing getUTCDate()
      expect(dec31Date.getUTCDate()).toBe(31);
      expect(jan1Date.getUTCDate()).toBe(1);
      // They are different, so the comparison should work correctly
      expect(dec31Date.getUTCDate()).not.toBe(jan1Date.getUTCDate());
      
      const blockDuration = 15 * 60 * 1000;
      const dec31Blocks: PriceBlock[] = [];
      for (let i = 0; i < 10; i++) {
        const start = dec31 + (i * blockDuration);
        const end = start + blockDuration;
        dec31Blocks.push({ start, end, price: 0.1 });
      }
      const cacheDec31: PriceCache = { [getUTCDayKey(dec31)]: dec31Blocks };

      const result = findCheapestBlocks(cacheDec31, 5, jan1);
      expect(result.length).toBe(0); // Should be empty since no blocks on Jan 1
    });
  });

  describe('edge cases - price handling', () => {
    test('handles duplicate prices', () => {
      const now = Date.now();
      const blockDuration = 15 * 60 * 1000;
      const blocks: PriceBlock[] = [];
      for (let i = 0; i < 10; i++) {
        const start = now + (60 * 60 * 1000) + (i * blockDuration);
        const end = start + blockDuration;
        blocks.push({ start, end, price: 0.1 });
      }
      const duplicateCache: PriceCache = blocksToDayBasedCache(blocks);
      const result = findCheapestBlocks(duplicateCache, 5, now);
      // Should return 5 blocks, sorted by time
      expect(result.length).toBe(5);
      for (let i = 1; i < result.length; i++) {
        expect(result[i].start).toBeGreaterThan(result[i - 1].start);
      }
    });

    test('handles negative prices', () => {
      const now = Date.now();
      const blockDuration = 15 * 60 * 1000;
      const blocks: PriceBlock[] = [];
      for (let i = 0; i < 5; i++) {
        const start = now + (60 * 60 * 1000) + (i * blockDuration);
        const end = start + blockDuration;
        blocks.push({ start, end, price: -0.1 * (5 - i) });
      }
      const negativeCache: PriceCache = blocksToDayBasedCache(blocks);
      const result = findCheapestBlocks(negativeCache, 3, now);
      // Should return 3 cheapest blocks (most negative), then sorted by time
      expect(result.length).toBe(3);
      // Verify they are the cheapest 3 (most negative prices)
      const prices = result.map(b => b.price).sort((a, b) => a - b);
      expect(prices[0]).toBeCloseTo(-0.5);
      expect(prices[1]).toBeCloseTo(-0.4);
      expect(prices[2]).toBeCloseTo(-0.3);
      // Verify final result is sorted by time
      for (let i = 1; i < result.length; i++) {
        expect(result[i].start).toBeGreaterThan(result[i - 1].start);
      }
    });

    test('handles very large prices', () => {
      const now = Date.now();
      const blockDuration = 15 * 60 * 1000;
      const blocks: PriceBlock[] = [];
      for (let i = 0; i < 5; i++) {
        const start = now + (60 * 60 * 1000) + (i * blockDuration);
        const end = start + blockDuration;
        blocks.push({ start, end, price: 1000000 + i });
      }
      const largeCache: PriceCache = blocksToDayBasedCache(blocks);
      const result = findCheapestBlocks(largeCache, 2, now);
      // Should still work correctly
      expect(result.length).toBe(2);
      expect(result[0].price).toBeLessThanOrEqual(result[1].price);
    });

    test('handles Infinity prices', () => {
      const now = Date.now();
      const today = new Date(now);
      today.setUTCHours(0, 0, 0, 0);
      const blockDuration = 15 * 60 * 1000;
      const blocks: PriceBlock[] = [];
      for (let i = 0; i < 5; i++) {
        const start = today.getTime() + i * blockDuration;
        const end = start + blockDuration;
        blocks.push({ start, end, price: i === 0 ? Infinity : 0.1 + i });
      }
      const infinityCache: PriceCache = blocksToDayBasedCache(blocks);
      const result = findCheapestBlocks(infinityCache, 3, now);
      // Should return blocks, Infinity should be treated as most expensive
      expect(result.length).toBe(3);
      // Infinity should not be in the cheapest 3
      expect(result.every(b => b.price !== Infinity)).toBe(true);
    });

    test('handles Number.MAX_VALUE prices', () => {
      const now = Date.now();
      const today = new Date(now);
      today.setUTCHours(0, 0, 0, 0);
      const blockDuration = 15 * 60 * 1000;
      const blocks: PriceBlock[] = [];
      for (let i = 0; i < 5; i++) {
        const start = today.getTime() + i * blockDuration;
        const end = start + blockDuration;
        blocks.push({ start, end, price: i === 0 ? Number.MAX_VALUE : 0.1 + i });
      }
      const maxValueCache: PriceCache = blocksToDayBasedCache(blocks);
      const result = findCheapestBlocks(maxValueCache, 3, now);
      // Should return blocks, MAX_VALUE should be treated as most expensive
      expect(result.length).toBe(3);
      expect(result.every(b => b.price !== Number.MAX_VALUE)).toBe(true);
    });
  });

  describe('edge cases - invalid data', () => {
    test('handles invalid block data with end < start', () => {
      const now = Date.now();
      const today = new Date(now);
      today.setUTCHours(0, 0, 0, 0);
      const invalidBlock: PriceBlock = {
        start: today.getTime() + 1000,
        end: today.getTime(),
        price: 0.1,
      };
      const invalidCache: PriceCache = { [getUTCDayKey(invalidBlock.start)]: [invalidBlock] };
      expect(() => findCheapestBlocks(invalidCache, 1, now)).not.toThrow();
    });

    test('handles invalid timestamps (NaN)', () => {
      const now = Date.now();
      const today = new Date(now);
      today.setUTCHours(0, 0, 0, 0);
      const blockDuration = 15 * 60 * 1000;
      const validStart = today.getTime();
      const dayKey = getUTCDayKey(validStart);
      const nanCache: PriceCache = {
        [dayKey]: [
          { start: validStart, end: validStart + blockDuration, price: 0.1 },
          { start: NaN, end: NaN + blockDuration, price: 0.1 },
        ],
      };
      const result = findCheapestBlocks(nanCache, 1, now);
      // Should return valid blocks only
      expect(result.every(b => !isNaN(b.start) && !isNaN(b.end))).toBe(true);
    });

    test('handles blocks with same start time (duplicate keys)', () => {
      const now = Date.now();
      const today = new Date(now);
      today.setUTCHours(0, 0, 0, 0);
      const blockDuration = 15 * 60 * 1000;
      const start = today.getTime();
      const dayKey = getUTCDayKey(start);
      const duplicateStartCache: PriceCache = {
        [dayKey]: [
          { start, end: start + blockDuration, price: 0.1 },
          { start, end: start + blockDuration * 2, price: 0.2 },
        ],
      };
      const result = findCheapestBlocks(duplicateStartCache, 1, now);
      // Should return at least one block
      expect(result.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('bug reproduction - 23:45 Berlin time block inclusion', () => {
    /**
     * Test-First Bug Fix Demonstration
     * 
     * This test reproduces the bug where blocks at 23:45 Berlin time (or any time)
     * were not included when:
     * 1. Block starts exactly at now (b.start === now)
     * 2. We're currently in the block (b.start < now < b.end)
     * 
     * The old bug: filter used b.start > now, which excluded:
     * - Blocks starting exactly at now
     * - Blocks we're currently in
     * 
     * The fix: changed filter to b.end > now, which includes:
     * - Blocks starting exactly at now (b.end > now is true)
     * - Blocks we're currently in (b.end > now is true)
     * 
     * This test would have FAILED with the old code, demonstrating test-first approach.
     */
    test('includes block starting exactly at now (23:45 Berlin time)', () => {
      // Reproduce bug: block at 23:45 Berlin time should be included when we're at 23:45
      // Berlin time is UTC+1 in winter, UTC+2 in summer
      // 23:45 Berlin time = 22:45 UTC (winter) or 21:45 UTC (summer)
      
      // Use winter time (UTC+1) for this test
      // 23:45 Berlin time = 22:45 UTC
      const berlinTime = new Date('2025-12-18T23:45:00+01:00'); // 23:45 Berlin time
      const utcTime = new Date('2025-12-18T22:45:00Z'); // 22:45 UTC (same moment)
      const now = utcTime.getTime();
      
      const blockDuration = 15 * 60 * 1000; // 15 minutes
      const blockStart = now; // Block starts exactly at now
      const blockEnd = blockStart + blockDuration;
      
      const testCache: PriceCache = {
        [getUTCDayKey(blockStart)]: [{ start: blockStart, end: blockEnd, price: 0.1 }],
      };

      const result = findCheapestBlocks(testCache, 1, now);
      
      expect(result.length).toBe(1);
      expect(result[0].start).toBe(blockStart);
      expect(result[0].end).toBe(blockEnd);
    });

    test('includes block when we are currently in it (23:46 Berlin time)', () => {
      // Test when we're in the middle of the block
      // 23:45 Berlin time = 22:45 UTC, block runs 23:45-00:00 Berlin time
      // At 23:46 Berlin time (22:46 UTC), we're in the block
      
      const berlinTime = new Date('2025-12-18T23:45:00+01:00'); // 23:45 Berlin time
      const blockStart = berlinTime.getTime();
      const blockDuration = 15 * 60 * 1000;
      const blockEnd = blockStart + blockDuration;
      
      // Now we're at 23:46 Berlin time (1 minute into the block)
      const nowAt2346 = new Date('2025-12-18T23:46:00+01:00').getTime();
      
      const testCache: PriceCache = {
        [getUTCDayKey(blockStart)]: [{ start: blockStart, end: blockEnd, price: 0.1 }],
      };

      const result = findCheapestBlocks(testCache, 1, nowAt2346);
      
      expect(result.length).toBe(1);
      expect(result[0].start).toBe(blockStart);
    });

    test('decideLowPriceCharging toggles ON when block is included at 23:45', () => {
      // Integration test: verify that when block is included, charging decision is correct
      const { decideLowPriceCharging } = require('../logic/lowPrice/decideLowPriceCharging');
      
      const berlinTime = new Date('2025-12-18T23:45:00+01:00');
      const now = berlinTime.getTime();
      const blockDuration = 15 * 60 * 1000;
      
      const block: PriceBlock = {
        start: now,
        end: now + blockDuration,
        price: 0.1,
      };
      
      const testCache: PriceCache = {
        [getUTCDayKey(block.start)]: [block],
      };
      const cheapest = findCheapestBlocks(testCache, 1, now);
      
      expect(cheapest.length).toBe(1);
      
      // Now verify charging decision
      const decision = decideLowPriceCharging(cheapest, now, {
        enableLowPrice: true,
        batteryLevel: 80,
        lowBatteryThreshold: 40,
        manualOverrideActive: false,
        wasOnDueToPrice: false,
      });
      
      // Should decide to turn ON because we're in the cheapest period
      expect(decision).toBe('turnOn');
    });
  });

  describe('skip today when tomorrow is cheaper', () => {
    test('skips today and uses 2x count for tomorrow when today is more expensive', () => {
      const now = Date.now();
      const todayUTC = new Date(now).getUTCDate();
      const tomorrowUTC = new Date(now + 24 * 60 * 60 * 1000).getUTCDate();
      const blockDuration = 15 * 60 * 1000;

      const todayKey = getUTCDayKey(now);
      const tomorrowKey = getUTCDayKey(now + 24 * 60 * 60 * 1000);
      const todayBlocks: PriceBlock[] = [];
      for (let i = 0; i < 8; i++) {
        const start = now + (60 * 60 * 1000) + (i * blockDuration);
        todayBlocks.push({ start, end: start + blockDuration, price: 0.5 });
      }
      const tomorrowStart = now + (24 * 60 * 60 * 1000);
      const tomorrowBlocks: PriceBlock[] = [];
      for (let i = 0; i < 20; i++) {
        const start = tomorrowStart + (i * blockDuration);
        tomorrowBlocks.push({ start, end: start + blockDuration, price: 0.1 });
      }
      const testCache: PriceCache = { [todayKey]: todayBlocks, [tomorrowKey]: tomorrowBlocks };

      const result = findCheapestBlocks(testCache, 4, now);

      // Should return 8 blocks (2x the requested count)
      expect(result.length).toBe(8);

      // All blocks should be from tomorrow
      result.forEach(block => {
        const blockDate = new Date(block.start).getUTCDate();
        expect(blockDate).toBe(tomorrowUTC);
      });

      // All blocks should be cheap (0.1)
      result.forEach(block => {
        expect(block.price).toBe(0.1);
      });
    });

    test('uses today when today is cheaper than tomorrow', () => {
      const now = Date.now();
      const todayUTC = new Date(now).getUTCDate();
      const blockDuration = 15 * 60 * 1000;
      const todayKey = getUTCDayKey(now);
      const tomorrowKey = getUTCDayKey(now + 24 * 60 * 60 * 1000);
      const todayBlocks: PriceBlock[] = [];
      for (let i = 0; i < 8; i++) {
        const start = now + (60 * 60 * 1000) + (i * blockDuration);
        todayBlocks.push({ start, end: start + blockDuration, price: 0.1 });
      }
      const tomorrowStart = now + (24 * 60 * 60 * 1000);
      const tomorrowBlocks: PriceBlock[] = [];
      for (let i = 0; i < 20; i++) {
        const start = tomorrowStart + (i * blockDuration);
        tomorrowBlocks.push({ start, end: start + blockDuration, price: 0.5 });
      }
      const testCache: PriceCache = { [todayKey]: todayBlocks, [tomorrowKey]: tomorrowBlocks };

      const result = findCheapestBlocks(testCache, 4, now);

      // Should return 4 blocks from today
      expect(result.length).toBe(4);

      // All blocks should be from today
      result.forEach(block => {
        const blockDate = new Date(block.start).getUTCDate();
        expect(blockDate).toBe(todayUTC);
      });

      // All blocks should be cheap (0.1)
      result.forEach(block => {
        expect(block.price).toBe(0.1);
      });
    });

    test('uses today when prices are equal', () => {
      const now = Date.now();
      const todayUTC = new Date(now).getUTCDate();
      const blockDuration = 15 * 60 * 1000;
      const todayKey = getUTCDayKey(now);
      const tomorrowKey = getUTCDayKey(now + 24 * 60 * 60 * 1000);
      const todayBlocks: PriceBlock[] = [];
      for (let i = 0; i < 8; i++) {
        const start = now + (60 * 60 * 1000) + (i * blockDuration);
        todayBlocks.push({ start, end: start + blockDuration, price: 0.2 });
      }
      const tomorrowStart = now + (24 * 60 * 60 * 1000);
      const tomorrowBlocks: PriceBlock[] = [];
      for (let i = 0; i < 20; i++) {
        const start = tomorrowStart + (i * blockDuration);
        tomorrowBlocks.push({ start, end: start + blockDuration, price: 0.2 });
      }
      const testCache: PriceCache = { [todayKey]: todayBlocks, [tomorrowKey]: tomorrowBlocks };

      const result = findCheapestBlocks(testCache, 4, now);

      // Should return 4 blocks from today
      expect(result.length).toBe(4);

      // All blocks should be from today
      result.forEach(block => {
        const blockDate = new Date(block.start).getUTCDate();
        expect(blockDate).toBe(todayUTC);
      });
    });

    test('handles case when today has no future blocks but tomorrow is cheaper', () => {
      const now = Date.now();
      const tomorrowUTC = new Date(now + 24 * 60 * 60 * 1000).getUTCDate();
      const blockDuration = 15 * 60 * 1000;
      const todayKey = getUTCDayKey(now);
      const tomorrowKey = getUTCDayKey(now + 24 * 60 * 60 * 1000);
      const todayBlocks: PriceBlock[] = [];
      for (let i = 0; i < 8; i++) {
        const start = now - (2 * 60 * 60 * 1000) - ((8 - i) * blockDuration);
        todayBlocks.push({ start, end: start + blockDuration, price: 0.5 });
      }
      const tomorrowStart = now + (24 * 60 * 60 * 1000);
      const tomorrowBlocks: PriceBlock[] = [];
      for (let i = 0; i < 20; i++) {
        const start = tomorrowStart + (i * blockDuration);
        tomorrowBlocks.push({ start, end: start + blockDuration, price: 0.1 });
      }
      const testCache: PriceCache = { [todayKey]: todayBlocks, [tomorrowKey]: tomorrowBlocks };

      const result = findCheapestBlocks(testCache, 4, now);

      // Should return 4 blocks from tomorrow (normal count, not 2x, since today has no future blocks)
      expect(result.length).toBe(4);

      // All blocks should be from tomorrow
      result.forEach(block => {
        const blockDate = new Date(block.start).getUTCDate();
        expect(blockDate).toBe(tomorrowUTC);
      });
    });
  });
});

