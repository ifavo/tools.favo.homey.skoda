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
});

