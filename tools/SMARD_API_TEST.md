# SMARD API Test Commands

## Step 1: Get available timestamps (index)

```bash
curl -s 'https://www.smard.de/app/chart_data/4169/DE-LU/index_quarterhour.json' | jq '.timestamps[-5:]'
```

This returns the last 5 available timestamps.

## Step 2: Get the latest timestamp

```bash
LATEST=$(curl -s 'https://www.smard.de/app/chart_data/4169/DE-LU/index_quarterhour.json' | jq -r '.timestamps[-1]')
echo $LATEST
```

## Step 3: Fetch price data for the latest timestamp

```bash
curl -s "https://www.smard.de/app/chart_data/4169/DE-LU/4169_DE-LU_quarterhour_${LATEST}.json" | jq '.series[0:5]'
```

This shows the first 5 entries in format: `[timestamp_ms, price_eur_per_mwh]`

## Step 4: Show last 5 entries

```bash
curl -s "https://www.smard.de/app/chart_data/4169/DE-LU/4169_DE-LU_quarterhour_${LATEST}.json" | jq '.series[-5:]'
```

## Step 5: Parse a sample entry with human-readable dates

```bash
curl -s "https://www.smard.de/app/chart_data/4169/DE-LU/4169_DE-LU_quarterhour_${LATEST}.json" | jq -r '.series[0] | "Timestamp: \(.[0]) (\(.[0]/1000 | todateiso8601)), Price: \(.[1]) €/MWh = \(.[1]/1000) €/kWh"'
```

## All-in-one test command

```bash
# Get latest timestamp and fetch data
LATEST=$(curl -s 'https://www.smard.de/app/chart_data/4169/DE-LU/index_quarterhour.json' | jq -r '.timestamps[-1]') && \
echo "Latest timestamp: $LATEST" && \
echo "" && \
echo "First 3 entries:" && \
curl -s "https://www.smard.de/app/chart_data/4169/DE-LU/4169_DE-LU_quarterhour_${LATEST}.json" | jq -r '.series[0:3][] | "\(.[0]/1000 | todateiso8601) - \(.[1]/1000) €/kWh"'
```

## Test without jq (raw JSON)

```bash
# Get index
curl -s 'https://www.smard.de/app/chart_data/4169/DE-LU/index_quarterhour.json'

# Get data (replace TIMESTAMP with actual value from index)
curl -s 'https://www.smard.de/app/chart_data/4169/DE-LU/4169_DE-LU_quarterhour_TIMESTAMP.json'
```

## Market Areas

- DE-LU: 4169
- AT: 4170
- NL: 256
- BE: 4996
- CH: 259
- etc.

Replace `4169` and `DE-LU` in the URLs with the appropriate values for other market areas.


