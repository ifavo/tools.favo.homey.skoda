import type { PriceBlock, PriceCache } from './types';

/**
 * Find cheapest blocks from cached price data.
 * - Only the raw price data is cached in `price_cache`
 * - This function always recalculates the cheapest blocks using the current `count`
 * - `now` is passed in for testability; defaults to current time.
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

  // Sort by time so we can look for the cheapest *consecutive* window
  const byTime = [...relevantBlocks].sort((a, b) => a.start - b.start);

  if (count >= byTime.length) {
    return byTime;
  }

  // Sliding window over consecutive blocks
  let bestStartIndex = 0;
  let bestSum = Number.POSITIVE_INFINITY;

  // Initial window
  let currentSum = 0;
  for (let i = 0; i < count; i++) {
    currentSum += byTime[i].price;
  }
  bestSum = currentSum;

  // Move the window one block at a time
  for (let end = count; end < byTime.length; end++) {
    currentSum += byTime[end].price - byTime[end - count].price;
    if (currentSum < bestSum) {
      bestSum = currentSum;
      bestStartIndex = end - count + 1;
    }
  }

  return byTime.slice(bestStartIndex, bestStartIndex + count);
}
