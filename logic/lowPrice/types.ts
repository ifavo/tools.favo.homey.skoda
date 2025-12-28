export interface PriceBlock {
  start: number;
  end: number;
  price: number;
}

export type PriceCache = Record<string, PriceBlock>;





