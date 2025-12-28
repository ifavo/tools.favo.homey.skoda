import type { PriceBlock, PriceCache } from './types';
import { getUTCDate, MILLISECONDS_PER_DAY } from '../utils/dateUtils';

/**
 * Check if a block is on a specific UTC date
 * @param block - Price block to check
 * @param dateUTC - UTC date number (1-31) to check against
 * @returns True if block is on the specified UTC date, false otherwise
 */
function isBlockOnDate(block: PriceBlock, dateUTC: number): boolean {
  return getUTCDate(block.start) === dateUTC;
}

/**
 * Sort blocks by price (cheapest first) and return top N
 * @param blocks - Array of price blocks to sort
 * @param count - Number of cheapest blocks to return
 * @returns Array of cheapest price blocks, sorted by price (ascending)
 */
function getCheapestBlocks(blocks: Array<PriceBlock>, count: number): Array<PriceBlock> {
  return [...blocks].sort((a, b) => a.price - b.price).slice(0, count);
}

/**
 * Find cheapest blocks from cached price data.
 * - Only the raw price data is cached in `price_cache`
 * - This function always recalculates the cheapest blocks using the current `count`
 * - `now` is passed in for testability; defaults to current time.
 * - Finds the cheapest individual blocks (not necessarily consecutive)
 * - Looks at today first, falls back to tomorrow if no future blocks from today
 * @param cache - Cached price data as PriceCache object
 * @param count - Number of cheapest blocks to find
 * @param now - Current timestamp in milliseconds (defaults to Date.now())
 * @returns Array of cheapest price blocks, sorted by time
 */
export function findCheapestBlocks(
  cache: PriceCache,
  count: number,
  now: number = Date.now(),
): Array<PriceBlock> {
  const todayUTC = getUTCDate(now);
  const tomorrowUTC = getUTCDate(now + MILLISECONDS_PER_DAY);

  // Filter relevant blocks (today and tomorrow)
  const relevantBlocks = Object.values(cache).filter((b: PriceBlock) => {
    return isBlockOnDate(b, todayUTC) || isBlockOnDate(b, tomorrowUTC);
  }) as Array<PriceBlock>;

  if (relevantBlocks.length === 0 || count <= 0) {
    return [];
  }

  // Step 1: Find cheapest blocks for TODAY (including past ones)
  const todayBlocks = relevantBlocks.filter((b: PriceBlock) => isBlockOnDate(b, todayUTC));
  const cheapestToday = getCheapestBlocks(todayBlocks, count);

  // Filter to only future blocks from today's cheapest
  let cheapest = cheapestToday.filter((b) => b.start > now);

  // Step 2: If no future blocks from today, find cheapest blocks for TOMORROW
  if (cheapest.length === 0) {
    const tomorrowBlocks = relevantBlocks.filter((b: PriceBlock) => isBlockOnDate(b, tomorrowUTC) && b.start > now);
    cheapest = getCheapestBlocks(tomorrowBlocks, count);
  }

  // Sort result by time for consistent ordering
  cheapest.sort((a, b) => a.start - b.start);

  return cheapest;
}
