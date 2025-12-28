import type { PriceBlock, PriceCache } from '../logic/lowPrice/types';
import { getUTCDate, getTodayUTCDate, getTomorrowUTCDate } from '../logic/utils/dateUtils';

/**
 * Helper function to find cheapest blocks with today/tomorrow logic (matching device.ts)
 */
function findCheapestBlocksWithTodayTomorrow(
  cache: PriceCache,
  count: number,
  now: number = Date.now(),
): Array<PriceBlock> {
  const todayUTC = getTodayUTCDate(now);
  const tomorrowUTC = getTomorrowUTCDate(now);

  // Filter relevant blocks (today and tomorrow)
  const relevantBlocks = Object.values(cache).filter((b: PriceBlock) => {
    const d = getUTCDate(b.start);
    return d === todayUTC || d === tomorrowUTC;
  }) as Array<PriceBlock>;

  if (relevantBlocks.length === 0 || count <= 0) {
    return [];
  }

  // Step 1: Find cheapest blocks for TODAY (including past ones)
  const todayBlocks = relevantBlocks.filter((b: PriceBlock) => {
    const d = getUTCDate(b.start);
    return d === todayUTC;
  });
  const sortedTodayByPrice = [...todayBlocks].sort((a, b) => a.price - b.price);
  const cheapestToday = sortedTodayByPrice.slice(0, count);

  // Filter to only future blocks from today's cheapest
  let cheapest = cheapestToday.filter((b) => b.start > now);

  // Step 2: If no future blocks from today, find cheapest blocks for TOMORROW
  if (cheapest.length === 0) {
    const tomorrowBlocks = relevantBlocks.filter((b: PriceBlock) => {
      const d = getUTCDate(b.start);
      return d === tomorrowUTC && b.start > now;
    });
    const sortedTomorrowByPrice = [...tomorrowBlocks].sort((a, b) => a.price - b.price);
    cheapest = sortedTomorrowByPrice.slice(0, count);
  }

  // Sort result by time for consistent ordering
  cheapest.sort((a, b) => a.start - b.start);

  return cheapest;
}

describe('block identification (today vs tomorrow, future vs past)', () => {
  // Create test cache with blocks spanning today and tomorrow
  function createTestCache(now: number): PriceCache {
    const today = new Date(now);
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const blockDuration = 15 * 60 * 1000; // 15 minutes
    const cache: PriceCache = {};

    // Add blocks for today (some past, some future)
    for (let i = 0; i < 96; i++) {
      const start = today.getTime() + i * blockDuration;
      const end = start + blockDuration;
      const price = 0.10 + (i % 10) * 0.01; // Varying prices
      cache[String(start)] = { start, end, price };
    }

    // Add blocks for tomorrow
    for (let i = 0; i < 96; i++) {
      const start = tomorrow.getTime() + i * blockDuration;
      const end = start + blockDuration;
      const price = 0.05 + (i % 10) * 0.01; // Cheaper prices for tomorrow
      cache[String(start)] = { start, end, price };
    }

    return cache;
  }

  test('finds cheapest blocks from today when future blocks available', () => {
    const now = Date.UTC(2025, 11, 18, 12, 0, 0); // 2025-12-18 12:00 UTC
    const cache = createTestCache(now);

    const cheapest = findCheapestBlocksWithTodayTomorrow(cache, 8, now);

    // Should find blocks from today (future blocks)
    expect(cheapest.length).toBeGreaterThan(0);
    const firstBlock = cheapest[0];
    const todayUTC = getTodayUTCDate(now);
    expect(getUTCDate(firstBlock.start)).toBe(todayUTC);
    expect(firstBlock.start).toBeGreaterThan(now); // All should be future
  });

  test('finds cheapest blocks from tomorrow when all today blocks are in past', () => {
    // Set time to end of day (23:45)
    const now = Date.UTC(2025, 11, 18, 23, 45, 0); // 2025-12-18 23:45 UTC
    const cache = createTestCache(now);

    const cheapest = findCheapestBlocksWithTodayTomorrow(cache, 8, now);

    // Should find blocks from tomorrow since all today blocks are in past
    expect(cheapest.length).toBeGreaterThan(0);
    const firstBlock = cheapest[0];
    const tomorrowUTC = getTomorrowUTCDate(now);
    expect(getUTCDate(firstBlock.start)).toBe(tomorrowUTC);
    expect(firstBlock.start).toBeGreaterThan(now); // All should be future
  });

  test('only returns future blocks', () => {
    const now = Date.UTC(2025, 11, 18, 12, 0, 0); // 2025-12-18 12:00 UTC
    const cache = createTestCache(now);

    const cheapest = findCheapestBlocksWithTodayTomorrow(cache, 8, now);

    // All returned blocks should be in the future
    expect(cheapest.every((b) => b.start > now)).toBe(true);
  });

  test('sorts blocks by time after selecting by price', () => {
    const now = Date.UTC(2025, 11, 18, 12, 0, 0); // 2025-12-18 12:00 UTC
    const cache = createTestCache(now);

    const cheapest = findCheapestBlocksWithTodayTomorrow(cache, 8, now);

    // Blocks should be sorted by time (ascending)
    for (let i = 1; i < cheapest.length; i++) {
      expect(cheapest[i].start).toBeGreaterThan(cheapest[i - 1].start);
    }
  });

  test('returns empty array when no relevant blocks available', () => {
    const now = Date.UTC(2025, 11, 18, 12, 0, 0);
    const cache: PriceCache = {}; // Empty cache

    const cheapest = findCheapestBlocksWithTodayTomorrow(cache, 8, now);
    expect(cheapest).toHaveLength(0);
  });

  test('returns fewer blocks when not enough future blocks available', () => {
    const now = Date.UTC(2025, 11, 18, 23, 30, 0); // Near end of day
    const cache = createTestCache(now);

    // Request 8 blocks but only 2 future blocks available from today
    const cheapest = findCheapestBlocksWithTodayTomorrow(cache, 8, now);

    // Should return available future blocks (from tomorrow)
    expect(cheapest.length).toBeGreaterThan(0);
    expect(cheapest.length).toBeLessThanOrEqual(8);
    expect(cheapest.every((b) => b.start > now)).toBe(true);
  });
});

