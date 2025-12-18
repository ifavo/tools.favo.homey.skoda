/* Helper script to inspect priceCache.json and print a markdown table
 * with all price blocks and the cheapest hours per day.
 *
 * Usage (from project root):
 *   node tests/tools/priceCacheReport.js
 */

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '../assets/priceCache.json');

function loadBlocks() {
  const raw = fs.readFileSync(DATA_PATH, 'utf8');
  return JSON.parse(raw);
}

function formatLocal(date, timeZone) {
  return date.toLocaleString('de-DE', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  });
}

function main() {
  const blocks = loadBlocks();
  const timeZone = 'Europe/Vienna';

  // Group by UTC day (to match current algorithm behaviour)
  const byDay = new Map();

  for (const b of blocks) {
    const d = new Date(b.start);
    const dayKey = d.toISOString().slice(0, 10); // YYYY-MM-DD
    if (!byDay.has(dayKey)) {
      byDay.set(dayKey, []);
    }
    byDay.get(dayKey).push(b);
  }

  for (const [day, dayBlocks] of [...byDay.entries()].sort()) {
    dayBlocks.sort((a, b) => a.start - b.start);

    const minPrice = dayBlocks.reduce(
      (min, b) => (b.price < min ? b.price : min),
      Number.POSITIVE_INFINITY,
    );

    console.log(`\n### ${day}`);
    console.log();
    console.log('| Start (local) | End (local) | Price | Cheapest in day |');
    console.log('| --- | --- | --- | --- |');

    for (const b of dayBlocks) {
      const startDate = new Date(b.start);
      const endDate = new Date(b.end);
      const startLocal = formatLocal(startDate, timeZone);
      const endLocal = formatLocal(endDate, timeZone);
      const isCheapest = b.price === minPrice;
      console.log(
        `| ${startLocal} | ${endLocal} | ${b.price.toFixed(5)} | ${
          isCheapest ? '✅' : ''
        } |`,
      );
    }
  }
}

main();


