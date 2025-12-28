import fs from 'fs';
import path from 'path';

import { SmardPriceSource } from '../logic/lowPrice/sources/smard';

describe('SMARD data source', () => {
  test('SmardPriceSource parses SMARD API response correctly', async () => {
    // Mock fetch to return test data
    global.fetch = jest.fn((url: string) => {
      if (url.includes('index_quarterhour.json')) {
        const indexPath = path.join(__dirname, 'assets', 'smard-index.json');
        const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(indexData),
        } as Response);
      } else if (url.includes('_quarterhour_')) {
        const dataPath = path.join(__dirname, 'assets', 'smard-data.json');
        const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(data),
        } as Response);
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    }) as jest.Mock;

    const source = new SmardPriceSource('DE-LU');
    const entries = await source.fetch();

    // Verify entries are parsed correctly
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]).toHaveProperty('date');
    expect(entries[0]).toHaveProperty('price');
    expect(typeof entries[0].price).toBe('number');
    expect(entries[0].price).toBeGreaterThan(0);

    // Verify timestamps are ISO strings
    expect(entries[0].date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    // Verify prices are in €/kWh (converted from €/MWh)
    // First entry in test data is 77.3 €/MWh = 0.0773 €/kWh
    expect(entries[0].price).toBeCloseTo(0.0773, 4);
  });

  test('SmardPriceSource handles null prices correctly', async () => {
    // Mock fetch with data containing null prices
    global.fetch = jest.fn((url: string) => {
      if (url.includes('index_quarterhour.json')) {
        // Return only one timestamp so we only fetch once
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            timestamps: [1766790000000],
          }),
        } as Response);
      } else if (url.includes('_quarterhour_')) {
        // Return data with null prices
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            series: [
              [1766787300000, 77.3],
              [1766788200000, null], // null price should be skipped
              [1766789100000, 85.54],
            ],
          }),
        } as Response);
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    }) as jest.Mock;

    const source = new SmardPriceSource('DE-LU');
    const entries = await source.fetch();

    // Should only have 2 entries (null price skipped)
    expect(entries.length).toBe(2);
    expect(entries.every((e) => e.price !== null)).toBe(true);
  });

  test('SmardPriceSource throws error for invalid market area', () => {
    expect(() => {
      new SmardPriceSource('INVALID');
    }).toThrow('Invalid market area');
  });

  test('SmardPriceSource handles missing series data gracefully', async () => {
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
    const entries = await source.fetch();

    // Should return empty array when no series data
    expect(entries).toEqual([]);
  });

  test('SmardPriceSource handles empty entries array', async () => {
    // Mock fetch that returns empty entries
    global.fetch = jest.fn((url: string) => {
      if (url.includes('index_quarterhour.json')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            timestamps: [1766790000000],
          }),
        } as Response);
      } else if (url.includes('_quarterhour_')) {
        // Return data with empty series
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            series: [],
          }),
        } as Response);
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    }) as jest.Mock;

    const source = new SmardPriceSource('DE-LU');
    const entries = await source.fetch();

    // Should return empty array
    expect(entries).toEqual([]);
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
    global.fetch = jest.fn((url: string) => {
      if (url.includes('index_quarterhour.json')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            timestamps: [1766790000000, 1766793600000],
          }),
        } as Response);
      } else if (url.includes('_quarterhour_1766790000000')) {
        // First timestamp fails
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        } as Response);
      } else if (url.includes('_quarterhour_1766793600000')) {
        // Second timestamp succeeds
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            series: [
              [1766793600000, 77.3],
              [1766794500000, 85.54],
            ],
          }),
        } as Response);
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    }) as jest.Mock;

    const source = new SmardPriceSource('DE-LU');
    const entries = await source.fetch();

    // Should still return entries from the successful fetch
    expect(entries.length).toBe(2);
    // Should have logged a warning for the failed fetch (covered lines 69-70)
  });
});

