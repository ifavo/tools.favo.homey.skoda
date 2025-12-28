import type { PriceDataEntry, PriceDataSource } from '../priceSource';

/**
 * Tibber API price data source.
 * Fetches electricity prices from Tibber GraphQL API.
 * Market area is determined by the account/token, but can be specified for documentation.
 */
export class TibberPriceSource implements PriceDataSource {
  private readonly url = 'https://api.tibber.com/v1-beta/gql';
  private readonly token: string;
  private readonly marketArea: string;
  private readonly demoToken = '3A77EECF61BD445F47241A5A36202185C35AF3AF58609E19B53F3A8872AD7BE1-1';

  constructor(token?: string, marketArea: string = 'de') {
    // Use demo token if no token provided or if token is "demo"
    this.token = token && token !== 'demo' ? token : this.demoToken;
    // Market area (de, nl, no, se) - typically determined by account, but stored for reference
    this.marketArea = marketArea.toLowerCase();
  }

  async fetch(): Promise<Array<PriceDataEntry>> {
    const query = `
      {
        viewer {
          homes {
            currentSubscription {
              priceInfo(resolution: QUARTER_HOURLY) {
                today {
                  total
                  startsAt
                  currency
                }
                tomorrow {
                  total
                  startsAt
                  currency
                }
              }
            }
          }
        }
      }
    `;

    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`Tibber API failed: ${response.status} ${response.statusText}`);
    }

    const json = await response.json() as {
      data?: {
        viewer?: {
          homes?: Array<{
            currentSubscription?: {
              priceInfo?: {
                today?: Array<{ startsAt: string; total: number; currency: string }>;
                tomorrow?: Array<{ startsAt: string; total: number; currency: string }>;
              };
            };
          }>;
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (json.errors && json.errors.length > 0) {
      const errorMessages = json.errors.map(({ message }) => message).join(', ');
      throw new Error(`Tibber API errors: ${errorMessages}`);
    }

    if (!json.data?.viewer?.homes?.[0]?.currentSubscription?.priceInfo) {
      throw new Error('Tibber API: Invalid response structure');
    }

    const priceInfo = json.data.viewer.homes[0].currentSubscription.priceInfo;
    const entries: Array<PriceDataEntry> = [];

    // Process today's prices
    if (priceInfo.today) {
      // Log first and last entries from today to verify format
      if (priceInfo.today.length > 0) {
        const firstToday = priceInfo.today[0];
        const lastToday = priceInfo.today[priceInfo.today.length - 1];
        console.log('[TIBBER] Today first entry:', JSON.stringify(firstToday));
        console.log('[TIBBER] Today last entry:', JSON.stringify(lastToday));
        console.log('[TIBBER] Today last entry parsed:', new Date(lastToday.startsAt).toISOString());
        console.log('[TIBBER] Today last entry local (Europe/Berlin):', new Date(lastToday.startsAt).toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
      }

      for (const { startsAt, total } of priceInfo.today) {
        entries.push({
          date: startsAt,
          price: total, // Already in €/kWh from Tibber
        });
      }
    }

    // Process tomorrow's prices
    if (priceInfo.tomorrow) {
      // Log first entry from tomorrow to verify format
      if (priceInfo.tomorrow.length > 0) {
        const firstTomorrow = priceInfo.tomorrow[0];
        console.log('[TIBBER] Tomorrow first entry:', JSON.stringify(firstTomorrow));
        console.log('[TIBBER] Tomorrow first entry parsed:', new Date(firstTomorrow.startsAt).toISOString());
        console.log('[TIBBER] Tomorrow first entry local (Europe/Berlin):', new Date(firstTomorrow.startsAt).toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
      }

      for (const { startsAt, total } of priceInfo.tomorrow) {
        entries.push({
          date: startsAt,
          price: total, // Already in €/kWh from Tibber
        });
      }
    }

    return entries;
  }
}
