import type Homey from 'homey';
import type { PriceCache } from '../logic/lowPrice/types';
import type { PriceDataEntry, PriceDataSource } from '../logic/lowPrice/priceSource';
import { fetchAndUpdatePrices } from '../drivers/skoda-vehicle/priceManager';

describe('Price manager cache merge', () => {
  const createMockDevice = (): Homey.Device =>
    ({
      log: jest.fn(),
      error: jest.fn(),
      setStoreValue: jest.fn().mockResolvedValue(undefined),
      getStoreValue: jest.fn(),
    }) as unknown as Homey.Device;

  function make15mEntries(startIso: string, count: number, price: number): Array<PriceDataEntry> {
    const startMs = new Date(startIso).getTime();
    return Array.from({ length: count }, (_, i) => {
      const ms = startMs + i * 15 * 60 * 1000;
      return { date: new Date(ms).toISOString(), price };
    });
  }

  test('does not wipe existing today blocks when fetch returns a partial today payload', async () => {
    const fixedNow = new Date('2026-05-01T12:00:00Z').getTime();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(fixedNow);

    const device = createMockDevice();

    // Seed cache with a current-day plan covering 11:00–15:00 (16 blocks).
    const seededToday = make15mEntries('2026-05-01T11:00:00Z', 16, 0.10);
    const cache: PriceCache = {
      '2026-05-01': seededToday.map((e) => {
        const start = new Date(e.date).getTime();
        return { start, end: start + 15 * 60 * 1000, price: e.price };
      }),
    };

    // Simulate a midday refresh where the source returns only later blocks for today (14:00–16:00)
    // plus newly available tomorrow blocks. Previously, whole-day overwrite would drop 11:00–13:45.
    const fetchedTodayPartial = make15mEntries('2026-05-01T14:00:00Z', 8, 0.12);
    const fetchedTomorrow = make15mEntries('2026-05-02T00:00:00Z', 8, 0.20);
    const fetched = [...fetchedTodayPartial, ...fetchedTomorrow];

    const priceSource: PriceDataSource = {
      fetch: jest.fn().mockResolvedValue(fetched),
    };

    const updatedCache = await fetchAndUpdatePrices(device, cache, priceSource);

    // Ensure earlier blocks remain.
    const todayBlocks = updatedCache['2026-05-01'] ?? [];
    const has1100 = todayBlocks.some((b) => b.start === new Date('2026-05-01T11:00:00Z').getTime());
    const has1345 = todayBlocks.some((b) => b.start === new Date('2026-05-01T13:45:00Z').getTime());
    const has1400 = todayBlocks.some((b) => b.start === new Date('2026-05-01T14:00:00Z').getTime());
    expect(has1100).toBe(true);
    expect(has1345).toBe(true);
    expect(has1400).toBe(true);

    // Ensure tomorrow blocks are present.
    const tomorrowBlocks = updatedCache['2026-05-02'] ?? [];
    expect(tomorrowBlocks.length).toBeGreaterThan(0);

    nowSpy.mockRestore();
  });
});

