/**
 * Skoda API Client - Isolated API interaction functions
 *
 * This module contains pure functions for interacting with the Skoda API.
 * It's isolated from Homey dependencies to enable comprehensive testing.
 */

export const BASE_URL = 'https://mysmob.api.connect.skoda-auto.cz';

export interface VehicleStatus {
  status: {
    overall: {
      doorsLocked: string;
      locked: string;
      doors: string;
      windows: string;
      lights: string;
      reliableLockStatus: string;
    };
    detail: {
      sunroof: string;
      trunk: string;
      bonnet: string;
    };
    renders?: {
      lightMode?: {
        oneX?: string;
      };
    };
    carCapturedTimestamp: string;
  };
  charging: {
    status: {
      chargingRateInKilometersPerHour: number;
      chargePowerInKw: number;
      remainingTimeToFullyChargedInMinutes: number;
      state: string;
      battery: {
        remainingCruisingRangeInMeters: number;
        stateOfChargeInPercent: number;
      };
    };
    settings: {
      targetStateOfChargeInPercent: number;
      batteryCareModeTargetValueInPercent: number;
      preferredChargeMode: string;
      availableChargeModes: string[];
      chargingCareMode: string;
      autoUnlockPlugWhenCharged: string;
      maxChargeCurrentAc: string;
    };
    carCapturedTimestamp: string;
    errors: unknown[];
  };
  timestamp: string;
}

export interface Vehicle {
  vin: string;
  name: string;
}

export interface VehicleInfo {
  name: string;
  licensePlate?: string;
  compositeRenders?: Array<{
    viewType: string;
    layers: Array<{ url: string; type: string; order: number; viewPoint: string }>;
  }>;
  specification?: {
    model?: string;
    title?: string;
    modelYear?: string;
  };
}

export interface ApiError extends Error {
  statusCode?: number;
}

/**
 * Build status URL for vehicle status endpoint
 */
export function buildStatusUrl(vin: string): string {
  return `${BASE_URL}/api/v2/vehicle-status/${vin}`;
}

/**
 * Build charging URL for vehicle charging endpoint
 */
export function buildChargingUrl(vin: string): string {
  return `${BASE_URL}/api/v1/charging/${vin}`;
}

/**
 * Build garage URL for listing vehicles
 */
export function buildGarageUrl(): string {
  return `${BASE_URL}/api/v2/garage?connectivityGenerations=MOD1`
    + '&connectivityGenerations=MOD2&connectivityGenerations=MOD3'
    + '&connectivityGenerations=MOD4';
}

/**
 * Build vehicle info URL
 */
export function buildVehicleInfoUrl(vin: string): string {
  return `${BASE_URL}/api/v2/garage/vehicles/${vin}`;
}

/**
 * Create authorization headers
 */
export function createAuthHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Extract status code from error if available
 */
export function extractStatusCode(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    return (error as { statusCode: number }).statusCode;
  }
  return undefined;
}

/**
 * Check if error is an authentication error (401 or 403)
 */
export function isAuthError(error: unknown): boolean {
  const statusCode = extractStatusCode(error);
  return statusCode === 401 || statusCode === 403;
}

/**
 * Parse error response text with fallback
 */
export async function parseErrorResponse(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (_error) {
    return 'Unable to read error response';
  }
}

/**
 * Truncate error message to max length
 */
export function truncateErrorMessage(message: string, maxLength: number = 200): string {
  return message.length > maxLength ? message.substring(0, maxLength) : message;
}

/**
 * Create API error with status code
 */
export function createApiError(
  message: string,
  statusCode?: number,
  responseText?: string,
): ApiError {
  const errorText = responseText ? truncateErrorMessage(responseText) : '';
  const fullMessage = statusCode
    ? `${message} ${statusCode}: ${errorText}`
    : `${message}: ${errorText || 'Unknown error'}`;
  const error = new Error(fullMessage) as ApiError;
  if (statusCode) {
    error.statusCode = statusCode;
  }
  return error;
}

/**
 * Fetch vehicle status and charging info in parallel
 */
export async function fetchVehicleStatus(
  accessToken: string,
  vin: string,
  fetchFn: typeof fetch = fetch,
): Promise<VehicleStatus> {
  const statusUrl = buildStatusUrl(vin);
  const chargingUrl = buildChargingUrl(vin);
  const headers = createAuthHeaders(accessToken);

  let statusResponse: Response;
  let chargingResponse: Response;

  try {
    [statusResponse, chargingResponse] = await Promise.all([
      fetchFn(statusUrl, {
        method: 'GET',
        headers,
      }),
      fetchFn(chargingUrl, {
        method: 'GET',
        headers,
      }),
    ]);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Network error: ${errorMessage}`);
  }

  if (!statusResponse.ok) {
    const text = await parseErrorResponse(statusResponse);
    throw createApiError('Get status failed', statusResponse.status, text);
  }

  if (!chargingResponse.ok) {
    const text = await parseErrorResponse(chargingResponse);
    throw createApiError('Get charging status failed', chargingResponse.status, text);
  }

  try {
    const status = await statusResponse.json() as VehicleStatus['status'];
    const charging = await chargingResponse.json() as VehicleStatus['charging'];

    return {
      status,
      charging,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`JSON parse error: ${errorMessage}`);
  }
}

/**
 * Fetch list of vehicles from garage
 */
export async function fetchVehicles(
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<Vehicle[]> {
  const url = buildGarageUrl();
  const headers = createAuthHeaders(accessToken);

  const response = await fetchFn(url, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    const text = await parseErrorResponse(response);
    throw createApiError('List vehicles failed', response.status, text);
  }

  const data = await response.json() as { vehicles?: Vehicle[] };
  return data.vehicles || [];
}

/**
 * Fetch vehicle info (specification, renders, license plate, etc.)
 */
export async function fetchVehicleInfo(
  accessToken: string,
  vin: string,
  fetchFn: typeof fetch = fetch,
): Promise<VehicleInfo> {
  const url = buildVehicleInfoUrl(vin);
  const headers = createAuthHeaders(accessToken);

  const response = await fetchFn(url, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    const text = await parseErrorResponse(response);
    throw createApiError('Get vehicle info failed', response.status, text);
  }

  const data = await response.json() as {
    name?: string;
    licensePlate?: string;
    compositeRenders?: Array<{
      viewType: string;
      layers: Array<{ url: string; type: string; order: number; viewPoint: string }>;
    }>;
    specification?: {
      model?: string;
      title?: string;
      modelYear?: string;
    };
  };

  return {
    name: data.name || '',
    licensePlate: data.licensePlate,
    compositeRenders: data.compositeRenders || [],
    specification: data.specification,
  };
}
