import type { PriceBlock, PriceCache } from '../logic/lowPrice/types';
import type { PriceDataEntry } from '../logic/lowPrice/priceSource';

/**
 * Convert PriceDataEntry array to PriceCache
 * This mirrors the logic from device.ts fetchAndUpdatePrices
 */
function convertPriceDataToCache(priceData: Array<PriceDataEntry>): PriceCache {
  const cache: PriceCache = {};
  const blockDurationMs = 15 * 60 * 1000; // 15 minutes in milliseconds

  for (const entry of priceData) {
    const startTimestamp = new Date(entry.date).getTime();
    const endTimestamp = startTimestamp + blockDurationMs;

    cache[String(startTimestamp)] = {
      start: startTimestamp,
      end: endTimestamp,
      price: entry.price,
    };
  }

  return cache;
}

/**
 * Update cache with new price data, tracking statistics
 */
function updatePriceCache(
  cache: PriceCache,
  priceData: Array<PriceDataEntry>
): { cache: PriceCache; stats: { newBlocks: number; updatedBlocks: number; priceChanges: number } } {
  const blockDurationMs = 15 * 60 * 1000;
  let newBlocks = 0;
  let updatedBlocks = 0;
  let priceChanges = 0;

  for (const entry of priceData) {
    const startTimestamp = new Date(entry.date).getTime();
    const endTimestamp = startTimestamp + blockDurationMs;

    const existingBlock = cache[String(startTimestamp)];
    const isUpdate = existingBlock !== undefined;

    cache[String(startTimestamp)] = {
      start: startTimestamp,
      end: endTimestamp,
      price: entry.price,
    };

    if (isUpdate) {
      updatedBlocks++;
      if (existingBlock.price !== entry.price) {
        priceChanges++;
      }
    } else {
      newBlocks++;
    }
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
      const block = Object.values(cache)[0];
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

      expect(Object.keys(cache)).toHaveLength(3);
      const blocks = Object.values(cache).sort((a, b) => a.start - b.start);
      expect(blocks[0].price).toBe(0.15);
      expect(blocks[1].price).toBe(0.20);
      expect(blocks[2].price).toBe(0.18);
    });

    test('creates blocks with correct 15-minute duration', () => {
      const priceData: Array<PriceDataEntry> = [
        { date: '2025-01-01T10:00:00Z', price: 0.15 },
      ];

      const cache = convertPriceDataToCache(priceData);
      const block = Object.values(cache)[0];

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
      expect(Object.keys(cache)).toHaveLength(2);
    });

    test('handles negative prices', () => {
      const priceData: Array<PriceDataEntry> = [
        { date: '2025-01-01T10:00:00Z', price: -0.05 },
      ];

      const cache = convertPriceDataToCache(priceData);
      const block = Object.values(cache)[0];
      expect(block.price).toBe(-0.05);
    });

    test('handles very large prices', () => {
      const priceData: Array<PriceDataEntry> = [
        { date: '2025-01-01T10:00:00Z', price: 1000.0 },
      ];

      const cache = convertPriceDataToCache(priceData);
      const block = Object.values(cache)[0];
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
      expect(Object.keys(result.cache)).toHaveLength(2);
    });

    test('updates existing blocks with same price', () => {
      const existingTimestamp = new Date('2025-01-01T10:00:00Z').getTime();
      const cache: PriceCache = {
        [String(existingTimestamp)]: {
          start: existingTimestamp,
          end: existingTimestamp + 15 * 60 * 1000,
          price: 0.15,
        },
      };
      const priceData: Array<PriceDataEntry> = [
        { date: '2025-01-01T10:00:00Z', price: 0.15 }, // Same price
      ];

      const result = updatePriceCache(cache, priceData);

      expect(result.stats.newBlocks).toBe(0);
      expect(result.stats.updatedBlocks).toBe(1);
      expect(result.stats.priceChanges).toBe(0);
    });

    test('updates existing blocks with different price', () => {
      const existingTimestamp = new Date('2025-01-01T10:00:00Z').getTime();
      const cache: PriceCache = {
        [String(existingTimestamp)]: {
          start: existingTimestamp,
          end: existingTimestamp + 15 * 60 * 1000,
          price: 0.15,
        },
      };
      const priceData: Array<PriceDataEntry> = [
        { date: '2025-01-01T10:00:00Z', price: 0.20 }, // Different price
      ];

      const result = updatePriceCache(cache, priceData);

      expect(result.stats.newBlocks).toBe(0);
      expect(result.stats.updatedBlocks).toBe(1);
      expect(result.stats.priceChanges).toBe(1);
      expect(result.cache[String(existingTimestamp)].price).toBe(0.20);
    });

    test('handles mix of new and updated blocks', () => {
      const existingTimestamp = new Date('2025-01-01T10:00:00Z').getTime();
      const cache: PriceCache = {
        [String(existingTimestamp)]: {
          start: existingTimestamp,
          end: existingTimestamp + 15 * 60 * 1000,
          price: 0.15,
        },
      };
      const priceData: Array<PriceDataEntry> = [
        { date: '2025-01-01T10:00:00Z', price: 0.20 }, // Update existing
        { date: '2025-01-01T10:15:00Z', price: 0.25 }, // New block
      ];

      const result = updatePriceCache(cache, priceData);

      expect(result.stats.newBlocks).toBe(1);
      expect(result.stats.updatedBlocks).toBe(1);
      expect(result.stats.priceChanges).toBe(1);
      expect(Object.keys(result.cache)).toHaveLength(2);
    });

    test('handles multiple price changes', () => {
      const timestamp1 = new Date('2025-01-01T10:00:00Z').getTime();
      const timestamp2 = new Date('2025-01-01T10:15:00Z').getTime();
      const cache: PriceCache = {
        [String(timestamp1)]: { start: timestamp1, end: timestamp1 + 15 * 60 * 1000, price: 0.15 },
        [String(timestamp2)]: { start: timestamp2, end: timestamp2 + 15 * 60 * 1000, price: 0.20 },
      };
      const priceData: Array<PriceDataEntry> = [
        { date: '2025-01-01T10:00:00Z', price: 0.18 }, // Changed
        { date: '2025-01-01T10:15:00Z', price: 0.22 }, // Changed
      ];

      const result = updatePriceCache(cache, priceData);

      expect(result.stats.priceChanges).toBe(2);
      expect(result.cache[String(timestamp1)].price).toBe(0.18);
      expect(result.cache[String(timestamp2)].price).toBe(0.22);
    });

    test('handles empty price data on existing cache', () => {
      const existingTimestamp = new Date('2025-01-01T10:00:00Z').getTime();
      const cache: PriceCache = {
        [String(existingTimestamp)]: {
          start: existingTimestamp,
          end: existingTimestamp + 15 * 60 * 1000,
          price: 0.15,
        },
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

