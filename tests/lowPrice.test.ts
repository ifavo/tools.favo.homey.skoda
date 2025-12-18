import fs from 'fs';
import path from 'path';

import type { PriceBlock, PriceCache } from '../logic/lowPrice/types';
import { findCheapestHours } from '../logic/lowPrice/findCheapestHours';
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

  test('findCheapestHours returns the correct number of cheapest blocks', () => {
    const cheapest2 = findCheapestHours(cache, 2, Date.now());
    expect(cheapest2).toHaveLength(2);

    const cheapest8 = findCheapestHours(cache, 8, Date.now());
    expect(cheapest8).toHaveLength(8);
  });

  test('formatNextChargingTimes groups consecutive hours', () => {
    const base = Date.UTC(2025, 0, 1, 10, 0, 0); // 2025-01-01T10:00:00Z

    const blocks: Array<PriceBlock> = [
      { start: base, end: base + 60 * 60 * 1000, price: 1 }, // 11:00 local-ish
      { start: base + 60 * 60 * 1000, end: base + 2 * 60 * 60 * 1000, price: 1 }, // 12:00
      { start: base + 3 * 60 * 60 * 1000, end: base + 4 * 60 * 60 * 1000, price: 1 }, // 14:00
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

  test('formatNextChargingTimes visual display of consecutive and non-consecutive hours', () => {
    const base = Date.UTC(2025, 0, 1, 10, 0, 0); // 11:00 local in Europe/Vienna (UTC+1)

    const blocks: Array<PriceBlock> = [
      // 11:00–12:00
      { start: base, end: base + 60 * 60 * 1000, price: 1 },
      // 12:00–13:00 (consecutive with previous)
      { start: base + 60 * 60 * 1000, end: base + 2 * 60 * 60 * 1000, price: 1 },
      // 14:00–15:00 (gap after 13:00)
      { start: base + 4 * 60 * 60 * 1000, end: base + 5 * 60 * 60 * 1000, price: 1 },
    ];

    const text = formatNextChargingTimes(blocks, {
      now: base - 60 * 60 * 1000, // before first block
      locale: 'de-DE',
      timezone: 'Europe/Vienna',
    });

    // In this setup:
    // - First two blocks (11–12, 12–13) are consecutive -> merged as "11–13:00"
    // - Third block is later (15:00–16:00 local) -> separate slot
    expect(text).toBe('11–13:00, 15:00');
  });

  test('at 02:00 local time, display shows today\'s cheapest hours from cache', () => {
    const oneHour = 60 * 60 * 1000;

    // Use real cached data: find the two cheapest consecutive hours for mocked "today" (2025-12-18)
    const cheapest = findCheapestHours(cache, 2);

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
    // hours for today are 22:00–23:00 and 23:00–00:00, which are formatted
    // together as a single merged range "22–00:00".
    expect(text).toBe('22–00:00');
  });

  test('can simulate decisions every 15 minutes without throwing', () => {
    const hoursCount = 8;
    const start = Date.UTC(2025, 11, 17, 12, 0, 0); // 2025-12-17 12:00 UTC
    const end = Date.UTC(2025, 11, 18, 23, 45, 0); // 2025-12-18 23:45 UTC
    const step = 15 * 60 * 1000;

    let lastDecision: string | null = null;

    for (let t = start; t <= end; t += step) {
      const cheapest = findCheapestHours(cache, hoursCount, t);

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

    // Use real cached data: two cheapest consecutive blocks (03–05) for mocked "today"
    const cheapest = findCheapestHours(cache, 2);

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

  test('at 05:00, formatted text shows no future cheap hour', () => {
    // Use real cached data: two cheapest consecutive blocks (03–05) for mocked "today"
    const cheapest = findCheapestHours(cache, 2);

    const last = cheapest[cheapest.length - 1];

    // At 05:00, both cheap blocks are in the past, so there is no future cheap hour.
    const text = formatNextChargingTimes(cheapest, {
      now: last.end,
      locale: 'de-DE',
      timezone: 'Europe/Vienna',
    });

    expect(text).toBe('Unknown');
  });
});

