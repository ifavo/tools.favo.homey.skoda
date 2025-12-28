import type Homey from 'homey';
import { extractErrorMessage } from '../../logic/utils/errorUtils';

/**
 * Device helper functions for common operations
 * These functions work with the device instance to provide reusable utilities
 */

/**
 * Resolve VIN from multiple sources (store, data, settings)
 * Priority: store > data > settings
 * @param device - Homey device instance
 * @returns VIN string if found, undefined otherwise
 */
export function resolveVin(device: Homey.Device): string | undefined {
  return device.getStoreValue('vin') || device.getData().vin || device.getSetting('vin');
}

/**
 * Get setting value with default fallback
 * @param device - Homey device instance
 * @param key - Setting key to retrieve
 * @param defaultValue - Default value if setting is not found
 * @returns Setting value or default value
 */
export function getSettingWithDefault<T>(device: Homey.Device, key: string, defaultValue: T): T {
  return (device.getSetting(key) as T | undefined) ?? defaultValue;
}

/**
 * Safely update a capability value, logging errors without throwing
 * @param device - Homey device instance
 * @param capabilityId - Capability ID to update
 * @param value - Value to set
 * @param context - Context string for error logging
 */
export async function updateCapabilitySafely(
  device: Homey.Device,
  capabilityId: string,
  value: unknown,
  context: string,
): Promise<void> {
  try {
    await device.setCapabilityValue(capabilityId, value);
  } catch (error: unknown) {
    device.error(`[${context}] Failed to update ${capabilityId}:`, extractErrorMessage(error));
  }
}

/**
 * Get access token from app with error handling
 * @param device - Homey device instance
 * @returns Access token string
 * @throws Error if access token cannot be retrieved
 */
export async function getAccessToken(device: Homey.Device): Promise<string> {
  try {
    const app = device.homey.app as unknown as { getAccessToken: () => Promise<string> };
    return await app.getAccessToken();
  } catch (error: unknown) {
    const errorMessage = extractErrorMessage(error);
    device.error('[TOKEN] Failed to get access token:', errorMessage);
    throw new Error(`Access token error: ${errorMessage}`);
  }
}

/**
 * Get locale from Homey i18n or fallback to system default
 * @param device - Homey device instance
 * @returns Locale string (e.g., 'en-US', 'de-DE')
 */
export function getLocale(device: Homey.Device): string {
  try {
    const language = device.homey.i18n.getLanguage();
    // Convert Homey language code (e.g., 'en', 'de') to locale format (e.g., 'en-US', 'de-DE')
    if (language && language.length >= 2) {
      // If language is already in locale format (e.g., 'de-DE'), use it
      if (language.includes('-')) {
        return language;
      }
      // Otherwise, try to construct locale (default to same country code)
      const countryCode = language.toUpperCase();
      return `${language}-${countryCode}`;
    }
  } catch (error: unknown) {
    device.log('[LOCALE] Could not get locale from Homey i18n, using system default');
  }
  // Fallback to system locale
  return Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';
}

/**
 * Get timezone from Homey clock or fallback to system default
 * @param device - Homey device instance
 * @returns Timezone string (e.g., 'Europe/Berlin', 'UTC')
 */
export function getTimezone(device: Homey.Device): string {
  try {
    return device.homey.clock.getTimezone();
  } catch (error: unknown) {
    device.log('[TIMEZONE] Could not get timezone from Homey clock, using system default');
  }
  // Fallback to system timezone
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
