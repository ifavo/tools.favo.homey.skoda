import type Homey from 'homey';
import type { PriceBlock, PriceCache } from '../../logic/lowPrice/types';
import { TibberPriceSource } from '../../logic/lowPrice/sources/tibber';
import { SmardPriceSource } from '../../logic/lowPrice/sources/smard';
import { EntsoePriceSource } from '../../logic/lowPrice/sources/entsoe';
import { SmartEnergyPriceSource } from '../../logic/lowPrice/sources/smartEnergy';
import type { PriceDataSource } from '../../logic/lowPrice/priceSource';
import { formatNextChargingTimes } from '../../logic/lowPrice/formatNextChargingTimes';
import { findCheapestBlocks } from '../../logic/lowPrice/findCheapestHours';
import {
  getTodayUTCDayStartMs,
  getTomorrowUTCDayStartMs,
  getUTCDayKey,
  getUTCDayStartMs,
  MILLISECONDS_PER_DAY,
  MILLISECONDS_PER_MINUTE,
} from '../../logic/utils/dateUtils';
import { extractErrorMessage } from '../../logic/utils/errorUtils';
import { getSettingWithDefault, getLocale, getTimezone } from './deviceHelpers';

/**
 * Price management module for handling price data fetching, caching, and status updates
 */

/**
 * Format price in a human-readable way, avoiding scientific notation
 * @param price - Price in €/kWh
 * @param decimals - Number of decimal places (default: 5 for precision)
 * @returns Formatted price string with €/kWh unit
 */
function formatPrice(price: number, decimals: number = 5): string {
  // Handle zero
  if (price === 0) {
    return `0.${'0'.repeat(decimals)} €/kWh`;
  }

  // Handle negative prices
  const sign = price < 0 ? '-' : '';
  const absPrice = Math.abs(price);

  // Round to desired decimal places
  const multiplier = Math.pow(10, decimals);
  const rounded = Math.round(absPrice * multiplier);
  const roundedStr = rounded.toString();
  const roundedLen = roundedStr.length;

  // Format the number
  let formatted: string;
  if (roundedLen <= decimals) {
    // Very small number, pad with zeros
    formatted = `0.${'0'.repeat(decimals - roundedLen)}${roundedStr}`;
  } else {
    // Normal number, insert decimal point
    const intPart = roundedStr.substring(0, roundedLen - decimals) || '0';
    const fracPart = roundedStr.substring(roundedLen - decimals).padEnd(decimals, '0');
    formatted = `${intPart}.${fracPart}`;
  }

  return `${sign}${formatted} €/kWh`;
}

/**
 * Detect old cache format (flat Record<timestamp, PriceBlock>) for migration.
 */
function isOldCacheFormat(cached: unknown): cached is Record<string, PriceBlock> {
  if (!cached || typeof cached !== 'object' || Array.isArray(cached)) return false;
  const vals = Object.values(cached);
  if (vals.length === 0) return false;
  const first = vals[0];
  return (
    !Array.isArray(first) &&
    typeof first === 'object' &&
    first !== null &&
    'start' in first &&
    'end' in first &&
    'price' in first
  );
}

/**
 * Migrate old flat cache (keyed by block start ms) to day-based cache (keyed by YYYY-MM-DD).
 */
function migrateOldCacheToDayBased(old: Record<string, PriceBlock>): PriceCache {
  const byDay: PriceCache = {};
  for (const block of Object.values(old)) {
    const key = getUTCDayKey(block.start);
    if (!byDay[key]) byDay[key] = [];
    byDay[key].push(block);
  }
  for (const key of Object.keys(byDay)) {
    byDay[key].sort((a, b) => a.start - b.start);
  }
  return byDay;
}

/**
 * Load price cache from device store.
 * Migrates old format (flat by block timestamp) to day-based format on first load.
 * @param device - Homey device instance
 * @returns Price cache object (days -> blocks)
 */
export async function loadPriceCache(device: Homey.Device): Promise<PriceCache> {
  try {
    const cached = await device.getStoreValue('price_cache');
    if (!cached) return {};
    if (isOldCacheFormat(cached)) {
      device.log('[LOW_PRICE] Migrating price cache from flat to day-based format');
      const migrated = migrateOldCacheToDayBased(cached);
      await device.setStoreValue('price_cache', migrated).catch(() => {});
      return migrated;
    }
    return cached as PriceCache;
  } catch (error: unknown) {
    device.log('[LOW_PRICE] Could not load price cache from store, starting fresh');
    return {};
  }
}

/**
 * Save price cache to device store
 * @param device - Homey device instance
 * @param cache - Price cache object to save
 */
export async function savePriceCache(device: Homey.Device, cache: PriceCache): Promise<void> {
  try {
    await device.setStoreValue('price_cache', cache);
  } catch (error: unknown) {
    device.error('[LOW_PRICE] Failed to save cache:', extractErrorMessage(error));
  }
}

/**
 * Fetch prices from price data source and update cache
 * @param device - Homey device instance
 * @param cache - Current price cache object
 * @param priceSource - Price data source to fetch from
 * @returns Updated price cache object
 */
export async function fetchAndUpdatePrices(
  device: Homey.Device,
  cache: PriceCache,
  priceSource: PriceDataSource,
): Promise<PriceCache> {
  try {
    // Fetch price data from the configured source
    let priceData;
    try {
      priceData = await priceSource.fetch();
    } catch (error: unknown) {
      // If Tibber or ENTSO-E fails, fall back to SMARD
      if (priceSource instanceof TibberPriceSource) {
        const errorMessage = extractErrorMessage(error);
        device.log(
          `[LOW_PRICE] Tibber API failed (${errorMessage}), falling back to SMARD API`,
        );
        const fallbackSource = new SmardPriceSource('DE-LU');
        priceData = await fallbackSource.fetch();
        Object.setPrototypeOf(priceSource, fallbackSource);
      } else if (priceSource instanceof EntsoePriceSource) {
        const errorMessage = extractErrorMessage(error);
        device.log(
          `[LOW_PRICE] ENTSO-E API failed (${errorMessage}), falling back to SMARD API`,
        );
        const fallbackSource = new SmardPriceSource('DE-LU');
        priceData = await fallbackSource.fetch();
        Object.setPrototypeOf(priceSource, fallbackSource);
      } else if (priceSource instanceof SmardPriceSource) {
        const errorMessage = extractErrorMessage(error);
        device.log(
          `[LOW_PRICE] SMARD API failed (${errorMessage}), falling back to Smart Energy API`,
        );
        const fallbackSource = new SmartEnergyPriceSource();
        priceData = await fallbackSource.fetch();
      } else {
        throw error;
      }
    }

    // Group new data by UTC day and overwrite those days in cache (update on new data)
    const BLOCK_DURATION_MINUTES = 15;
    const blockDurationMs = BLOCK_DURATION_MINUTES * MILLISECONDS_PER_MINUTE;

    // Log first and last entries to verify timezone handling
    if (priceData.length > 0) {
      const firstEntry = priceData[0];
      const lastEntry = priceData[priceData.length - 1];
      const firstDate = new Date(firstEntry.date);
      const lastDate = new Date(lastEntry.date);
      device.log(
        `[LOW_PRICE] Price data range: ${firstEntry.date} (${firstDate.toISOString()}) to ${lastEntry.date} (${lastDate.toISOString()})`,
      );
      device.log(
        `[LOW_PRICE] First entry local (Europe/Berlin): ${firstDate.toLocaleString('en-US', { timeZone: 'Europe/Berlin' })}`,
      );
      device.log(
        `[LOW_PRICE] Last entry local (Europe/Berlin): ${lastDate.toLocaleString('en-US', { timeZone: 'Europe/Berlin' })}`,
      );
    }

    const blocksByDay: Record<string, PriceBlock[]> = {};
    for (const entry of priceData) {
      const startTimestamp = new Date(entry.date).getTime();
      const endTimestamp = startTimestamp + blockDurationMs;
      const priceInEuros = entry.price;
      const dayKey = getUTCDayKey(startTimestamp);
      if (!blocksByDay[dayKey]) blocksByDay[dayKey] = [];
      blocksByDay[dayKey].push({ start: startTimestamp, end: endTimestamp, price: priceInEuros });
    }

    let daysUpdated = 0;
    for (const [dayKey, blocks] of Object.entries(blocksByDay)) {
      blocks.sort((a, b) => a.start - b.start);
      cache[dayKey] = blocks;
      daysUpdated++;
    }

    await savePriceCache(device, cache);

    const now = Date.now();
    const todayKey = getUTCDayKey(now);
    const tomorrowKey = getUTCDayKey(now + MILLISECONDS_PER_DAY);
    const todayBlockCount = (cache[todayKey] || []).length;
    const tomorrowBlockCount = (cache[tomorrowKey] || []).length;

    device.log(
      `[LOW_PRICE] Updated price cache: ${daysUpdated} days overwritten, ${priceData.length} blocks (15-minute intervals)`,
    );
    device.log(
      `[LOW_PRICE] Cache day coverage: today ${todayKey} ${todayBlockCount} blocks, tomorrow ${tomorrowKey} ${tomorrowBlockCount} blocks`,
    );
    if (todayBlockCount === 0) {
      device.log(
        '[LOW_PRICE] Warning: no blocks for today in cache (fetch may have returned no today data, or save failed previously)',
      );
    }
    return cache;
  } catch (error: unknown) {
    const errorMessage = extractErrorMessage(error);
    device.error('[LOW_PRICE] Failed to fetch prices:', errorMessage);
    return cache; // Return existing cache on error
  }
}

/**
 * Find cheapest blocks from cached price data (wrapper with logging)
 * - Uses isolated findCheapestBlocks function
 * - Adds logging for debugging
 * @param device - Homey device instance
 * @param cache - Price cache object
 * @param count - Number of cheapest blocks to find
 * @returns Array of cheapest price blocks
 */
export function findCheapestBlocksWithLogging(
  device: Homey.Device,
  cache: PriceCache,
  count: number,
): Array<PriceBlock> {
  const now = Date.now();
  const todayKey = getUTCDayKey(now);
  const tomorrowKey = getUTCDayKey(now + MILLISECONDS_PER_DAY);
  const relevantBlocks = (cache[todayKey] || []).concat(cache[tomorrowKey] || []);
  const allBlocks = Object.values(cache).flat();

  // Log cache statistics for debugging
  const pastBlocks = relevantBlocks.filter((b) => b.start <= now);
  const futureBlocks = relevantBlocks.filter((b) => b.start > now);
  device.log(
    `[LOW_PRICE] Cache stats: ${allBlocks.length} total blocks, ${relevantBlocks.length} relevant (today/tomorrow), ${pastBlocks.length} past, ${futureBlocks.length} future`,
  );
  if (relevantBlocks.length > 0) {
    const sortedRelevant = [...relevantBlocks].sort((a, b) => a.price - b.price);
    const cheapest5 = sortedRelevant.slice(0, 5).map((b: PriceBlock) => {
      const date = new Date(b.start);
      const isPast = b.start <= now ? ' [PAST]' : ' [FUTURE]';
      return `${date.toISOString()} (${formatPrice(b.price)})${isPast}`;
    }).join(', ');
    device.log(`[LOW_PRICE] Top 5 cheapest relevant blocks: ${cheapest5}`);
  }

  // Use isolated function
  const cheapest = findCheapestBlocks(cache, count, now);

  // Log result for debugging
  if (cheapest.length > 0) {
    const blocksStr = cheapest.map((b: PriceBlock) => {
      const date = new Date(b.start);
      const isPast = b.start <= now ? ' [PAST]' : ' [FUTURE]';
      return `${date.toISOString()} (${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}, price: ${formatPrice(b.price)})${isPast}`;
    }).join(', ');
    const totalPrice = cheapest.reduce((sum, b) => sum + b.price, 0);
    device.log(`[LOW_PRICE] Computed cheapest blocks for count=${count}: ${cheapest.length} blocks (total: ${formatPrice(totalPrice, 4)}) -> ${blocksStr}`);
  }

  return cheapest;
}

/**
 * Update status variable with next cheap charging times
 * @param device - Homey device instance
 * @param cheapest - Array of cheapest price blocks
 * @param timezone - Timezone string for formatting times
 */
export async function updatePriceStatus(
  device: Homey.Device,
  cheapest: Array<PriceBlock>,
  timezone: string,
): Promise<void> {
  try {
    const now = Date.now();

    // Log all cheapest blocks with their timestamps for debugging
    const allBlocksDebug = cheapest.map((b: PriceBlock) => {
      const date = new Date(b.start);
      const isFuture = b.start > now;
      return `${date.toISOString()} (${date.toLocaleString('en-US', { timeZone: timezone || 'UTC', hour: '2-digit', minute: '2-digit' })}${isFuture ? ' [FUTURE]' : ' [PAST]'})`;
    }).join(', ');
    device.log(`[LOW_PRICE] All cheapest blocks (${cheapest.length}): ${allBlocksDebug}`);
    device.log(`[LOW_PRICE] Current time: ${new Date(now).toISOString()}`);

    const future = cheapest
      .filter((b) => b.start > now)
      .sort((a, b) => a.start - b.start);

    device.log(`[LOW_PRICE] Future blocks after filtering: ${future.length} out of ${cheapest.length}`);

    // Auto-detect locale and timezone
    const locale = getLocale(device);
    const detectedTimezone = timezone || getTimezone(device);

    // Use the centralized formatting function
    const listString = formatNextChargingTimes(cheapest, {
      now,
      locale,
      timezone: detectedTimezone,
    });

    // Store as device store value for potential future use
    await device.setStoreValue('next_charging_times', listString).catch((error: unknown) => {
      device.error('[LOW_PRICE] Failed to store next charging times:', extractErrorMessage(error));
    });

    // Update capability value so it appears as a status option
    try {
      await device.setCapabilityValue('next_charging_times', listString);
      device.log(`[LOW_PRICE] Next charging times capability updated: ${listString}`);
    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      device.error('[LOW_PRICE] Could not set next_charging_times capability:', errorMessage);
      // If capability doesn't exist, log it but don't fail
      if (errorMessage.includes('not found') || errorMessage.includes('does not exist') || errorMessage.includes('not registered')) {
        device.log('[LOW_PRICE] Capability not registered - device may need to be re-added for custom capability to work');
      }
    }

    device.log(`[LOW_PRICE] Next charging times: ${listString}`);
  } catch (error: unknown) {
    const errorMessage = extractErrorMessage(error);
    device.error('[LOW_PRICE] Failed to update status:', errorMessage);
    // Try to update capability with error message
    try {
      await device.setCapabilityValue('next_charging_times', 'Error updating times');
    } catch (capError: unknown) {
      // Ignore if capability not available
    }
  }
}

