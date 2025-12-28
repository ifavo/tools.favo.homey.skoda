import fs from 'fs';
import path from 'path';

import type { PriceBlock, PriceCache } from '../logic/lowPrice/types';
import { findCheapestBlocks } from '../logic/lowPrice/findCheapestHours';
import { formatNextChargingTimes } from '../logic/lowPrice/formatNextChargingTimes';
import { decideLowPriceCharging } from '../logic/lowPrice/decideLowPriceCharging';

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

describe('low price charging logic', () => {
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

  test('findCheapestBlocks returns the correct number of cheapest blocks', () => {
    const cheapest2 = findCheapestBlocks(cache, 2, Date.now());
    expect(cheapest2).toHaveLength(2);

    const cheapest8 = findCheapestBlocks(cache, 8, Date.now());
    expect(cheapest8).toHaveLength(8);
  });

  test('formatNextChargingTimes groups consecutive blocks', () => {
    const base = Date.UTC(2025, 0, 1, 10, 0, 0); // 2025-01-01T10:00:00Z
    const blockDuration = 15 * 60 * 1000; // 15 minutes

    const blocks: Array<PriceBlock> = [
      { start: base, end: base + blockDuration, price: 1 }, // 11:00 local-ish
      { start: base + blockDuration, end: base + 2 * blockDuration, price: 1 }, // 11:15
      { start: base + 4 * blockDuration, end: base + 5 * blockDuration, price: 1 }, // 11:45
    ];

    const text = formatNextChargingTimes(blocks, {
      now: base - 60 * 60 * 1000,
      locale: 'en-GB',
      timezone: 'Europe/Vienna',
    });

    // We do not assert exact localized string (depends on environment),
    // but we do expect two segments separated by comma
    expect(text.split(',').length).toBe(2);
  });

  test('formatNextChargingTimes visual display of consecutive and non-consecutive blocks', () => {
    const base = Date.UTC(2025, 0, 1, 10, 0, 0); // 11:00 local in Europe/Vienna (UTC+1)
    const blockDuration = 15 * 60 * 1000; // 15 minutes

    const blocks: Array<PriceBlock> = [
      // 11:00–11:15
      { start: base, end: base + blockDuration, price: 1 },
      // 11:15–11:30 (consecutive with previous)
      { start: base + blockDuration, end: base + 2 * blockDuration, price: 1 },
      // 11:45–12:00 (gap after 11:30)
      { start: base + 3 * blockDuration, end: base + 4 * blockDuration, price: 1 },
    ];

    const text = formatNextChargingTimes(blocks, {
      now: base - 60 * 60 * 1000, // before first block
      locale: 'de-DE',
      timezone: 'Europe/Vienna',
    });

    // In this setup:
    // - First two blocks (11:00–11:15, 11:15–11:30) are consecutive -> merged as "11:00–11:30"
    // - Third block is later (11:45–12:00 local) -> separate slot
    expect(text).toContain('11:00');
    expect(text).toContain('11:30');
    expect(text.split(',').length).toBe(2);
  });

  test('at 02:00 local time, display shows today\'s cheapest blocks from cache', () => {
    const oneHour = 60 * 60 * 1000;

    // Use real cached data: find the two cheapest consecutive blocks for mocked "today" (2025-12-18)
    const cheapest = findCheapestBlocks(cache, 2);

    // First cheapest block starts at 03:00 local in this dataset (per observed data)
    const first = cheapest[0];

    // Treat one hour before the first cheap block as "02:00"
    const now = first.start - oneHour;

    const text = formatNextChargingTimes(cheapest, {
      now,
      locale: 'de-DE',
      timezone: 'Europe/Vienna',
    });

    // For this recorded cache and mocked date (2025-12-18), the two cheapest
    // blocks for today should be formatted appropriately
    expect(text).not.toBe('Unknown');
  });

  test('can simulate decisions every 15 minutes without throwing', () => {
    const blocksCount = 8;
    const start = Date.UTC(2025, 11, 17, 12, 0, 0); // 2025-12-17 12:00 UTC
    const end = Date.UTC(2025, 11, 18, 23, 45, 0); // 2025-12-18 23:45 UTC
    const step = 15 * 60 * 1000;

    let lastDecision: string | null = null;

    for (let t = start; t <= end; t += step) {
      const cheapest = findCheapestBlocks(cache, blocksCount, t);

      const decision = decideLowPriceCharging(cheapest, t, {
        enableLowPrice: true,
        batteryLevel: 80,
        lowBatteryThreshold: 40,
        manualOverrideActive: false,
        wasOnDueToPrice: lastDecision === 'turnOn',
      });

      // Keep track of last decision so we can feed "wasOnDueToPrice"
      if (decision === 'turnOn' || decision === 'turnOff') {
        lastDecision = decision;
      }
    }

    // If we reach here, the simulation ran without errors
    expect(true).toBe(true);
  });

  test('decisions around 03–05 cheap interval', () => {
    const fifteenMinutes = 15 * 60 * 1000;

    // Use real cached data: two cheapest consecutive blocks for mocked "today"
    const cheapest = findCheapestBlocks(cache, 2);

    const first = cheapest[0];  // 03–04
    const second = cheapest[1]; // 04–05

    const ctxBase = {
      enableLowPrice: true,
      batteryLevel: 80,
      lowBatteryThreshold: 40,
      manualOverrideActive: false,
    };

    let wasOnDueToPrice = false;

    function decideAt(time: number) {
      const decision = decideLowPriceCharging(cheapest, time, {
        ...ctxBase,
        wasOnDueToPrice,
      });

      if (decision === 'turnOn') {
        wasOnDueToPrice = true;
      } else if (decision === 'turnOff') {
        wasOnDueToPrice = false;
      }

      return decision;
    }

    // 03:00 -> turn on
    expect(decideAt(first.start)).toBe('turnOn');

    // 03:15 -> still cheap, stays on
    expect(decideAt(first.start + fifteenMinutes)).toBe('turnOn');

    // 04:00 -> still cheap, stays on (second block start)
    expect(decideAt(second.start)).toBe('turnOn');

    // 04:45 -> still cheap, stays on
    expect(decideAt(second.start + 3 * fifteenMinutes)).toBe('turnOn');

    // 05:00 -> cheap period ended, should turn off (since it was on due to price)
    expect(decideAt(second.end)).toBe('turnOff');
  });

  test('at 05:00, formatted text shows no future cheap block', () => {
    // Use real cached data: two cheapest consecutive blocks for mocked "today"
    const cheapest = findCheapestBlocks(cache, 2);

    const last = cheapest[cheapest.length - 1];

    // At 05:00, both cheap blocks are in the past, so there is no future cheap block.
    const text = formatNextChargingTimes(cheapest, {
      now: last.end,
      locale: 'de-DE',
      timezone: 'Europe/Vienna',
    });

    expect(text).toBe('Unknown');
  });
});

/**
 * Helper function to find cheapest blocks with today/tomorrow logic (matching device.ts)
 */
function findCheapestBlocksWithTodayTomorrow(
  cache: PriceCache,
  count: number,
  now: number = Date.now(),
): Array<PriceBlock> {
  const todayUTC = new Date(now).getUTCDate();
  const tomorrowUTC = new Date(now + 86400000).getUTCDate();

  // Filter relevant blocks (today and tomorrow)
  const relevantBlocks = Object.values(cache).filter((b: PriceBlock) => {
    const d = new Date(b.start).getUTCDate();
    return d === todayUTC || d === tomorrowUTC;
  }) as Array<PriceBlock>;

  if (relevantBlocks.length === 0 || count <= 0) {
    return [];
  }

  // Step 1: Find cheapest blocks for TODAY (including past ones)
  const todayBlocks = relevantBlocks.filter((b: PriceBlock) => {
    const d = new Date(b.start).getUTCDate();
    return d === todayUTC;
  });
  const sortedTodayByPrice = [...todayBlocks].sort((a, b) => a.price - b.price);
  const cheapestToday = sortedTodayByPrice.slice(0, count);

  // Filter to only future blocks from today's cheapest
  let cheapest = cheapestToday.filter((b) => b.start > now);

  // Step 2: If no future blocks from today, find cheapest blocks for TOMORROW
  if (cheapest.length === 0) {
    const tomorrowBlocks = relevantBlocks.filter((b: PriceBlock) => {
      const d = new Date(b.start).getUTCDate();
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
    const blockDate = new Date(firstBlock.start);
    const todayUTC = new Date(now).getUTCDate();
    expect(blockDate.getUTCDate()).toBe(todayUTC);
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
    const blockDate = new Date(firstBlock.start);
    const tomorrowUTC = new Date(now + 86400000).getUTCDate();
    expect(blockDate.getUTCDate()).toBe(tomorrowUTC);
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

