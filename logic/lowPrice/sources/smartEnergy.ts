import type { PriceDataEntry, PriceDataSource } from '../priceSource';

/**
 * Smart Energy API price data source.
 * Fetches electricity prices from Smart Energy API.
 */
export class SmartEnergyPriceSource implements PriceDataSource {
  private readonly url = 'https://apis.smartenergy.at/market/v1/price';

  async fetch(): Promise<Array<PriceDataEntry>> {
    const response = await fetch(this.url);

    if (!response.ok) {
      throw new Error(`Smart Energy API failed: ${response.status} ${response.statusText}`);
    }

    const json = await response.json() as {
      tariff: string;
      unit: string;
      interval: number;
      data: Array<{ date: string; value: number }>;
    };

    // Verify we have 15-minute intervals
    if (json.interval !== 15) {
      throw new Error(`Smart Energy API returned interval of ${json.interval} minutes, expected 15`);
    }

    // Convert from ct/kWh to €/kWh
    return json.data.map((entry) => ({
      date: entry.date,
      price: entry.value / 100, // Convert ct/kWh to €/kWh
    }));
  }
}
