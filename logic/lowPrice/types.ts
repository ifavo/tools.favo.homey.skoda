export interface PriceBlock {
  start: number;
  end: number;
  price: number;
}

/**
 * Price cache organized by UTC day (YYYY-MM-DD).
 * Each day is overwritten or updated when new data is fetched; cheap block logic uses this cache consistently.
 */
export type PriceCache = Record<string, PriceBlock[]>;





