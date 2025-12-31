import type Homey from 'homey';
import type { PriceBlock, PriceCache } from '../../logic/lowPrice/types';
import { TibberPriceSource } from '../../logic/lowPrice/sources/tibber';
import { SmardPriceSource } from '../../logic/lowPrice/sources/smard';
import type { PriceDataSource } from '../../logic/lowPrice/priceSource';
import { formatNextChargingTimes } from '../../logic/lowPrice/formatNextChargingTimes';
import { findCheapestBlocks } from '../../logic/lowPrice/findCheapestHours';
import { getUTCDate, getTodayUTCDate, getTomorrowUTCDate, MILLISECONDS_PER_MINUTE } from '../../logic/utils/dateUtils';
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
 * Load price cache from device store
 * @param device - Homey device instance
 * @returns Price cache object
 */
export async function loadPriceCache(device: Homey.Device): Promise<PriceCache> {
  try {
    const cached = await device.getStoreValue('price_cache');
    if (cached) {
      return cached as PriceCache;
    }
    return {};
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
      // If Tibber fails and we're using Tibber, fall back to SMARD
      if (priceSource instanceof TibberPriceSource) {
        const errorMessage = extractErrorMessage(error);
        device.log(
          `[LOW_PRICE] Tibber API failed (${errorMessage}), falling back to SMARD API`,
        );
        const fallbackSource = new SmardPriceSource('DE-LU');
        priceData = await fallbackSource.fetch();
        // Update the price source reference (caller should handle this)
        Object.setPrototypeOf(priceSource, fallbackSource);
      } else {
        throw error;
      }
    }

    // Update cache with new prices
    // Each entry is a 15-minute block
    const BLOCK_DURATION_MINUTES = 15;
    const blockDurationMs = BLOCK_DURATION_MINUTES * MILLISECONDS_PER_MINUTE;

    let newBlocks = 0;
    let updatedBlocks = 0;
    let priceChanges = 0;

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

    for (const entry of priceData) {
      const startTimestamp = new Date(entry.date).getTime();
      const endTimestamp = startTimestamp + blockDurationMs;

      // Price is already in €/kWh from the price source
      const priceInEuros = entry.price;

      // Check if this block already exists in cache
      const existingBlock = cache[startTimestamp];
      const isUpdate = existingBlock !== undefined;

      // Update or add the block (this will overwrite existing entries with new prices)
      cache[startTimestamp] = {
        start: startTimestamp,
        end: endTimestamp,
        price: priceInEuros,
      };

      if (isUpdate) {
        updatedBlocks++;
        // Log if price actually changed
        if (existingBlock.price !== priceInEuros) {
          priceChanges++;
          device.log(
            `[LOW_PRICE] Price updated for ${new Date(startTimestamp).toISOString()}: `
            + `${formatPrice(existingBlock.price, 4)} → ${formatPrice(priceInEuros, 4)}`,
          );
        }
      } else {
        newBlocks++;
      }
    }

    // Save cache to device store
    await savePriceCache(device, cache);

    device.log(
      `[LOW_PRICE] Updated price cache: ${newBlocks} new blocks, ${updatedBlocks} existing blocks updated `
      + `(${priceChanges} with price changes), total ${priceData.length} blocks (15-minute intervals)`,
    );
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
  const allBlocks = Object.values(cache);
  const relevantBlocks = Object.values(cache).filter((b: PriceBlock) => {
    const todayUTC = getTodayUTCDate(now);
    const tomorrowUTC = getTomorrowUTCDate(now);
    const d = getUTCDate(b.start);
    return d === todayUTC || d === tomorrowUTC;
  }) as Array<PriceBlock>;

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

