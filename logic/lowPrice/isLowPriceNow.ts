import type { PriceBlock } from './types';

export function isLowPriceNow(cheapest: Array<PriceBlock>, now: number): boolean {
  return cheapest.some((block: PriceBlock) => now >= block.start && now < block.end);
}

