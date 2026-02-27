/**
 * Tests for price manager fallback: when SMARD fails, fall back to Smart Energy API.
 */

import fs from 'fs';
import path from 'path';

import type Homey from 'homey';
import { fetchAndUpdatePrices } from '../drivers/skoda-vehicle/priceManager';
import { SmardPriceSource } from '../logic/lowPrice/sources/smard';

describe('Price manager SMARD to Smart Energy fallback', () => {
  const createMockDevice = (): Homey.Device =>
    ({
      log: jest.fn(),
      error: jest.fn(),
      setStoreValue: jest.fn().mockResolvedValue(undefined),
      getStoreValue: jest.fn(),
    }) as unknown as Homey.Device;

  test('when SMARD fetch fails, falls back to Smart Energy and updates cache', async () => {
    const device = createMockDevice();
    const cache: Record<number, { start: number; end: number; price: number }> = {};

    const smartEnergyData = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'assets', 'smartEnergy-data.json'), 'utf8'),
    );

    global.fetch = jest.fn((url: string) => {
      if (url.includes('smard.de')) {
        return Promise.resolve({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
        } as Response);
      }
      if (url.includes('smartenergy.at')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(smartEnergyData),
        } as Response);
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    }) as jest.Mock;

    const priceSource = new SmardPriceSource('DE-LU');
    const updatedCache = await fetchAndUpdatePrices(device, cache, priceSource);

    expect(device.log).toHaveBeenCalledWith(
      expect.stringContaining('SMARD API failed'),
    );
    expect(device.log).toHaveBeenCalledWith(
      expect.stringContaining('falling back to Smart Energy API'),
    );

    const cacheEntries = Object.values(updatedCache);
    expect(cacheEntries.length).toBeGreaterThan(0);
    expect(cacheEntries[0]).toHaveProperty('start');
    expect(cacheEntries[0]).toHaveProperty('end');
    expect(cacheEntries[0]).toHaveProperty('price');
    expect(cacheEntries[0].price).toBeCloseTo(0.0773, 4);

    expect(device.setStoreValue).toHaveBeenCalledWith('price_cache', expect.any(Object));
  });

  test('live: when SMARD fails, fallback fetches from real Smart Energy API', async () => {
    const realFetch = global.fetch;
    global.fetch = jest.fn((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (urlStr.includes('smard.de')) {
        return Promise.resolve({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
        } as Response);
      }
      return realFetch(url, init);
    }) as typeof fetch;

    const device = createMockDevice();
    const cache: Record<number, { start: number; end: number; price: number }> = {};
    const priceSource = new SmardPriceSource('DE-LU');

    const updatedCache = await fetchAndUpdatePrices(device, cache, priceSource);

    const cacheEntries = Object.values(updatedCache);
    expect(cacheEntries.length).toBeGreaterThan(0);
    expect(device.log).toHaveBeenCalledWith(
      expect.stringMatching(/SMARD API failed.*falling back to Smart Energy API/),
    );

    global.fetch = realFetch;
  }, 15000);
});
