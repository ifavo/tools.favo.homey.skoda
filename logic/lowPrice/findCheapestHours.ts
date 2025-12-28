import type { PriceBlock, PriceCache } from './types';

/**
 * Find cheapest blocks from cached price data.
 * - Only the raw price data is cached in `price_cache`
 * - This function always recalculates the cheapest blocks using the current `count`
 * - `now` is passed in for testability; defaults to current time.
 * - Finds the cheapest individual blocks (not necessarily consecutive)
 */
export function findCheapestBlocks(
  cache: PriceCache,
  count: number,
  now: number = Date.now(),
): Array<PriceBlock> {
  const todayUTC = new Date(now).getUTCDate();

  // Filter relevant blocks for the current day only
  const relevantBlocks = Object.values(cache).filter((b: PriceBlock) => {
    const d = new Date(b.start).getUTCDate();
    return d === todayUTC;
  }) as Array<PriceBlock>;

  if (relevantBlocks.length === 0 || count <= 0) {
    return [];
  }

  // Sort by price to find cheapest individual blocks
  const sortedByPrice = [...relevantBlocks].sort((a, b) => a.price - b.price);

  if (count >= sortedByPrice.length) {
    // Sort by time for consistent ordering when returning all blocks
    return sortedByPrice.sort((a, b) => a.start - b.start);
  }

  // Get cheapest N blocks
  const cheapest = sortedByPrice.slice(0, count);

  // Sort result by time for consistent ordering
  return cheapest.sort((a, b) => a.start - b.start);
}
