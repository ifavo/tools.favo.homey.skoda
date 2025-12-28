/**
 * Error Handling Utilities
 *
 * Pure functions for error handling and error message extraction.
 * This module is isolated from Homey dependencies to enable comprehensive testing.
 */

/**
 * Extract error message from error object or value
 * @param error - Error object, string, or any value
 * @returns Error message as string
 */
export function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

