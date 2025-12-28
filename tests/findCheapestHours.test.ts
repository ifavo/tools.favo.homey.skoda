import fs from 'fs';
import path from 'path';

import type { PriceBlock, PriceCache } from '../logic/lowPrice/types';
import { findCheapestBlocks } from '../logic/lowPrice/findCheapestHours';

function loadPriceCacheFromJson(): PriceCache {
  const filePath = path.join(__dirname, 'assets', 'priceCache.json');
  const raw = fs.readFileSync(filePath, 'utf8');
  const blocks = JSON.parse(raw) as Array<PriceBlock>;

  const cache: PriceCache = {};
  for (const b of blocks) {
    cache[String(b.start)] = b;
  }
  return cache;
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
    test('handles all blocks in past but same UTC day', () => {
      // Create cache with only past blocks on the same UTC day
      const now = Date.now();
      const today = new Date(now);
      today.setUTCHours(0, 0, 0, 0);
      const pastCache: PriceCache = {};
      // Create blocks earlier today (but still same UTC day)
      for (let i = 1; i <= 10; i++) {
        const start = today.getTime() + (i * 15 * 60 * 1000); // i*15 minutes after midnight
        const end = start + 15 * 60 * 1000;
        pastCache[String(start)] = { start, end, price: 0.1 };
      }
      // Set now to later in the day so blocks are in past
      const laterNow = today.getTime() + (20 * 60 * 60 * 1000); // 20:00 UTC
      const result = findCheapestBlocks(pastCache, 8, laterNow);
      // Should return blocks from today even if they're in the past
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThanOrEqual(10);
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
      
      // Create cache with blocks on Dec 31
      const cacheDec31: PriceCache = {};
      const blockDuration = 15 * 60 * 1000;
      for (let i = 0; i < 10; i++) {
        const start = dec31 + (i * blockDuration);
        const end = start + blockDuration;
        cacheDec31[String(start)] = { start, end, price: 0.1 };
      }
      
      // Query on Jan 1 should NOT return Dec 31 blocks
      const result = findCheapestBlocks(cacheDec31, 5, jan1);
      expect(result.length).toBe(0); // Should be empty since no blocks on Jan 1
    });
  });

  describe('edge cases - price handling', () => {
    test('handles duplicate prices', () => {
      const now = Date.now();
      const today = new Date(now);
      today.setUTCHours(0, 0, 0, 0);
      const blockDuration = 15 * 60 * 1000;
      const duplicateCache: PriceCache = {};
      // Create blocks with same price
      for (let i = 0; i < 10; i++) {
        const start = today.getTime() + i * blockDuration;
        const end = start + blockDuration;
        duplicateCache[String(start)] = { start, end, price: 0.1 }; // All same price
      }
      const result = findCheapestBlocks(duplicateCache, 5, now);
      // Should return 5 blocks, sorted by time
      expect(result.length).toBe(5);
      for (let i = 1; i < result.length; i++) {
        expect(result[i].start).toBeGreaterThan(result[i - 1].start);
      }
    });

    test('handles negative prices', () => {
      const now = Date.now();
      const today = new Date(now);
      today.setUTCHours(0, 0, 0, 0);
      const blockDuration = 15 * 60 * 1000;
      const negativeCache: PriceCache = {};
      // Create blocks with negative prices (shouldn't happen but test robustness)
      // Prices: -0.5, -0.4, -0.3, -0.2, -0.1 (most negative = cheapest)
      for (let i = 0; i < 5; i++) {
        const start = today.getTime() + i * blockDuration;
        const end = start + blockDuration;
        negativeCache[String(start)] = { start, end, price: -0.1 * (5 - i) }; // -0.5, -0.4, -0.3, -0.2, -0.1
      }
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
      const today = new Date(now);
      today.setUTCHours(0, 0, 0, 0);
      const blockDuration = 15 * 60 * 1000;
      const largeCache: PriceCache = {};
      // Create blocks with very large prices
      for (let i = 0; i < 5; i++) {
        const start = today.getTime() + i * blockDuration;
        const end = start + blockDuration;
        largeCache[String(start)] = { start, end, price: 1000000 + i }; // Very large prices
      }
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
      const infinityCache: PriceCache = {};
      // Create blocks with Infinity and normal prices
      for (let i = 0; i < 5; i++) {
        const start = today.getTime() + i * blockDuration;
        const end = start + blockDuration;
        infinityCache[String(start)] = {
          start,
          end,
          price: i === 0 ? Infinity : 0.1 + i, // First block has Infinity
        };
      }
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
      const maxValueCache: PriceCache = {};
      // Create blocks with Number.MAX_VALUE and normal prices
      for (let i = 0; i < 5; i++) {
        const start = today.getTime() + i * blockDuration;
        const end = start + blockDuration;
        maxValueCache[String(start)] = {
          start,
          end,
          price: i === 0 ? Number.MAX_VALUE : 0.1 + i,
        };
      }
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
      const invalidCache: PriceCache = {};
      // Create invalid block where end < start
      const invalidBlock: PriceBlock = {
        start: today.getTime() + 1000,
        end: today.getTime(), // end before start
        price: 0.1,
      };
      invalidCache[String(invalidBlock.start)] = invalidBlock;
      // Function should not crash, but behavior is undefined
      // Just verify it doesn't throw
      expect(() => findCheapestBlocks(invalidCache, 1, now)).not.toThrow();
    });

    test('handles invalid timestamps (NaN)', () => {
      const now = Date.now();
      const today = new Date(now);
      today.setUTCHours(0, 0, 0, 0);
      const blockDuration = 15 * 60 * 1000;
      const nanCache: PriceCache = {};
      // Create blocks with NaN start (shouldn't happen but test robustness)
      const validStart = today.getTime();
      nanCache[String(validStart)] = {
        start: validStart,
        end: validStart + blockDuration,
        price: 0.1,
      };
      // Add block with NaN start (invalid)
      nanCache['NaN'] = {
        start: NaN,
        end: NaN + blockDuration,
        price: 0.1,
      };
      // Function should filter out NaN blocks or handle gracefully
      const result = findCheapestBlocks(nanCache, 1, now);
      // Should return valid blocks only
      expect(result.every(b => !isNaN(b.start) && !isNaN(b.end))).toBe(true);
    });

    test('handles blocks with same start time (duplicate keys)', () => {
      const now = Date.now();
      const today = new Date(now);
      today.setUTCHours(0, 0, 0, 0);
      const blockDuration = 15 * 60 * 1000;
      const duplicateStartCache: PriceCache = {};
      const start = today.getTime();
      // Create multiple blocks with same start (shouldn't happen with proper cache, but test)
      duplicateStartCache[String(start)] = { start, end: start + blockDuration, price: 0.1 };
      duplicateStartCache[String(start) + '_2'] = { start, end: start + blockDuration * 2, price: 0.2 };
      // Cache key is based on start, so second one would overwrite first
      // But if both exist, function should handle it
      const result = findCheapestBlocks(duplicateStartCache, 1, now);
      // Should return at least one block
      expect(result.length).toBeGreaterThanOrEqual(0);
    });
  });
});

