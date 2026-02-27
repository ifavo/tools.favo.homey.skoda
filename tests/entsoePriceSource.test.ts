import fs from 'fs';
import path from 'path';

import { EntsoePriceSource, DEFAULT_BIDDING_ZONE } from '../logic/lowPrice/sources/entsoe';

const GERMANY_EIC = '10Y1001A1001A83F';
const DE_LU_EIC = '10Y1001A1001A82H';

describe('ENTSO-E price source', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('EntsoePriceSource returns 15-minute entries and converts €/MWh to €/kWh (PT60M)', async () => {
    const xmlPath = path.join(__dirname, 'assets', 'entsoe-a44-sample.xml');
    const xml = fs.readFileSync(xmlPath, 'utf8');

    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve(xml),
      } as Response),
    ) as jest.Mock;

    const source = new EntsoePriceSource('test-token');
    const entries = await source.fetch();

    // 2 hourly points expanded to 4 each = 8 entries
    expect(entries.length).toBe(8);
    expect(entries[0]).toHaveProperty('date');
    expect(entries[0]).toHaveProperty('price');
    expect(typeof entries[0].price).toBe('number');

    // First hour: 85.50 €/MWh = 0.0855 €/kWh (all four 15-min blocks same price)
    expect(entries[0].price).toBeCloseTo(0.0855, 4);
    expect(entries[1].price).toBeCloseTo(0.0855, 4);
    expect(entries[2].price).toBeCloseTo(0.0855, 4);
    expect(entries[3].price).toBeCloseTo(0.0855, 4);
    // Second hour: 72.30 €/MWh = 0.0723 €/kWh
    expect(entries[4].price).toBeCloseTo(0.0723, 4);
    expect(entries[5].price).toBeCloseTo(0.0723, 4);
    expect(entries[6].price).toBeCloseTo(0.0723, 4);
    expect(entries[7].price).toBeCloseTo(0.0723, 4);

    expect(entries[0].date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    const sorted = [...entries].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    expect(sorted).toEqual(entries);
  });

  test('EntsoePriceSource throws on HTTP error', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      } as Response),
    ) as jest.Mock;

    const source = new EntsoePriceSource('bad-token');
    await expect(source.fetch()).rejects.toThrow('ENTSO-E API failed: 401 Unauthorized');
  });

  test('EntsoePriceSource throws on unsupported resolution', async () => {
    const xml = `<?xml version="1.0"?>
<Publication_MarketDocument>
  <TimeSeries>
    <Period>
      <timeInterval><start>2025-02-26T23:00Z</start></timeInterval>
      <resolution>PT30M</resolution>
      <Point><position>1</position><price.amount>50</price.amount></Point>
    </Period>
  </TimeSeries>
</Publication_MarketDocument>`;

    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve(xml),
      } as Response),
    ) as jest.Mock;

    const source = new EntsoePriceSource('test-token');
    await expect(source.fetch()).rejects.toThrow('Unsupported resolution');
  });

  test('EntsoePriceSource throws when API key is empty', () => {
    expect(() => new EntsoePriceSource('')).toThrow('ENTSO-E API key is required');
    expect(() => new EntsoePriceSource('   ')).toThrow('ENTSO-E API key is required');
  });

  test('falls back to DE-LU when Germany returns no data', async () => {
    const xmlPath = path.join(__dirname, 'assets', 'entsoe-a44-sample.xml');
    const xmlWithData = fs.readFileSync(xmlPath, 'utf8');
    const acknowledgementNoData = `<?xml version="1.0"?>
<Acknowledgement_MarketDocument>
  <Reason><code>999</code><text>No matching data found</text></Reason>
</Acknowledgement_MarketDocument>`;

    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(acknowledgementNoData),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(xmlWithData),
      } as Response);
    global.fetch = fetchMock;

    const source = new EntsoePriceSource('test-token');
    const entries = await source.fetch();

    expect(entries.length).toBe(8);
    expect(entries[0].price).toBeCloseTo(0.0855, 4);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstUrl = (fetchMock.mock.calls[0][0] as string);
    const secondUrl = (fetchMock.mock.calls[1][0] as string);
    expect(firstUrl).toContain(`in_Domain=${encodeURIComponent(GERMANY_EIC)}`);
    expect(secondUrl).toContain(`in_Domain=${encodeURIComponent(DE_LU_EIC)}`);
  });

  test('tries second API URL when first returns no data', async () => {
    const xmlPath = path.join(__dirname, 'assets', 'entsoe-a44-sample.xml');
    const xmlWithData = fs.readFileSync(xmlPath, 'utf8');
    const acknowledgementNoData = `<?xml version="1.0"?>
<Acknowledgement_MarketDocument>
  <Reason><code>999</code><text>No matching data found</text></Reason>
</Acknowledgement_MarketDocument>`;

    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(acknowledgementNoData) } as Response)
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(acknowledgementNoData) } as Response)
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(xmlWithData) } as Response);
    global.fetch = fetchMock;

    const source = new EntsoePriceSource('test-token');
    const entries = await source.fetch();

    expect(entries.length).toBe(8);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls[0]).toContain('web-api.tp.entsoe.eu');
    expect(urls[1]).toContain('web-api.tp.entsoe.eu');
    expect(urls[2]).toContain('external-api.tp.entsoe.eu');
  });

  test('when configured with DE-LU zone, does not try Germany fallback', async () => {
    const xmlPath = path.join(__dirname, 'assets', 'entsoe-a44-sample.xml');
    const xml = fs.readFileSync(xmlPath, 'utf8');

    const fetchMock = jest.fn(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve(xml),
      } as Response),
    );
    global.fetch = fetchMock;

    const source = new EntsoePriceSource('test-token', DE_LU_EIC);
    const entries = await source.fetch();

    expect(entries.length).toBe(8);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][0] as string)).toContain(`in_Domain=${encodeURIComponent(DE_LU_EIC)}`);
  });

  test('DEFAULT_BIDDING_ZONE is Germany EIC', () => {
    expect(DEFAULT_BIDDING_ZONE).toBe(GERMANY_EIC);
  });
});
