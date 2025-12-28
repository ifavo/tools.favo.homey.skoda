import type { PriceBlock, PriceCache } from './types';

/**
 * Find cheapest blocks from cached price data.
 * - Only the raw price data is cached in `price_cache`
 * - This function always recalculates the cheapest blocks using the current `count`
 * - `now` is passed in for testability; defaults to current time.
 * - Finds the cheapest individual blocks (not necessarily consecutive)
 * - Looks at today first, falls back to tomorrow if no future blocks from today
 */
export function findCheapestBlocks(
  cache: PriceCache,
  count: number,
  now: number = Date.now(),
): Array<PriceBlock> {
  const todayUTC = new Date(now).getUTCDate();
  const tomorrowUTC = new Date(now + 86400000).getUTCDate();

  // Filter relevant blocks (today and tomorrow)
  const relevantBlocks = Object.values(cache).filter((b: PriceBlock) => {
    const d = new Date(b.start).getUTCDate();
    return d === todayUTC || d === tomorrowUTC;
  }) as Array<PriceBlock>;

  if (relevantBlocks.length === 0 || count <= 0) {
    return [];
  }

  // Step 1: Find cheapest blocks for TODAY (including past ones)
  const todayBlocks = relevantBlocks.filter((b: PriceBlock) => {
    const d = new Date(b.start).getUTCDate();
    return d === todayUTC;
  });
  const sortedTodayByPrice = [...todayBlocks].sort((a, b) => a.price - b.price);
  const cheapestToday = sortedTodayByPrice.slice(0, count);

  // Filter to only future blocks from today's cheapest
  let cheapest = cheapestToday.filter((b) => b.start > now);

  // Step 2: If no future blocks from today, find cheapest blocks for TOMORROW
  if (cheapest.length === 0) {
    const tomorrowBlocks = relevantBlocks.filter((b: PriceBlock) => {
      const d = new Date(b.start).getUTCDate();
      return d === tomorrowUTC && b.start > now;
    });
    const sortedTomorrowByPrice = [...tomorrowBlocks].sort((a, b) => a.price - b.price);
    cheapest = sortedTomorrowByPrice.slice(0, count);
  }

  // Sort result by time for consistent ordering
  cheapest.sort((a, b) => a.start - b.start);

  return cheapest;
}
