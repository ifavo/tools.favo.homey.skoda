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
  // Track which blocks belong to each group
  const groups: Array<{ start: number; end: number; blockCount: number }> = [];

  let currentStart = future[0].start;
  let currentEnd = future[0].end;
  let currentBlockCount = 1;

  for (let i = 1; i < future.length; i++) {
    const block = future[i];

    // If this block starts exactly when the previous one ended, extend the range
    if (block.start === currentEnd) {
      currentEnd = block.end;
      currentBlockCount++;
    } else {
      groups.push({ start: currentStart, end: currentEnd, blockCount: currentBlockCount });
      currentStart = block.start;
      currentEnd = block.end;
      currentBlockCount = 1;
    }
  }

  // Push last group
  groups.push({ start: currentStart, end: currentEnd, blockCount: currentBlockCount });

  return groups
    .map((g) => {
      const startDate = new Date(g.start);
      const endDate = new Date(g.end);

      // If group contains exactly one block, show as single time (not consecutive)
      if (g.blockCount === 1) {
        // Single block: show just the start time (e.g., "11:45")
        return formatTime(startDate, locale, timezone, { ignoreZeroMinutes: false });
      }

      // Consecutive blocks: show range from start to end (e.g., "11:45-12:15")
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
 * - Falls back to UTC format if locale/timezone is invalid
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
  } catch (error) {
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
