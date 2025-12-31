#!/bin/bash
# Test SMARD API with curl commands

echo "=== Step 1: Fetch index to get available timestamps ==="
echo ""
echo "curl -s 'https://www.smard.de/app/chart_data/4169/DE-LU/index_quarterhour.json' | jq '.timestamps | length'"
echo ""
curl -s 'https://www.smard.de/app/chart_data/4169/DE-LU/index_quarterhour.json' | jq '.timestamps | length'

echo ""
echo "=== Step 2: Get last few timestamps ==="
echo ""
echo "curl -s 'https://www.smard.de/app/chart_data/4169/DE-LU/index_quarterhour.json' | jq '.timestamps[-5:]'"
echo ""
curl -s 'https://www.smard.de/app/chart_data/4169/DE-LU/index_quarterhour.json' | jq '.timestamps[-5:]'

echo ""
echo "=== Step 3: Get the latest timestamp ==="
echo ""
LATEST_TIMESTAMP=$(curl -s 'https://www.smard.de/app/chart_data/4169/DE-LU/index_quarterhour.json' | jq -r '.timestamps[-1]')
echo "Latest timestamp: $LATEST_TIMESTAMP"

echo ""
echo "=== Step 4: Fetch data for the latest timestamp ==="
echo ""
echo "curl -s 'https://www.smard.de/app/chart_data/4169/DE-LU/4169_DE-LU_quarterhour_${LATEST_TIMESTAMP}.json' | jq '.series | length'"
echo ""
curl -s "https://www.smard.de/app/chart_data/4169/DE-LU/4169_DE-LU_quarterhour_${LATEST_TIMESTAMP}.json" | jq '.series | length'

echo ""
echo "=== Step 5: Show first 5 data entries ==="
echo ""
echo "curl -s 'https://www.smard.de/app/chart_data/4169/DE-LU/4169_DE-LU_quarterhour_${LATEST_TIMESTAMP}.json' | jq '.series[0:5]'"
echo ""
curl -s "https://www.smard.de/app/chart_data/4169/DE-LU/4169_DE-LU_quarterhour_${LATEST_TIMESTAMP}.json" | jq '.series[0:5]'

echo ""
echo "=== Step 6: Show last 5 data entries ==="
echo ""
echo "curl -s 'https://www.smard.de/app/chart_data/4169/DE-LU/4169_DE-LU_quarterhour_${LATEST_TIMESTAMP}.json' | jq '.series[-5:]'"
echo ""
curl -s "https://www.smard.de/app/chart_data/4169/DE-LU/4169_DE-LU_quarterhour_${LATEST_TIMESTAMP}.json" | jq '.series[-5:]'

echo ""
echo "=== Step 7: Parse a sample entry (timestamp and price) ==="
echo ""
echo "Sample entry format: [timestamp_ms, price_eur_per_mwh]"
echo ""
curl -s "https://www.smard.de/app/chart_data/4169/DE-LU/4169_DE-LU_quarterhour_${LATEST_TIMESTAMP}.json" | jq -r '.series[0] | "Timestamp: \(.[0]) (\(.[0]/1000 | todateiso8601)), Price: \(.[1]) €/MWh = \(.[1]/1000) €/kWh"'

echo ""
echo "=== Step 8: All prices for today (Markdown table) ==="
echo ""
TODAY=$(date +%Y-%m-%d)
echo "Today's date: $TODAY"
echo ""
echo "| Time (UTC) | Price (€/kWh) | Price (€/MWh) |"
echo "|------------|---------------|---------------|"
curl -s "https://www.smard.de/app/chart_data/4169/DE-LU/4169_DE-LU_quarterhour_${LATEST_TIMESTAMP}.json" | jq -r --arg today "$TODAY" '
  def pad_zeros(s; target_len):
    (target_len - (s | length)) as $needed |
    if $needed > 0 then
      s + ([range($needed) | "0"] | join(""))
    else
      s
    end;
  def format_decimal(n; decimals):
    (n * pow(10; decimals) | round) as $rounded |
    (if $rounded < 0 then "-" else "" end) as $sign |
    ($rounded | abs) as $abs_rounded |
    ($abs_rounded | tostring) as $rounded_str |
    ($rounded_str | length) as $rounded_len |
    if $abs_rounded == 0 then
      "0." + ([range(decimals) | "0"] | join(""))
    elif $rounded_len <= decimals then
      $sign + "0." + ([range(decimals - $rounded_len) | "0"] | join("")) + $rounded_str
    else
      ($rounded_str[0:($rounded_len - decimals)] | if . == "" then "0" else . end) as $int_part |
      ($rounded_str[($rounded_len - decimals):] | pad_zeros(.; decimals)) as $frac_part |
      $sign + $int_part + "." + $frac_part
    end;
  .series[] | 
  select(.[1] != null) |
  . as $entry |
  ($entry[0]/1000 | todateiso8601) as $iso |
  ($iso | split("T")[0]) as $date |
  if $date == $today then
    ($iso | split("T")[1] | split(".")[0]) as $time |
    ($entry[1]/1000) as $price_kwh |
    ($price_kwh | format_decimal(.; 5)) as $price_kwh_formatted |
    ($entry[1] | format_decimal(.; 2)) as $price_mwh_formatted |
    "| \($time) | \($price_kwh_formatted) | \($price_mwh_formatted) |"
  else
    empty
  end
'

echo ""
echo "=== Step 9: All prices for tomorrow (Markdown table) ==="
echo ""
TOMORROW=$(date -v+1d +%Y-%m-%d 2>/dev/null || date -d "+1 day" +%Y-%m-%d)
echo "Tomorrow's date: $TOMORROW"
echo ""
echo "| Time (UTC) | Price (€/kWh) | Price (€/MWh) |"
echo "|------------|---------------|---------------|"
curl -s "https://www.smard.de/app/chart_data/4169/DE-LU/4169_DE-LU_quarterhour_${LATEST_TIMESTAMP}.json" | jq -r --arg tomorrow "$TOMORROW" '
  def pad_zeros(s; target_len):
    (target_len - (s | length)) as $needed |
    if $needed > 0 then
      s + ([range($needed) | "0"] | join(""))
    else
      s
    end;
  def format_decimal(n; decimals):
    (n * pow(10; decimals) | round) as $rounded |
    (if $rounded < 0 then "-" else "" end) as $sign |
    ($rounded | abs) as $abs_rounded |
    ($abs_rounded | tostring) as $rounded_str |
    ($rounded_str | length) as $rounded_len |
    if $abs_rounded == 0 then
      "0." + ([range(decimals) | "0"] | join(""))
    elif $rounded_len <= decimals then
      $sign + "0." + ([range(decimals - $rounded_len) | "0"] | join("")) + $rounded_str
    else
      ($rounded_str[0:($rounded_len - decimals)] | if . == "" then "0" else . end) as $int_part |
      ($rounded_str[($rounded_len - decimals):] | pad_zeros(.; decimals)) as $frac_part |
      $sign + $int_part + "." + $frac_part
    end;
  .series[] | 
  select(.[1] != null) |
  . as $entry |
  ($entry[0]/1000 | todateiso8601) as $iso |
  ($iso | split("T")[0]) as $date |
  if $date == $tomorrow then
    ($iso | split("T")[1] | split(".")[0]) as $time |
    ($entry[1]/1000) as $price_kwh |
    ($price_kwh | format_decimal(.; 5)) as $price_kwh_formatted |
    ($entry[1] | format_decimal(.; 2)) as $price_mwh_formatted |
    "| \($time) | \($price_kwh_formatted) | \($price_mwh_formatted) |"
  else
    empty
  end
'

