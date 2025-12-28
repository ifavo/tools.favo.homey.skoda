import type { PriceBlock } from './types';

export type ChargingDecision = 'turnOn' | 'turnOff' | 'noChange';

export interface ChargingContext {
  enableLowPrice: boolean;
  batteryLevel: number | null;
  lowBatteryThreshold: number | null;
  manualOverrideActive: boolean;
  wasOnDueToPrice: boolean;
}

/**
 * Decide what to do with charging based on low price logic.
 * Mirrors the logic from `updatePricesAndCheckCharging` without any Homey APIs.
 * @param cheapest - Array of cheapest price blocks
 * @param now - Current timestamp in milliseconds
 * @param context - Charging context with settings and state
 * @returns Charging decision: 'turnOn', 'turnOff', or 'noChange'
 */
export function decideLowPriceCharging(
  cheapest: Array<PriceBlock>,
  now: number,
  context: ChargingContext,
): ChargingDecision {
  const {
    enableLowPrice,
    batteryLevel,
    lowBatteryThreshold,
    manualOverrideActive,
    wasOnDueToPrice,
  } = context;

  if (!enableLowPrice) {
    return 'noChange';
  }

  // Check if current time is in cheap period
  const isCheapNow = cheapest.some((b: PriceBlock) => now >= b.start && now < b.end);

  // Low battery takes priority - check if battery is below threshold
  const isLowBattery = lowBatteryThreshold != null
    && batteryLevel != null
    && lowBatteryThreshold > 0
    && batteryLevel < lowBatteryThreshold;

  if (isLowBattery) {
    return 'noChange';
  }

  // Manual override blocks automation
  if (manualOverrideActive) {
    return 'noChange';
  }

  if (isCheapNow) {
    return 'turnOn';
  }

  if (wasOnDueToPrice) {
    return 'turnOff';
  }

  return 'noChange';
}
