import fs from 'fs';
import path from 'path';

import type { PriceBlock, PriceCache } from '../logic/lowPrice/types';
import { findCheapestBlocks } from '../logic/lowPrice/findCheapestHours';
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

describe('decideLowPriceCharging', () => {
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
  });

  describe('edge cases - feature control', () => {
    test('returns noChange when enableLowPrice is false', () => {
      const block = { start: Date.now() - 1000, end: Date.now() + 1000, price: 0.1 };
      const decision = decideLowPriceCharging([block], Date.now(), {
        enableLowPrice: false, // Feature disabled
        batteryLevel: 50,
        lowBatteryThreshold: 40,
        manualOverrideActive: false,
        wasOnDueToPrice: false,
      });
      // Should return noChange when feature is disabled
      expect(decision).toBe('noChange');
    });

    test('returns noChange when manualOverrideActive is true', () => {
      const block = { start: Date.now() - 1000, end: Date.now() + 1000, price: 0.1 };
      const decision = decideLowPriceCharging([block], Date.now(), {
        enableLowPrice: true,
        batteryLevel: 50,
        lowBatteryThreshold: 40,
        manualOverrideActive: true, // Manual override active
        wasOnDueToPrice: false,
      });
      // Should return noChange when manual override is active
      expect(decision).toBe('noChange');
    });
  });

  describe('edge cases - battery level handling', () => {
    test('handles null batteryLevel when threshold is set', () => {
      const block = { start: Date.now() - 1000, end: Date.now() + 1000, price: 0.1 };
      const decision = decideLowPriceCharging([block], Date.now(), {
        enableLowPrice: true,
        batteryLevel: null,
        lowBatteryThreshold: 40,
        manualOverrideActive: false,
        wasOnDueToPrice: false,
      });
      // Should allow low price charging when battery level is unknown
      expect(decision).toBe('turnOn');
    });

    test('handles batteryLevel exactly at threshold', () => {
      const block = { start: Date.now() - 1000, end: Date.now() + 1000, price: 0.1 };
      const decision = decideLowPriceCharging([block], Date.now(), {
        enableLowPrice: true,
        batteryLevel: 40,
        lowBatteryThreshold: 40,
        manualOverrideActive: false,
        wasOnDueToPrice: false,
      });
      // Battery at threshold (not below), so should allow low price charging
      expect(decision).toBe('turnOn');
    });

    test('handles zero lowBatteryThreshold', () => {
      const block = { start: Date.now() - 1000, end: Date.now() + 1000, price: 0.1 };
      const decision = decideLowPriceCharging([block], Date.now(), {
        enableLowPrice: true,
        batteryLevel: 10,
        lowBatteryThreshold: 0,
        manualOverrideActive: false,
        wasOnDueToPrice: false,
      });
      // Threshold is 0, so lowBatteryThreshold > 0 check fails, should allow charging
      expect(decision).toBe('turnOn');
    });

    test('handles negative batteryLevel', () => {
      const block = { start: Date.now() - 1000, end: Date.now() + 1000, price: 0.1 };
      const decision = decideLowPriceCharging([block], Date.now(), {
        enableLowPrice: true,
        batteryLevel: -10, // Invalid but test robustness
        lowBatteryThreshold: 40,
        manualOverrideActive: false,
        wasOnDueToPrice: false,
      });
      // Should still work (batteryLevel < lowBatteryThreshold, so noChange)
      expect(decision).toBe('noChange');
    });

    test('handles very high batteryLevel', () => {
      const block = { start: Date.now() - 1000, end: Date.now() + 1000, price: 0.1 };
      const decision = decideLowPriceCharging([block], Date.now(), {
        enableLowPrice: true,
        batteryLevel: 150, // Over 100%, invalid but test robustness
        lowBatteryThreshold: 40,
        manualOverrideActive: false,
        wasOnDueToPrice: false,
      });
      // Should allow charging since batteryLevel >= threshold
      expect(decision).toBe('turnOn');
    });
  });

  describe('edge cases - time boundaries', () => {
    test('handles exact block boundaries', () => {
      const block = { start: 1000, end: 2000, price: 0.1 };
      const ctx = {
        enableLowPrice: true,
        batteryLevel: 50,
        lowBatteryThreshold: 40,
        manualOverrideActive: false,
        wasOnDueToPrice: false,
      };
      // At start: should be in block (inclusive start)
      expect(decideLowPriceCharging([block], 1000, ctx)).toBe('turnOn');
      // At end: should NOT be in block (exclusive end)
      expect(decideLowPriceCharging([block], 2000, ctx)).toBe('noChange');
      // Just before end: should be in block
      expect(decideLowPriceCharging([block], 1999, ctx)).toBe('turnOn');
    });
  });

  describe('edge cases - state transitions', () => {
    test('handles wasOnDueToPrice when not in cheap period', () => {
      const block = { start: Date.now() + 10000, end: Date.now() + 20000, price: 0.1 };
      const decision = decideLowPriceCharging([block], Date.now(), {
        enableLowPrice: true,
        batteryLevel: 50,
        lowBatteryThreshold: 40,
        manualOverrideActive: false,
        wasOnDueToPrice: true, // Was on, but now not in cheap period
      });
      // Should turn off since was on due to price but not in cheap period anymore
      expect(decision).toBe('turnOff');
    });
  });

  describe('edge cases - input validation', () => {
    test('returns noChange when cheapest array is empty', () => {
      const decision = decideLowPriceCharging([], Date.now(), {
        enableLowPrice: true,
        batteryLevel: 50,
        lowBatteryThreshold: 40,
        manualOverrideActive: false,
        wasOnDueToPrice: false,
      });
      expect(decision).toBe('noChange');
    });
  });

  describe('edge cases - invalid data', () => {
    test('handles overlapping blocks', () => {
      const now = Date.now();
      // Create overlapping blocks (shouldn't happen in real data, but test robustness)
      const overlappingBlocks: Array<PriceBlock> = [
        { start: now - 1000, end: now + 2000, price: 0.1 },
        { start: now - 500, end: now + 1500, price: 0.1 }, // Overlaps with first
      ];
      // Should not crash, and should detect we're in a cheap period
      const decision = decideLowPriceCharging(overlappingBlocks, now, {
        enableLowPrice: true,
        batteryLevel: 50,
        lowBatteryThreshold: 40,
        manualOverrideActive: false,
        wasOnDueToPrice: false,
      });
      expect(decision).toBe('turnOn'); // Should detect we're in cheap period
    });

    test('handles blocks with NaN timestamps', () => {
      // Create block with NaN start/end (invalid data)
      const invalidBlock: PriceBlock = {
        start: NaN,
        end: NaN,
        price: 0.1,
      };
      // Should not crash, but behavior is undefined
      expect(() => {
        decideLowPriceCharging([invalidBlock], Date.now(), {
          enableLowPrice: true,
          batteryLevel: 50,
          lowBatteryThreshold: 40,
          manualOverrideActive: false,
          wasOnDueToPrice: false,
        });
      }).not.toThrow();
    });
  });

  describe('integration with skip today feature', () => {
    test('does not charge today when today is skipped due to being more expensive', () => {
      const now = Date.now();
      const blockDuration = 15 * 60 * 1000;

      // Create cache where today is more expensive than tomorrow
      const testCache: PriceCache = {};

      // Today's blocks (expensive) - starting 1 hour from now
      for (let i = 0; i < 8; i++) {
        const start = now + (60 * 60 * 1000) + (i * blockDuration);
        const end = start + blockDuration;
        testCache[String(start)] = { start, end, price: 0.5 }; // Expensive
      }

      // Tomorrow's blocks (cheap)
      const tomorrowStart = now + (24 * 60 * 60 * 1000);
      for (let i = 0; i < 20; i++) {
        const start = tomorrowStart + (i * blockDuration);
        const end = start + blockDuration;
        testCache[String(start)] = { start, end, price: 0.1 }; // Cheap
      }

      // Find cheapest blocks (should skip today and return tomorrow's blocks)
      const cheapest = findCheapestBlocks(testCache, 4, now);

      // Should return 8 blocks from tomorrow (2x count)
      expect(cheapest.length).toBe(8);

      // All blocks should be from tomorrow (in the future)
      cheapest.forEach(block => {
        expect(block.start).toBeGreaterThan(now + (12 * 60 * 60 * 1000)); // At least 12 hours in future
      });

      // Now verify that decideLowPriceCharging doesn't charge today
      // (since we're not in any of tomorrow's blocks)
      const decision = decideLowPriceCharging(cheapest, now, {
        enableLowPrice: true,
        batteryLevel: 80,
        lowBatteryThreshold: 40,
        manualOverrideActive: false,
        wasOnDueToPrice: false,
      });

      // Should not charge today (noChange or turnOff, but not turnOn)
      expect(decision).not.toBe('turnOn');
    });

    test('turns off charging if was on due to price when today is skipped', () => {
      const now = Date.now();
      const blockDuration = 15 * 60 * 1000;

      // Create cache where today is more expensive than tomorrow
      const testCache: PriceCache = {};

      // Today's blocks (expensive) - starting 1 hour from now
      for (let i = 0; i < 8; i++) {
        const start = now + (60 * 60 * 1000) + (i * blockDuration);
        const end = start + blockDuration;
        testCache[String(start)] = { start, end, price: 0.5 }; // Expensive
      }

      // Tomorrow's blocks (cheap)
      const tomorrowStart = now + (24 * 60 * 60 * 1000);
      for (let i = 0; i < 20; i++) {
        const start = tomorrowStart + (i * blockDuration);
        const end = start + blockDuration;
        testCache[String(start)] = { start, end, price: 0.1 }; // Cheap
      }

      // Find cheapest blocks (should skip today and return tomorrow's blocks)
      const cheapest = findCheapestBlocks(testCache, 4, now);

      // Verify that decideLowPriceCharging turns off if was on due to price
      const decision = decideLowPriceCharging(cheapest, now, {
        enableLowPrice: true,
        batteryLevel: 80,
        lowBatteryThreshold: 40,
        manualOverrideActive: false,
        wasOnDueToPrice: true, // Was on due to price
      });

      // Should turn off since we're not in cheap period anymore (today was skipped)
      expect(decision).toBe('turnOff');
    });
  });
});

