/**
 * Common interface for price data sources.
 * All price sources must return data in this format for consistency.
 */

export interface PriceDataEntry {
  /** ISO 8601 date string (e.g., "2025-12-28T00:00:00+01:00") */
  date: string;
  /** Price in €/kWh */
  price: number;
}

export interface PriceDataSource {
  /**
   * Fetch price data from the source.
   * @returns Array of price entries with 15-minute intervals
   */
  fetch(): Promise<Array<PriceDataEntry>>;
}


