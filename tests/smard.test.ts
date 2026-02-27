import fs from 'fs';
import path from 'path';

import { SmardPriceSource } from '../logic/lowPrice/sources/smard';

/** Build a timestamp for today at 00:00 local, then add 15-min slots so latest entry is "today" */
function seriesWithLatestToday(count: number = 10): Array<[number, number]> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const series: Array<[number, number]> = [];
  const quarterHourMs = 15 * 60 * 1000;
  for (let i = 0; i < count; i++) {
    series.push([todayStart.getTime() + i * quarterHourMs, 77.3 + i]);
  }
  return series;
}

describe('SMARD data source', () => {
  test('SmardPriceSource parses SMARD API response correctly', async () => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const timestamp = todayStart.getTime();
    const series = seriesWithLatestToday(20);

    global.fetch = jest.fn((url: string) => {
      if (url.includes('index_quarterhour.json')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ timestamps: [timestamp] }),
        } as Response);
      } else if (url.includes('_quarterhour_')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ series }),
        } as Response);
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    }) as jest.Mock;

    const source = new SmardPriceSource('DE-LU');
    const entries = await source.fetch();

    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]).toHaveProperty('date');
    expect(entries[0]).toHaveProperty('price');
    expect(typeof entries[0].price).toBe('number');
    expect(entries[0].price).toBeGreaterThan(0);
    expect(entries[0].date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // 77.3 €/MWh = 0.0773 €/kWh
    expect(entries[0].price).toBeCloseTo(0.0773, 4);
  });

  test('SmardPriceSource handles null prices correctly', async () => {
    const series = seriesWithLatestToday(5);
    series[1] = [series[1][0], null as unknown as number]; // one null price to skip
    const timestamp = series[0][0];

    global.fetch = jest.fn((url: string) => {
      if (url.includes('index_quarterhour.json')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ timestamps: [timestamp] }),
        } as Response);
      } else if (url.includes('_quarterhour_')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ series }),
        } as Response);
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    }) as jest.Mock;

    const source = new SmardPriceSource('DE-LU');
    const entries = await source.fetch();

    expect(entries.length).toBe(4); // 5 minus the null
    expect(entries.every((e) => e.price !== null)).toBe(true);
  });

  test('SmardPriceSource throws error for invalid market area', () => {
    expect(() => {
      new SmardPriceSource('INVALID');
    }).toThrow('Invalid market area');
  });

  test('SmardPriceSource throws when missing series data (so fallback can run)', async () => {
    // Mock fetch with data missing series field
    global.fetch = jest.fn((url: string) => {
      if (url.includes('index_quarterhour.json')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            timestamps: [1766790000000],
          }),
        } as Response);
      } else if (url.includes('_quarterhour_')) {
        // Return data without series field
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            // Missing series field
          }),
        } as Response);
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    }) as jest.Mock;

    const source = new SmardPriceSource('DE-LU');
    await expect(source.fetch()).rejects.toThrow('SMARD API: No price data available');
  });

  test('SmardPriceSource throws when series is empty (so fallback can run)', async () => {
    global.fetch = jest.fn((url: string) => {
      if (url.includes('index_quarterhour.json')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            timestamps: [1766790000000],
          }),
        } as Response);
      } else if (url.includes('_quarterhour_')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ series: [] }),
        } as Response);
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    }) as jest.Mock;

    const source = new SmardPriceSource('DE-LU');
    await expect(source.fetch()).rejects.toThrow('SMARD API: No price data available');
  });

  test('SmardPriceSource filters entries when latest data is today', async () => {
    // Mock fetch with data where latest entry is today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = today.getTime();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayTimestamp = yesterday.getTime();

    global.fetch = jest.fn((url: string) => {
      if (url.includes('index_quarterhour.json')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            timestamps: [yesterdayTimestamp, todayTimestamp],
          }),
        } as Response);
      } else if (url.includes('_quarterhour_')) {
        // Create 96 entries per day (one per 15 minutes)
        const entriesPerDay = 96;
        const series: Array<[number, number]> = [];
        
        // Add yesterday's entries
        for (let i = 0; i < entriesPerDay; i++) {
          series.push([yesterdayTimestamp + i * 15 * 60 * 1000, 100]);
        }
        
        // Add today's entries
        for (let i = 0; i < entriesPerDay; i++) {
          series.push([todayTimestamp + i * 15 * 60 * 1000, 100]);
        }

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ series }),
        } as Response);
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    }) as jest.Mock;

    const source = new SmardPriceSource('DE-LU');
    const entries = await source.fetch();

    // Should return 2 days worth of entries (48 hours * 4 = 192 entries)
    // But actually it should return last 2 days = 96 * 2 = 192 entries
    expect(entries.length).toBeGreaterThan(0);
    // Verify all entries are from yesterday or today
    const entryDates = entries.map(e => new Date(e.date).getTime());
    const minDate = Math.min(...entryDates);
    const maxDate = Math.max(...entryDates);
    expect(minDate).toBeGreaterThanOrEqual(yesterdayTimestamp);
    expect(maxDate).toBeLessThanOrEqual(todayTimestamp + 24 * 60 * 60 * 1000);
  });

  test('SmardPriceSource throws error when index response is not ok', async () => {
    global.fetch = jest.fn((url: string) => {
      if (url.includes('index_quarterhour.json')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        } as Response);
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    }) as jest.Mock;

    const source = new SmardPriceSource('DE-LU');
    await expect(source.fetch()).rejects.toThrow('SMARD API index failed: 500 Internal Server Error');
  });

  test('SmardPriceSource throws error when no timestamps available', async () => {
    global.fetch = jest.fn((url: string) => {
      if (url.includes('index_quarterhour.json')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            timestamps: [], // Empty timestamps
          }),
        } as Response);
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    }) as jest.Mock;

    const source = new SmardPriceSource('DE-LU');
    await expect(source.fetch()).rejects.toThrow('SMARD API: No timestamps available');
  });

  test('SmardPriceSource handles failed data fetch for timestamp gracefully', async () => {
    const series = seriesWithLatestToday(5);
    const ts1 = series[0][0];
    const ts2 = ts1 + 7 * 24 * 60 * 60 * 1000; // second timestamp a week later (second file)

    global.fetch = jest.fn((url: string) => {
      if (url.includes('index_quarterhour.json')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ timestamps: [ts1, ts2] }),
        } as Response);
      } else if (url.includes(`_quarterhour_${ts1}`)) {
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        } as Response);
      } else if (url.includes(`_quarterhour_${ts2}`)) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ series }),
        } as Response);
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    }) as jest.Mock;

    const source = new SmardPriceSource('DE-LU');
    const entries = await source.fetch();

    expect(entries.length).toBe(5);
  });
});

