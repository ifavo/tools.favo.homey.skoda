import fs from 'fs';
import path from 'path';

import { TibberPriceSource } from '../logic/lowPrice/sources/tibber';

describe('Tibber data source', () => {
  test('TibberPriceSource parses Tibber API response correctly', async () => {
    // Mock fetch to return test data
    global.fetch = jest.fn(() => {
      const dataPath = path.join(__dirname, 'assets', 'tibber-data.json');
      const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(data),
      } as Response);
    }) as jest.Mock;

    const source = new TibberPriceSource();
    const entries = await source.fetch();

    // Verify entries are parsed correctly
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]).toHaveProperty('date');
    expect(entries[0]).toHaveProperty('price');
    expect(typeof entries[0].price).toBe('number');
    expect(entries[0].price).toBeGreaterThan(0);

    // Verify timestamps are ISO strings
    expect(entries[0].date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    // Verify prices are in €/kWh (already from Tibber)
    // First entry in test data is 0.0773 €/kWh
    expect(entries[0].price).toBeCloseTo(0.0773, 4);
  });

  test('TibberPriceSource includes both today and tomorrow prices', async () => {
    global.fetch = jest.fn(() => {
      const dataPath = path.join(__dirname, 'assets', 'tibber-data.json');
      const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(data),
      } as Response);
    }) as jest.Mock;

    const source = new TibberPriceSource();
    const entries = await source.fetch();

    // Should have entries from both today and tomorrow
    // Test data has 3 today + 2 tomorrow = 5 total
    expect(entries.length).toBe(5);

    // Verify today entries are included
    const todayEntries = entries.filter((e) => e.date.includes('2025-12-28'));
    expect(todayEntries.length).toBe(3);

    // Verify tomorrow entries are included
    const tomorrowEntries = entries.filter((e) => e.date.includes('2025-12-29'));
    expect(tomorrowEntries.length).toBe(2);
  });

  test('TibberPriceSource uses demo token by default', async () => {
    let capturedToken: string | null = null;

    global.fetch = jest.fn((url: string, options?: RequestInit) => {
      if (options?.headers) {
        const authHeader = (options.headers as Record<string, string>)['Authorization'];
        if (authHeader) {
          capturedToken = authHeader.replace('Bearer ', '');
        }
      }
      const dataPath = path.join(__dirname, 'assets', 'tibber-data.json');
      const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(data),
      } as Response);
    }) as jest.Mock;

    const source = new TibberPriceSource();
    await source.fetch();

    // Should use demo token
    expect(capturedToken).toBe('3A77EECF61BD445F47241A5A36202185C35AF3AF58609E19B53F3A8872AD7BE1-1');
  });

  test('TibberPriceSource uses provided token', async () => {
    let capturedToken: string | null = null;

    global.fetch = jest.fn((url: string, options?: RequestInit) => {
      if (options?.headers) {
        const authHeader = (options.headers as Record<string, string>)['Authorization'];
        if (authHeader) {
          capturedToken = authHeader.replace('Bearer ', '');
        }
      }
      const dataPath = path.join(__dirname, 'assets', 'tibber-data.json');
      const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(data),
      } as Response);
    }) as jest.Mock;

    const customToken = 'custom-token-123';
    const source = new TibberPriceSource(customToken);
    await source.fetch();

    expect(capturedToken).toBe(customToken);
  });

  test('TibberPriceSource uses demo token when "demo" is provided', async () => {
    let capturedToken: string | null = null;

    global.fetch = jest.fn((url: string, options?: RequestInit) => {
      if (options?.headers) {
        const authHeader = (options.headers as Record<string, string>)['Authorization'];
        if (authHeader) {
          capturedToken = authHeader.replace('Bearer ', '');
        }
      }
      const dataPath = path.join(__dirname, 'assets', 'tibber-data.json');
      const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(data),
      } as Response);
    }) as jest.Mock;

    const source = new TibberPriceSource('demo');
    await source.fetch();

    expect(capturedToken).toBe('3A77EECF61BD445F47241A5A36202185C35AF3AF58609E19B53F3A8872AD7BE1-1');
  });

  test('TibberPriceSource throws error on API failure', async () => {
    global.fetch = jest.fn(() => {
      return Promise.resolve({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      } as Response);
    }) as jest.Mock;

    const source = new TibberPriceSource();

    await expect(source.fetch()).rejects.toThrow('Tibber API failed: 401 Unauthorized');
  });

  test('TibberPriceSource throws error on GraphQL errors', async () => {
    global.fetch = jest.fn(() => {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          errors: [
            { message: 'Invalid token' },
            { message: 'Access denied' },
          ],
        }),
      } as Response);
    }) as jest.Mock;

    const source = new TibberPriceSource();

    await expect(source.fetch()).rejects.toThrow('Tibber API errors: Invalid token, Access denied');
  });

  test('TibberPriceSource throws error on invalid response structure', async () => {
    global.fetch = jest.fn(() => {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          data: {
            viewer: {
              homes: [], // Empty homes array
            },
          },
        }),
      } as Response);
    }) as jest.Mock;

    const source = new TibberPriceSource();

    await expect(source.fetch()).rejects.toThrow('Tibber API: Invalid response structure');
  });

  test('TibberPriceSource handles missing tomorrow prices', async () => {
    global.fetch = jest.fn(() => {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          data: {
            viewer: {
              homes: [
                {
                  currentSubscription: {
                    priceInfo: {
                      today: [
                        {
                          startsAt: '2025-12-28T00:00:00+01:00',
                          total: 0.0773,
                          currency: 'EUR',
                        },
                      ],
                      // tomorrow is missing
                    },
                  },
                },
              ],
            },
          },
        }),
      } as Response);
    }) as jest.Mock;

    const source = new TibberPriceSource();
    const entries = await source.fetch();

    // Should only have today's entries
    expect(entries.length).toBe(1);
    expect(entries[0].date).toContain('2025-12-28');
  });

  test('TibberPriceSource handles missing today prices', async () => {
    global.fetch = jest.fn(() => {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          data: {
            viewer: {
              homes: [
                {
                  currentSubscription: {
                    priceInfo: {
                      // today is missing
                      tomorrow: [
                        {
                          startsAt: '2025-12-29T00:00:00+01:00',
                          total: 0.0745,
                          currency: 'EUR',
                        },
                      ],
                    },
                  },
                },
              ],
            },
          },
        }),
      } as Response);
    }) as jest.Mock;

    const source = new TibberPriceSource();
    const entries = await source.fetch();

    // Should only have tomorrow's entries
    expect(entries.length).toBe(1);
    expect(entries[0].date).toContain('2025-12-29');
  });

  test('TibberPriceSource handles empty price arrays', async () => {
    global.fetch = jest.fn(() => {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          data: {
            viewer: {
              homes: [
                {
                  currentSubscription: {
                    priceInfo: {
                      today: [],
                      tomorrow: [],
                    },
                  },
                },
              ],
            },
          },
        }),
      } as Response);
    }) as jest.Mock;

    const source = new TibberPriceSource();
    const entries = await source.fetch();

    expect(entries).toHaveLength(0);
  });
});

