import type { PriceDataEntry, PriceDataSource } from '../priceSource';

/**
 * SMARD.de API price data source.
 * Fetches electricity prices from SMARD.de API.
 */

const MARKET_AREA_MAP: Record<string, number> = {
  'DE-LU': 4169,
  'Anrainer DE-LU': 5078,
  'BE': 4996,
  'NO2': 4997,
  'AT': 4170,
  'DK1': 252,
  'DK2': 253,
  'FR': 254,
  'IT (North)': 255,
  'NL': 256,
  'PL': 257,
  'CH': 259,
  'SI': 260,
  'CZ': 261,
  'HU': 262,
};

export class SmardPriceSource implements PriceDataSource {
  private readonly baseUrl = 'https://www.smard.de/app/chart_data';
  private readonly marketArea: string;
  private readonly marketFilter: number;
  private readonly resolution = 'quarterhour'; // 15-minute intervals

  constructor(marketArea: string = 'DE-LU') {
    this.marketArea = marketArea;
    const filter = MARKET_AREA_MAP[marketArea];
    if (!filter) {
      throw new Error(`Invalid market area: ${marketArea}. Supported areas: ${Object.keys(MARKET_AREA_MAP).join(', ')}`);
    }
    this.marketFilter = filter;
  }

  async fetch(): Promise<Array<PriceDataEntry>> {
    // Step 1: Get available timestamps for the market area
    const indexUrl = `${this.baseUrl}/${this.marketFilter}/${this.marketArea}/index_${this.resolution}.json`;
    const indexResponse = await fetch(indexUrl);

    if (!indexResponse.ok) {
      throw new Error(`SMARD API index failed: ${indexResponse.status} ${indexResponse.statusText}`);
    }

    const indexData = await indexResponse.json() as {
      timestamps: number[];
    };

    if (!indexData.timestamps || indexData.timestamps.length === 0) {
      throw new Error('SMARD API: No timestamps available');
    }

    // Fetch last 2 data-series (because on Sunday noon starts a new series and some data might be missing)
    const latestTimestamps = indexData.timestamps.slice(-2);

    const entries: Array<PriceDataEntry> = [];

    // Step 2: Fetch data for each timestamp
    for (const timestamp of latestTimestamps) {
      const dataUrl = `${this.baseUrl}/${this.marketFilter}/${this.marketArea}/${this.marketFilter}_${this.marketArea}_${this.resolution}_${timestamp}.json`;
      const dataResponse = await fetch(dataUrl);

      if (!dataResponse.ok) {
        console.warn(`[SMARD] Failed to fetch data for timestamp ${timestamp}: ${dataResponse.status}`);
        continue;
      }

      const data = await dataResponse.json() as {
        series: Array<[number, number | null]>;
      };

      if (!data.series) {
        console.warn(`[SMARD] No series data for timestamp ${timestamp}`);
        continue;
      }

      // Process series data: [timestamp_ms, price_in_eur_per_mwh]
      // Note: SMARD timestamps represent Europe/Berlin local time but are stored as UTC milliseconds.
      // We need to interpret them as local time and convert to proper UTC.
      for (const entry of data.series) {
        const [timestampMs, pricePerMwh] = entry;

        // Skip entries with null prices
        if (pricePerMwh === null) {
          continue;
        }

        // SMARD timestamps appear to represent local time (Europe/Berlin) stored as UTC.
        // If timestampMs represents "22:45" in Berlin but is stored as "22:45 UTC",
        // when displayed in Berlin it shows as "23:45" (UTC+1 in winter, UTC+2 in summer).
        //
        // Solution: Calculate the timezone offset for Europe/Berlin at this timestamp,
        // then subtract it to get the correct UTC timestamp.
        const dateFromTimestamp = new Date(timestampMs);

        // Get what this timestamp represents in Berlin vs UTC
        const berlinTime = dateFromTimestamp.toLocaleString('en-US', {
          timeZone: 'Europe/Berlin',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });
        const utcTime = dateFromTimestamp.toLocaleString('en-US', {
          timeZone: 'UTC',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });

        // Parse times to get hour difference
        // Format: "MM/DD/YYYY, HH:mm:ss"
        const berlinHour = parseInt(berlinTime.split(', ')[1].split(':')[0], 10);
        const utcHour = parseInt(utcTime.split(', ')[1].split(':')[0], 10);

        // Calculate offset (can be 1 or 2 hours depending on DST)
        let hourDiff = berlinHour - utcHour;
        // Handle day rollover
        if (hourDiff > 12) hourDiff -= 24;
        if (hourDiff < -12) hourDiff += 24;

        // Adjust timestamp: subtract the offset to convert Berlin local to UTC
        const offsetMs = hourDiff * 60 * 60 * 1000;
        const adjustedTimestamp = timestampMs - offsetMs;
        const adjustedDate = new Date(adjustedTimestamp);
        const isoString = adjustedDate.toISOString();

        // Convert price from €/MWh to €/kWh (divide by 1000)
        const pricePerKwh = pricePerMwh / 1000;

        entries.push({
          date: isoString,
          price: pricePerKwh,
        });
      }
    }

    // Filter entries based on latest entry date (matching Python implementation)
    // If latest data is today, return 48 entries (yesterday and today)
    // If latest data is tomorrow, return 72 entries (yesterday, today, and tomorrow)
    if (entries.length === 0) {
      return [];
    }

    // Sort by date to ensure chronological order
    entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const latestEntry = entries[entries.length - 1];
    const latestEntryDate = new Date(latestEntry.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const latestEntryDay = new Date(latestEntryDate);
    latestEntryDay.setHours(0, 0, 0, 0);

    // Calculate number of entries per day (24 hours * 60 minutes / duration in minutes)
    const entriesPerDay = (24 * 60) / 15; // 96 entries per day for 15-minute intervals

    let filteredEntries: Array<PriceDataEntry>;
    if (latestEntryDay.getTime() === today.getTime()) {
      // Latest data is today, return 48 entries (2 days)
      filteredEntries = entries.slice(-2 * entriesPerDay);
    } else {
      // Latest data is tomorrow, return 72 entries (3 days)
      filteredEntries = entries.slice(-3 * entriesPerDay);
    }

    return filteredEntries;
  }
}
