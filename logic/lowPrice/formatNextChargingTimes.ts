import type { PriceBlock } from './types';

export interface FormatOptions {
  now: number;
  locale: string;
  timezone: string;
}

/**
 * Format the "next charging times" string from cheapest price blocks.
 * - Groups consecutive 15-minute blocks into ranges
 * - Example: 11:00, 11:15, 11:30 -> "11:00–11:30"
 */
export function formatNextChargingTimes(
  cheapest: Array<PriceBlock>,
  options: FormatOptions,
): string {
  const { now, locale, timezone } = options;

  const future = cheapest
    .filter((b) => b.start > now)
    .sort((a, b) => a.start - b.start);

  if (future.length === 0) {
    return 'Unknown';
  }

  // Group consecutive 15-minute blocks into ranges
  const groups: Array<{ start: number; end: number }> = [];

  let currentStart = future[0].start;
  let currentEnd = future[0].end;

  for (let i = 1; i < future.length; i++) {
    const block = future[i];

    // If this block starts exactly when the previous one ended, extend the range
    if (block.start === currentEnd) {
      currentEnd = block.end;
    } else {
      groups.push({ start: currentStart, end: currentEnd });
      currentStart = block.start;
      currentEnd = block.end;
    }
  }

  // Push last group
  groups.push({ start: currentStart, end: currentEnd });

  return groups
    .map((g) => {
      const startDate = new Date(g.start);
      const endDate = new Date(g.end);

      // If range is exactly one 15-minute block, show as single time
      const blockDurationMs = 15 * 60 * 1000; // 15 minutes
      if (g.end - g.start === blockDurationMs) {
        return formatTime(startDate, locale, timezone, { ignoreZeroMinutes: false });
      }

      // Timeframe: show full start and end times for 15-minute blocks
      const startStr = formatTime(startDate, locale, timezone, { ignoreZeroMinutes: false });
      const endStr = formatTime(endDate, locale, timezone, { ignoreZeroMinutes: false });

      return `${startStr}–${endStr}`;
    })
    .join(', ');
}

interface FormatTimeOptions {
  ignoreZeroMinutes?: boolean;
}

/**
 * Format time for display.
 * - Uses locale and timezone
 * - Optionally hides ":00" minutes when they are exactly zero
 */
export function formatTime(
  date: Date,
  locale: string,
  timezone: string,
  options: FormatTimeOptions = {},
): string {
  const str = date.toLocaleString(locale, {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  });

  // If we don't ignore zero minutes, return as-is
  if (!options.ignoreZeroMinutes) {
    return str;
  }

  // If the string ends with ":00" (e.g. "11:00"), drop the minutes
  if (str.endsWith(':00')) {
    return str.slice(0, -3);
  }

  // If it contains ":00 " in the middle (e.g. "11:00 PM"), drop the minutes but keep the suffix
  if (str.includes(':00 ')) {
    return str.replace(':00 ', ' ');
  }

  return str;
}




