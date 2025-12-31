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
 * - Uses today's cheapest blocks if they are in the future, otherwise uses tomorrow's cheapest
 * - If today's cheapest blocks are more expensive than tomorrow's cheapest blocks,
 *   skips today and uses 2x the count for tomorrow
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
  // Use b.end > now to include blocks we're currently in (synchronizes with decideLowPriceCharging logic)
  const cheapestTodayFuture = cheapestToday.filter((b) => b.end > now);

  // Step 2: Get tomorrow's blocks for comparison
  const tomorrowBlocks = relevantBlocks.filter(
    (b: PriceBlock) => isBlockOnDate(b, tomorrowUTC) && b.end > now,
  );
  const cheapestTomorrow = getCheapestBlocks(tomorrowBlocks, count);

  // Step 3: Compare prices - if today's cheapest is more expensive than tomorrow's cheapest,
  // skip today and use 2x count for tomorrow
  let cheapest: Array<PriceBlock>;
  if (cheapestTodayFuture.length === 0) {
    // All of today's cheapest are in the past, use tomorrow's cheapest
    cheapest = getCheapestBlocks(tomorrowBlocks, count);
  } else if (cheapestTomorrow.length > 0) {
    // Calculate average price for comparison
    const todayAvgPrice = cheapestTodayFuture.reduce((sum, b) => sum + b.price, 0) / cheapestTodayFuture.length;
    const tomorrowAvgPrice = cheapestTomorrow.reduce((sum, b) => sum + b.price, 0) / cheapestTomorrow.length;

    // If today's cheapest is more expensive than tomorrow's cheapest, skip today and use 2x count for tomorrow
    if (todayAvgPrice > tomorrowAvgPrice) {
      // Skip today, use 2x count for tomorrow
      cheapest = getCheapestBlocks(tomorrowBlocks, count * 2);
    } else {
      // Use today's cheapest that are in the future (may be fewer than count if some are in the past)
      cheapest = cheapestTodayFuture;
    }
  } else {
    // No tomorrow blocks available, use today's cheapest that are in the future
    cheapest = cheapestTodayFuture;
  }

  // Sort result by time for consistent ordering
  cheapest.sort((a, b) => a.start - b.start);

  return cheapest;
}
