import fs from 'fs';
import path from 'path';

import { SmartEnergyPriceSource } from '../logic/lowPrice/sources/smartEnergy';

describe('Smart Energy data source', () => {
  test('SmartEnergyPriceSource parses Smart Energy API response correctly', async () => {
    // Mock fetch to return test data
    global.fetch = jest.fn(() => {
      const dataPath = path.join(__dirname, 'assets', 'smartEnergy-data.json');
      const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(data),
      } as Response);
    }) as jest.Mock;

    const source = new SmartEnergyPriceSource();
    const entries = await source.fetch();

    // Verify entries are parsed correctly
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]).toHaveProperty('date');
    expect(entries[0]).toHaveProperty('price');
    expect(typeof entries[0].price).toBe('number');
    expect(entries[0].price).toBeGreaterThan(0);

    // Verify timestamps are ISO strings
    expect(entries[0].date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    // Verify prices are in €/kWh (converted from ct/kWh)
    // First entry in test data is 7.73 ct/kWh = 0.0773 €/kWh
    expect(entries[0].price).toBeCloseTo(0.0773, 4);
  });

  test('SmartEnergyPriceSource converts ct/kWh to €/kWh correctly', async () => {
    global.fetch = jest.fn(() => {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          tariff: 'AT',
          unit: 'ct/kWh',
          interval: 15,
          data: [
            { date: '2025-12-28T00:00:00Z', value: 100 }, // 100 ct/kWh = 1.00 €/kWh
            { date: '2025-12-28T00:15:00Z', value: 50 },  // 50 ct/kWh = 0.50 €/kWh
            { date: '2025-12-28T00:30:00Z', value: 25 }, // 25 ct/kWh = 0.25 €/kWh
          ],
        }),
      } as Response);
    }) as jest.Mock;

    const source = new SmartEnergyPriceSource();
    const entries = await source.fetch();

    expect(entries[0].price).toBeCloseTo(1.00, 2);
    expect(entries[1].price).toBeCloseTo(0.50, 2);
    expect(entries[2].price).toBeCloseTo(0.25, 2);
  });

  test('SmartEnergyPriceSource throws error for non-15-minute interval', async () => {
    global.fetch = jest.fn(() => {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          tariff: 'AT',
          unit: 'ct/kWh',
          interval: 60, // Wrong interval
          data: [
            { date: '2025-12-28T00:00:00Z', value: 7.73 },
          ],
        }),
      } as Response);
    }) as jest.Mock;

    const source = new SmartEnergyPriceSource();

    await expect(source.fetch()).rejects.toThrow('Smart Energy API returned interval of 60 minutes, expected 15');
  });

  test('SmartEnergyPriceSource throws error on API failure', async () => {
    global.fetch = jest.fn(() => {
      return Promise.resolve({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);
    }) as jest.Mock;

    const source = new SmartEnergyPriceSource();

    await expect(source.fetch()).rejects.toThrow('Smart Energy API failed: 500 Internal Server Error');
  });

  test('SmartEnergyPriceSource handles empty data array', async () => {
    global.fetch = jest.fn(() => {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          tariff: 'AT',
          unit: 'ct/kWh',
          interval: 15,
          data: [],
        }),
      } as Response);
    }) as jest.Mock;

    const source = new SmartEnergyPriceSource();
    const entries = await source.fetch();

    expect(entries).toHaveLength(0);
  });
});

