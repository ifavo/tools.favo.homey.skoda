import { XMLParser } from 'fast-xml-parser';
import type { PriceDataEntry, PriceDataSource } from '../priceSource';
import {
  getUTCDayStartMs,
  MILLISECONDS_PER_DAY,
  MILLISECONDS_PER_MINUTE,
} from '../../utils/dateUtils';

/**
 * ENTSO-E Transparency Platform API price data source.
 * Fetches day-ahead electricity prices (document type A44).
 * Supports PT60M (hourly) and PT15M resolutions; hourly data is expanded to 15-minute blocks.
 */

const ENTSOE_BASE_URL = 'https://web-api.tp.entsoe.eu/api';

/** DE-LU bidding zone EIC code (default, matches SMARD DE-LU) */
export const DEFAULT_BIDDING_ZONE = '10Y1001A1001A83F';

const PT60M_MS = 60 * MILLISECONDS_PER_MINUTE;
const PT15M_MS = 15 * MILLISECONDS_PER_MINUTE;

/** Format a Date to ENTSO-E period format YYYYMMDDHH00 in UTC */
function formatPeriodUTC(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  return `${y}${m}${d}${h}${min}`;
}

/** Parse ENTSO-E period start string (e.g. 2025-02-26T23:00Z) to milliseconds */
function parsePeriodStartISO(iso: string): number {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid period start: ${iso}`);
  }
  return ms;
}

/** Extract numeric price from Point; handle price.amount or nested price/amount */
function getPriceAmount(point: Record<string, unknown>): number | null {
  const pa = point['price.amount'] ?? (point as Record<string, unknown>).price;
  if (pa === undefined || pa === null) return null;
  if (typeof pa === 'object' && pa !== null && 'amount' in pa) {
    const amt = (pa as Record<string, unknown>).amount;
    const n = typeof amt === 'string' ? parseFloat(amt) : Number(amt);
    return Number.isNaN(n) ? null : n;
  }
  const n = typeof pa === 'string' ? parseFloat(pa) : Number(pa);
  return Number.isNaN(n) ? null : n;
}

/** Normalize TimeSeries/Period to array (API may return single object or array) */
function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export class EntsoePriceSource implements PriceDataSource {
  private readonly apiKey: string;
  private readonly biddingZone: string;

  constructor(apiKey: string, biddingZone: string = DEFAULT_BIDDING_ZONE) {
    this.apiKey = apiKey.trim();
    if (!this.apiKey) {
      throw new Error('ENTSO-E API key is required');
    }
    this.biddingZone = biddingZone;
  }

  async fetch(): Promise<Array<PriceDataEntry>> {
    const now = Date.now();
    const yesterdayStart = new Date(getUTCDayStartMs(now) - MILLISECONDS_PER_DAY);
    const dayAfterTomorrowStart = new Date(getUTCDayStartMs(now) + 2 * MILLISECONDS_PER_DAY);
    const periodStart = formatPeriodUTC(yesterdayStart);
    const periodEnd = formatPeriodUTC(dayAfterTomorrowStart);

    const query = [
      `securityToken=${encodeURIComponent(this.apiKey)}`,
      'documentType=A44',
      `in_Domain=${encodeURIComponent(this.biddingZone)}`,
      `out_Domain=${encodeURIComponent(this.biddingZone)}`,
      `periodStart=${periodStart}`,
      `periodEnd=${periodEnd}`,
    ].join('&');
    const url = `${ENTSOE_BASE_URL}?${query}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`ENTSO-E API failed: ${response.status} ${response.statusText}`);
    }

    const xmlText = await response.text();
    const parser = new XMLParser({
      ignoreDeclaration: true,
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });
    const doc = parser.parse(xmlText) as Record<string, unknown>;
    const root = doc['Publication_MarketDocument'] ?? doc['ns1:Publication_MarketDocument'] ?? doc;
    if (!root || typeof root !== 'object') {
      throw new Error('ENTSO-E API: Invalid response (no Publication_MarketDocument)');
    }

    const timeSeriesArr = asArray(
      (root as Record<string, unknown>).TimeSeries ?? (root as Record<string, unknown>)['ns1:TimeSeries'],
    );
    const entries: Array<PriceDataEntry> = [];

    for (const ts of timeSeriesArr) {
      if (!ts || typeof ts !== 'object') continue;
      const periodArr = asArray(
        (ts as Record<string, unknown>).Period ?? (ts as Record<string, unknown>)['ns1:Period'],
      );
      for (const period of periodArr) {
        if (!period || typeof period !== 'object') continue;
        const interval = (period as Record<string, unknown>).timeInterval ?? (period as Record<string, unknown>)['ns1:timeInterval'];
        let startStr: string | undefined;
        if (typeof interval === 'object' && interval !== null && 'start' in interval) {
          const s = (interval as Record<string, unknown>).start;
          startStr = typeof s === 'string' ? s : Array.isArray(s) ? s[0] : undefined;
        } else {
          const s = (interval as Record<string, unknown>)?.['ns1:start'];
          startStr = typeof s === 'string' ? s : Array.isArray(s) ? s[0] : undefined;
        }
        if (!startStr) continue;
        const periodStartMs = parsePeriodStartISO(startStr);

        const res = (period as Record<string, unknown>).resolution ?? (period as Record<string, unknown>)['ns1:resolution'];
        let resolution: string = 'PT60M';
        if (typeof res === 'string') resolution = res;
        else if (Array.isArray(res) && res[0]) resolution = String(res[0]);
        let resolutionMs: number | null = null;
        if (resolution === 'PT15M') resolutionMs = PT15M_MS;
        else if (resolution === 'PT60M') resolutionMs = PT60M_MS;
        if (resolutionMs === null) {
          throw new Error(`ENTSO-E API: Unsupported resolution ${resolution}`);
        }

        const pointArr = asArray(
          (period as Record<string, unknown>).Point ?? (period as Record<string, unknown>)['ns1:Point'],
        );
        for (const point of pointArr) {
          if (!point || typeof point !== 'object') continue;
          const posRaw = (point as Record<string, unknown>).position ?? (point as Record<string, unknown>)['ns1:position'];
          const position = typeof posRaw === 'number' ? posRaw : parseInt(String(posRaw ?? 1), 10);
          const pricePerMwh = getPriceAmount(point as Record<string, unknown>);
          if (pricePerMwh === null) continue;
          const pricePerKwh = pricePerMwh / 1000;

          const pointStartMs = periodStartMs + (position - 1) * resolutionMs;
          if (resolution === 'PT60M') {
            for (let i = 0; i < 4; i++) {
              const blockStart = pointStartMs + i * PT15M_MS;
              entries.push({
                date: new Date(blockStart).toISOString(),
                price: pricePerKwh,
              });
            }
          } else {
            entries.push({
              date: new Date(pointStartMs).toISOString(),
              price: pricePerKwh,
            });
          }
        }
      }
    }

    if (entries.length === 0) {
      throw new Error('ENTSO-E API: No price points in response');
    }

    entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return entries;
  }
}
