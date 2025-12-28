import type { PriceBlock } from './types';

export interface FormatOptions {
  now: number;
  locale: string;
  timezone: string;
}

/**
 * Format the "next charging times" string from cheapest price blocks.
 * - Groups consecutive 15-minute blocks into ranges
 * - Includes current period if we're currently in a cheapest period
 * - Example: 11:00, 11:15, 11:30 -> "11:00–11:30"
 * @param cheapest - Array of cheapest price blocks
 * @param options - Format options with now, locale, and timezone
 * @returns Formatted string with charging times (e.g., "11:00–11:30, 14:00")
 */
export function formatNextChargingTimes(
  cheapest: Array<PriceBlock>,
  options: FormatOptions,
): string {
  const { now, locale, timezone } = options;

  // Include current period (if we're in it) and future periods
  // This ensures display stays synchronized with charging toggle
  const relevant = cheapest
    .filter((b) => b.end > now) // Include blocks that haven't ended yet
    .sort((a, b) => a.start - b.start);

  if (relevant.length === 0) {
    return 'Unknown';
  }

  // Group consecutive 15-minute blocks into ranges
  // Track which blocks belong to each group
  const groups: Array<{ start: number; end: number; blockCount: number; isCurrent: boolean }> = [];

  let currentStart = relevant[0].start;
  let currentEnd = relevant[0].end;
  let currentBlockCount = 1;

  for (let i = 1; i < relevant.length; i++) {
    const block = relevant[i];

    // If this block starts exactly when the previous one ended, extend the range
    if (block.start === currentEnd) {
      currentEnd = block.end;
      currentBlockCount++;
    } else {
      // Check if current group is the active period
      const isCurrent = currentStart <= now && now < currentEnd;
      groups.push({ 
        start: currentStart, 
        end: currentEnd, 
        blockCount: currentBlockCount,
        isCurrent,
      });
      currentStart = block.start;
      currentEnd = block.end;
      currentBlockCount = 1;
    }
  }

  // Push last group
  const lastIsCurrent = currentStart <= now && now < currentEnd;
  groups.push({ 
    start: currentStart, 
    end: currentEnd, 
    blockCount: currentBlockCount,
    isCurrent: lastIsCurrent,
  });

  return groups
    .map((g) => {
      const startDate = new Date(g.start);
      const endDate = new Date(g.end);

      // If group contains exactly one block, show as single time (not consecutive)
      if (g.blockCount === 1) {
        // Single block: show just the start time (e.g., "11:45" or "Now: 11:45")
        const timeStr = formatTime(startDate, locale, timezone, { ignoreZeroMinutes: false });
        return g.isCurrent ? `Now: ${timeStr}` : timeStr;
      }

      // Consecutive blocks: show range from start to end (e.g., "11:45-12:15" or "Now: 11:45-12:15")
      const startStr = formatTime(startDate, locale, timezone, { ignoreZeroMinutes: false });
      const endStr = formatTime(endDate, locale, timezone, { ignoreZeroMinutes: false });
      const rangeStr = `${startStr}–${endStr}`;

      return g.isCurrent ? `Now: ${rangeStr}` : rangeStr;
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
 * - Falls back to UTC format if locale/timezone is invalid
 * @param date - Date object to format
 * @param locale - Locale string (e.g., 'en-US', 'de-DE')
 * @param timezone - Timezone string (e.g., 'Europe/Berlin', 'UTC')
 * @param options - Format options (ignoreZeroMinutes)
 * @returns Formatted time string (e.g., "11:00" or "11:00 PM")
 */
export function formatTime(
  date: Date,
  locale: string,
  timezone: string,
  options: FormatTimeOptions = {},
): string {
  let str: string;
  try {
    str = date.toLocaleString(locale, {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (error: unknown) {
    // Fall back to UTC format if locale or timezone is invalid
    str = date.toLocaleString('en-US', {
      timeZone: 'UTC',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

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
