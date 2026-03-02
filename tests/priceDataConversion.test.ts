import type { PriceBlock, PriceCache } from '../logic/lowPrice/types';
import type { PriceDataEntry } from '../logic/lowPrice/priceSource';
import { getUTCDayKey } from '../logic/utils/dateUtils';

/**
 * Convert PriceDataEntry array to day-based PriceCache (mirrors fetchAndUpdatePrices)
 */
function convertPriceDataToCache(priceData: Array<PriceDataEntry>): PriceCache {
  const cache: PriceCache = {};
  const blockDurationMs = 15 * 60 * 1000;

  for (const entry of priceData) {
    const startTimestamp = new Date(entry.date).getTime();
    const endTimestamp = startTimestamp + blockDurationMs;
    const dayKey = getUTCDayKey(startTimestamp);
    if (!cache[dayKey]) cache[dayKey] = [];
    cache[dayKey].push({ start: startTimestamp, end: endTimestamp, price: entry.price });
  }
  for (const key of Object.keys(cache)) {
    cache[key].sort((a, b) => a.start - b.start);
  }
  return cache;
}

/**
 * Update day-based cache with new price data (replace whole days that have new data)
 */
function updatePriceCache(
  cache: PriceCache,
  priceData: Array<PriceDataEntry>
): { cache: PriceCache; stats: { newBlocks: number; updatedBlocks: number; priceChanges: number } } {
  const blockDurationMs = 15 * 60 * 1000;
  let newBlocks = 0;
  let updatedBlocks = 0;
  let priceChanges = 0;
  const blocksByDay: Record<string, PriceBlock[]> = {};

  for (const entry of priceData) {
    const startTimestamp = new Date(entry.date).getTime();
    const endTimestamp = startTimestamp + blockDurationMs;
    const dayKey = getUTCDayKey(startTimestamp);
    if (!blocksByDay[dayKey]) blocksByDay[dayKey] = [];
    const existing = (cache[dayKey] || []).find((b) => b.start === startTimestamp);
    if (existing) {
      updatedBlocks++;
      if (existing.price !== entry.price) priceChanges++;
    } else {
      newBlocks++;
    }
    const idx = (cache[dayKey] || []).findIndex((b) => b.start === startTimestamp);
    const dayBlocks = [...(cache[dayKey] || [])];
    const block = { start: startTimestamp, end: endTimestamp, price: entry.price };
    if (idx >= 0) dayBlocks[idx] = block;
    else dayBlocks.push(block);
    dayBlocks.sort((a, b) => a.start - b.start);
    cache[dayKey] = dayBlocks;
  }

  return { cache, stats: { newBlocks, updatedBlocks, priceChanges } };
}

describe('Price Data Conversion', () => {
  describe('convertPriceDataToCache', () => {
    test('converts single price entry to cache block', () => {
      const priceData: Array<PriceDataEntry> = [
        { date: '2025-01-01T10:00:00Z', price: 0.15 },
      ];

      const cache = convertPriceDataToCache(priceData);

      expect(Object.keys(cache)).toHaveLength(1);
      const dayKey = Object.keys(cache)[0];
      expect(cache[dayKey]).toHaveLength(1);
      const block = cache[dayKey][0];
      expect(block.start).toBe(new Date('2025-01-01T10:00:00Z').getTime());
      expect(block.end).toBe(block.start + 15 * 60 * 1000);
      expect(block.price).toBe(0.15);
    });

    test('converts multiple price entries to cache blocks', () => {
      const priceData: Array<PriceDataEntry> = [
        { date: '2025-01-01T10:00:00Z', price: 0.15 },
        { date: '2025-01-01T10:15:00Z', price: 0.20 },
        { date: '2025-01-01T10:30:00Z', price: 0.18 },
      ];

      const cache = convertPriceDataToCache(priceData);

      expect(Object.keys(cache)).toHaveLength(1);
      const blocks = cache['2025-01-01'];
      expect(blocks).toHaveLength(3);
      expect(blocks[0].price).toBe(0.15);
      expect(blocks[1].price).toBe(0.20);
      expect(blocks[2].price).toBe(0.18);
    });

    test('creates blocks with correct 15-minute duration', () => {
      const priceData: Array<PriceDataEntry> = [
        { date: '2025-01-01T10:00:00Z', price: 0.15 },
      ];

      const cache = convertPriceDataToCache(priceData);
      const dayKey = Object.keys(cache)[0];
      const block = cache[dayKey][0];
      expect(block.end - block.start).toBe(15 * 60 * 1000);
    });

    test('handles empty price data array', () => {
      const priceData: Array<PriceDataEntry> = [];
      const cache = convertPriceDataToCache(priceData);
      expect(Object.keys(cache)).toHaveLength(0);
    });

    test('handles entries with different timezones in ISO strings', () => {
      const priceData: Array<PriceDataEntry> = [
        { date: '2025-01-01T10:00:00+01:00', price: 0.15 },
        { date: '2025-01-01T11:00:00Z', price: 0.20 },
      ];

      const cache = convertPriceDataToCache(priceData);
      expect(Object.keys(cache)).toHaveLength(1);
      expect(cache['2025-01-01']).toHaveLength(2);
    });

    test('handles negative prices', () => {
      const priceData: Array<PriceDataEntry> = [
        { date: '2025-01-01T10:00:00Z', price: -0.05 },
      ];

      const cache = convertPriceDataToCache(priceData);
      const block = cache['2025-01-01'][0];
      expect(block.price).toBe(-0.05);
    });

    test('handles very large prices', () => {
      const priceData: Array<PriceDataEntry> = [
        { date: '2025-01-01T10:00:00Z', price: 1000.0 },
      ];

      const cache = convertPriceDataToCache(priceData);
      const block = cache['2025-01-01'][0];
      expect(block.price).toBe(1000.0);
    });
  });

  describe('updatePriceCache', () => {
    test('adds new blocks to empty cache', () => {
      const cache: PriceCache = {};
      const priceData: Array<PriceDataEntry> = [
        { date: '2025-01-01T10:00:00Z', price: 0.15 },
        { date: '2025-01-01T10:15:00Z', price: 0.20 },
      ];

      const result = updatePriceCache(cache, priceData);

      expect(result.stats.newBlocks).toBe(2);
      expect(result.stats.updatedBlocks).toBe(0);
      expect(result.stats.priceChanges).toBe(0);
      expect(Object.keys(result.cache)).toHaveLength(1);
      expect(result.cache['2025-01-01']).toHaveLength(2);
    });

    test('updates existing blocks with same price', () => {
      const existingTimestamp = new Date('2025-01-01T10:00:00Z').getTime();
      const cache: PriceCache = {
        '2025-01-01': [{
          start: existingTimestamp,
          end: existingTimestamp + 15 * 60 * 1000,
          price: 0.15,
        }],
      };
      const priceData: Array<PriceDataEntry> = [
        { date: '2025-01-01T10:00:00Z', price: 0.15 },
      ];

      const result = updatePriceCache(cache, priceData);

      expect(result.stats.newBlocks).toBe(0);
      expect(result.stats.updatedBlocks).toBe(1);
      expect(result.stats.priceChanges).toBe(0);
    });

    test('updates existing blocks with different price', () => {
      const existingTimestamp = new Date('2025-01-01T10:00:00Z').getTime();
      const cache: PriceCache = {
        '2025-01-01': [{
          start: existingTimestamp,
          end: existingTimestamp + 15 * 60 * 1000,
          price: 0.15,
        }],
      };
      const priceData: Array<PriceDataEntry> = [
        { date: '2025-01-01T10:00:00Z', price: 0.20 },
      ];

      const result = updatePriceCache(cache, priceData);

      expect(result.stats.newBlocks).toBe(0);
      expect(result.stats.updatedBlocks).toBe(1);
      expect(result.stats.priceChanges).toBe(1);
      expect(result.cache['2025-01-01'][0].price).toBe(0.20);
    });

    test('handles mix of new and updated blocks', () => {
      const existingTimestamp = new Date('2025-01-01T10:00:00Z').getTime();
      const cache: PriceCache = {
        '2025-01-01': [{
          start: existingTimestamp,
          end: existingTimestamp + 15 * 60 * 1000,
          price: 0.15,
        }],
      };
      const priceData: Array<PriceDataEntry> = [
        { date: '2025-01-01T10:00:00Z', price: 0.20 },
        { date: '2025-01-01T10:15:00Z', price: 0.25 },
      ];

      const result = updatePriceCache(cache, priceData);

      expect(result.stats.newBlocks).toBe(1);
      expect(result.stats.updatedBlocks).toBe(1);
      expect(result.stats.priceChanges).toBe(1);
      expect(Object.keys(result.cache)).toHaveLength(1);
      expect(result.cache['2025-01-01']).toHaveLength(2);
    });

    test('handles multiple price changes', () => {
      const timestamp1 = new Date('2025-01-01T10:00:00Z').getTime();
      const timestamp2 = new Date('2025-01-01T10:15:00Z').getTime();
      const cache: PriceCache = {
        '2025-01-01': [
          { start: timestamp1, end: timestamp1 + 15 * 60 * 1000, price: 0.15 },
          { start: timestamp2, end: timestamp2 + 15 * 60 * 1000, price: 0.20 },
        ],
      };
      const priceData: Array<PriceDataEntry> = [
        { date: '2025-01-01T10:00:00Z', price: 0.18 },
        { date: '2025-01-01T10:15:00Z', price: 0.22 },
      ];

      const result = updatePriceCache(cache, priceData);

      expect(result.stats.priceChanges).toBe(2);
      expect(result.cache['2025-01-01'][0].price).toBe(0.18);
      expect(result.cache['2025-01-01'][1].price).toBe(0.22);
    });

    test('handles empty price data on existing cache', () => {
      const existingTimestamp = new Date('2025-01-01T10:00:00Z').getTime();
      const cache: PriceCache = {
        '2025-01-01': [{
          start: existingTimestamp,
          end: existingTimestamp + 15 * 60 * 1000,
          price: 0.15,
        }],
      };
      const priceData: Array<PriceDataEntry> = [];

      const result = updatePriceCache(cache, priceData);

      expect(result.stats.newBlocks).toBe(0);
      expect(result.stats.updatedBlocks).toBe(0);
      expect(result.stats.priceChanges).toBe(0);
      // Cache should remain unchanged
      expect(Object.keys(result.cache)).toHaveLength(1);
    });
  });
});

