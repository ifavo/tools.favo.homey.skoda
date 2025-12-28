/**
 * Tests for Skoda API Client
 * 
 * Tests isolated API interaction functions for Skoda Connect API.
 */

import {
  BASE_URL,
  buildStatusUrl,
  buildChargingUrl,
  buildGarageUrl,
  buildVehicleInfoUrl,
  createAuthHeaders,
  extractStatusCode,
  isAuthError,
  parseErrorResponse,
  truncateErrorMessage,
  createApiError,
  fetchVehicleStatus,
  fetchVehicles,
  fetchVehicleInfo,
  type VehicleStatus,
  type Vehicle,
  type VehicleInfo,
  type ApiError,
} from '../logic/skodaApi/apiClient';

// Mock fetch globally
global.fetch = jest.fn();

describe('Skoda API Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
  });

  describe('URL Construction', () => {
    describe('buildStatusUrl', () => {
      test('builds correct status URL', () => {
        const vin = 'TEST123456789';
        const url = buildStatusUrl(vin);
        expect(url).toBe(`${BASE_URL}/api/v2/vehicle-status/${vin}`);
      });

      test('handles VIN with special characters', () => {
        const vin = 'ABC-123_XYZ';
        const url = buildStatusUrl(vin);
        expect(url).toBe(`${BASE_URL}/api/v2/vehicle-status/${vin}`);
      });

      test('handles empty VIN', () => {
        const vin = '';
        const url = buildStatusUrl(vin);
        expect(url).toBe(`${BASE_URL}/api/v2/vehicle-status/`);
      });
    });

    describe('buildChargingUrl', () => {
      test('builds correct charging URL', () => {
        const vin = 'TEST123456789';
        const url = buildChargingUrl(vin);
        expect(url).toBe(`${BASE_URL}/api/v1/charging/${vin}`);
      });

      test('handles different VIN formats', () => {
        const vin = 'WVWZZZ1JZ3W386752';
        const url = buildChargingUrl(vin);
        expect(url).toBe(`${BASE_URL}/api/v1/charging/${vin}`);
      });
    });

    describe('buildGarageUrl', () => {
      test('builds correct garage URL with all connectivity generations', () => {
        const url = buildGarageUrl();
        expect(url).toContain(`${BASE_URL}/api/v2/garage`);
        expect(url).toContain('connectivityGenerations=MOD1');
        expect(url).toContain('connectivityGenerations=MOD2');
        expect(url).toContain('connectivityGenerations=MOD3');
        expect(url).toContain('connectivityGenerations=MOD4');
      });

      test('URL is consistent across calls', () => {
        const url1 = buildGarageUrl();
        const url2 = buildGarageUrl();
        expect(url1).toBe(url2);
      });
    });

    describe('buildVehicleInfoUrl', () => {
      test('builds correct vehicle info URL', () => {
        const vin = 'TEST123456789';
        const url = buildVehicleInfoUrl(vin);
        expect(url).toBe(`${BASE_URL}/api/v2/garage/vehicles/${vin}`);
      });

      test('handles long VIN', () => {
        const vin = 'A'.repeat(50);
        const url = buildVehicleInfoUrl(vin);
        expect(url).toBe(`${BASE_URL}/api/v2/garage/vehicles/${vin}`);
      });
    });
  });

  describe('Header Creation', () => {
    describe('createAuthHeaders', () => {
      test('creates correct authorization headers', () => {
        const token = 'test-token-123';
        const headers = createAuthHeaders(token);
        expect(headers).toEqual({
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        });
      });

      test('handles empty token', () => {
        const token = '';
        const headers = createAuthHeaders(token);
        expect(headers.Authorization).toBe('Bearer ');
      });

      test('handles token with special characters', () => {
        const token = 'token-with_underscores.and.dots';
        const headers = createAuthHeaders(token);
        expect(headers.Authorization).toBe(`Bearer ${token}`);
      });
    });
  });

  describe('Error Handling Utilities', () => {
    describe('extractStatusCode', () => {
      test('extracts status code from error with statusCode property', () => {
        const error = { statusCode: 401 } as ApiError;
        expect(extractStatusCode(error)).toBe(401);
      });

      test('returns undefined for error without statusCode', () => {
        const error = new Error('Test error');
        expect(extractStatusCode(error)).toBeUndefined();
      });

      test('returns undefined for non-object error', () => {
        expect(extractStatusCode('string error')).toBeUndefined();
        expect(extractStatusCode(404)).toBeUndefined();
        expect(extractStatusCode(null)).toBeUndefined();
        expect(extractStatusCode(undefined)).toBeUndefined();
      });

      test('handles different status codes', () => {
        expect(extractStatusCode({ statusCode: 200 } as ApiError)).toBe(200);
        expect(extractStatusCode({ statusCode: 404 } as ApiError)).toBe(404);
        expect(extractStatusCode({ statusCode: 500 } as ApiError)).toBe(500);
      });
    });

    describe('isAuthError', () => {
      test('returns true for 401 error', () => {
        const error = { statusCode: 401 } as ApiError;
        expect(isAuthError(error)).toBe(true);
      });

      test('returns true for 403 error', () => {
        const error = { statusCode: 403 } as ApiError;
        expect(isAuthError(error)).toBe(true);
      });

      test('returns false for non-auth errors', () => {
        expect(isAuthError({ statusCode: 404 } as ApiError)).toBe(false);
        expect(isAuthError({ statusCode: 500 } as ApiError)).toBe(false);
        expect(isAuthError(new Error('Test'))).toBe(false);
        expect(isAuthError('string')).toBe(false);
      });
    });

    describe('truncateErrorMessage', () => {
      test('returns message unchanged when shorter than max length', () => {
        const message = 'Short message';
        expect(truncateErrorMessage(message, 200)).toBe(message);
      });

      test('truncates message when longer than max length', () => {
        const message = 'A'.repeat(300);
        const truncated = truncateErrorMessage(message, 200);
        expect(truncated.length).toBe(200);
        expect(truncated).toBe('A'.repeat(200));
      });

      test('uses default max length of 200', () => {
        const message = 'A'.repeat(300);
        const truncated = truncateErrorMessage(message);
        expect(truncated.length).toBe(200);
      });

      test('handles empty string', () => {
        expect(truncateErrorMessage('', 200)).toBe('');
      });

      test('handles exact boundary length', () => {
        const message = 'A'.repeat(200);
        expect(truncateErrorMessage(message, 200).length).toBe(200);
      });
    });

    describe('createApiError', () => {
      test('creates error with status code', () => {
        const error = createApiError('Test error', 404, 'Not found');
        expect(error.message).toContain('Test error');
        expect(error.message).toContain('404');
        expect(error.statusCode).toBe(404);
      });

      test('creates error without status code', () => {
        const error = createApiError('Test error');
        expect(error.message).toContain('Test error');
        expect(error.statusCode).toBeUndefined();
      });

      test('truncates long response text', () => {
        const longText = 'A'.repeat(300);
        const error = createApiError('Test', 500, longText);
        expect(error.message.length).toBeLessThan(350); // Message + truncated text
      });

      test('handles empty response text', () => {
        const error = createApiError('Test', 404, '');
        expect(error.message).toContain('Test');
        expect(error.statusCode).toBe(404);
      });

      test('handles undefined response text', () => {
        const error = createApiError('Test', 404);
        expect(error.message).toContain('Test');
        expect(error.statusCode).toBe(404);
      });
    });

    describe('parseErrorResponse', () => {
      test('parses error response text', async () => {
        const response = {
          text: jest.fn().mockResolvedValue('Error message'),
        } as unknown as Response;
        const text = await parseErrorResponse(response);
        expect(text).toBe('Error message');
      });

      test('returns fallback when text parsing fails', async () => {
        const response = {
          text: jest.fn().mockRejectedValue(new Error('Parse failed')),
        } as unknown as Response;
        const text = await parseErrorResponse(response);
        expect(text).toBe('Unable to read error response');
      });

      test('handles empty response text', async () => {
        const response = {
          text: jest.fn().mockResolvedValue(''),
        } as unknown as Response;
        const text = await parseErrorResponse(response);
        expect(text).toBe('');
      });
    });
  });

  describe('fetchVehicleStatus', () => {
    const mockAccessToken = 'test-token';
    const mockVin = 'TEST123456789';

    const mockStatusData = {
      overall: {
        doorsLocked: 'YES',
        locked: 'YES',
        doors: 'CLOSED',
        windows: 'CLOSED',
        lights: 'OFF',
        reliableLockStatus: 'LOCKED',
      },
      detail: {
        sunroof: 'CLOSED',
        trunk: 'CLOSED',
        bonnet: 'CLOSED',
      },
      carCapturedTimestamp: '2024-01-01T00:00:00Z',
    };

    const mockChargingData = {
      status: {
        chargingRateInKilometersPerHour: 50,
        chargePowerInKw: 7.2,
        remainingTimeToFullyChargedInMinutes: 120,
        state: 'CHARGING',
        battery: {
          remainingCruisingRangeInMeters: 300000,
          stateOfChargeInPercent: 80,
        },
      },
      settings: {
        targetStateOfChargeInPercent: 100,
        batteryCareModeTargetValueInPercent: 80,
        preferredChargeMode: 'AC',
        availableChargeModes: ['AC', 'DC'],
        chargingCareMode: 'OFF',
        autoUnlockPlugWhenCharged: 'YES',
        maxChargeCurrentAc: '16A',
      },
      carCapturedTimestamp: '2024-01-01T00:00:00Z',
      errors: [],
    };

    test('fetches vehicle status successfully', async () => {
      const mockStatusResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockStatusData),
      } as unknown as Response;

      const mockChargingResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockChargingData),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValueOnce(mockStatusResponse);
      (global.fetch as jest.Mock).mockResolvedValueOnce(mockChargingResponse);

      const result = await fetchVehicleStatus(mockAccessToken, mockVin);

      expect(result.status).toEqual(mockStatusData);
      expect(result.charging).toEqual(mockChargingData);
      expect(result.timestamp).toBeDefined();
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('handles network error', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      await expect(fetchVehicleStatus(mockAccessToken, mockVin)).rejects.toThrow(
        'Network error: Network error',
      );
    });

    test('handles status response error', async () => {
      const mockStatusResponse = {
        ok: false,
        status: 404,
        text: jest.fn().mockResolvedValue('Not found'),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValueOnce(mockStatusResponse);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(mockChargingData),
      } as unknown as Response);

      let error: unknown;
      try {
        await fetchVehicleStatus(mockAccessToken, mockVin);
      } catch (e) {
        error = e;
      }
      expect(error).toBeDefined();
      expect(extractStatusCode(error)).toBe(404);
    });

    test('handles charging response error', async () => {
      const mockStatusResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockStatusData),
      } as unknown as Response;

      const mockChargingResponse = {
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue('Server error'),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValueOnce(mockStatusResponse);
      (global.fetch as jest.Mock).mockResolvedValueOnce(mockChargingResponse);

      let error: unknown;
      try {
        await fetchVehicleStatus(mockAccessToken, mockVin);
      } catch (e) {
        error = e;
      }
      expect(error).toBeDefined();
      expect(extractStatusCode(error)).toBe(500);
    });

    test('handles JSON parse error for status', async () => {
      const mockStatusResponse = {
        ok: true,
        json: jest.fn().mockRejectedValue(new Error('Invalid JSON')),
      } as unknown as Response;

      const mockChargingResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockChargingData),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValueOnce(mockStatusResponse);
      (global.fetch as jest.Mock).mockResolvedValueOnce(mockChargingResponse);

      await expect(fetchVehicleStatus(mockAccessToken, mockVin)).rejects.toThrow(
        'JSON parse error',
      );
    });

    test('handles JSON parse error for charging', async () => {
      const mockStatusResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockStatusData),
      } as unknown as Response;

      const mockChargingResponse = {
        ok: true,
        json: jest.fn().mockRejectedValue(new Error('Invalid JSON')),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValueOnce(mockStatusResponse);
      (global.fetch as jest.Mock).mockResolvedValueOnce(mockChargingResponse);

      await expect(fetchVehicleStatus(mockAccessToken, mockVin)).rejects.toThrow(
        'JSON parse error',
      );
    });

    test('handles 401 authentication error', async () => {
      const mockStatusResponse = {
        ok: false,
        status: 401,
        text: jest.fn().mockResolvedValue('Unauthorized'),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValueOnce(mockStatusResponse);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(mockChargingData),
      } as unknown as Response);

      const error = await fetchVehicleStatus(mockAccessToken, mockVin).catch((e) => e);
      expect(isAuthError(error)).toBe(true);
    });

    test('calls both endpoints in parallel', async () => {
      const mockStatusResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockStatusData),
      } as unknown as Response;

      const mockChargingResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockChargingData),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValueOnce(mockStatusResponse);
      (global.fetch as jest.Mock).mockResolvedValueOnce(mockChargingResponse);

      await fetchVehicleStatus(mockAccessToken, mockVin);

      // Verify both URLs were called
      const calls = (global.fetch as jest.Mock).mock.calls;
      expect(calls.length).toBe(2);
      expect(calls[0][0]).toContain('/vehicle-status/');
      expect(calls[1][0]).toContain('/charging/');
    });
  });

  describe('fetchVehicles', () => {
    const mockAccessToken = 'test-token';

    const mockVehiclesData = {
      vehicles: [
        { vin: 'VIN1', name: 'Vehicle 1' },
        { vin: 'VIN2', name: 'Vehicle 2' },
      ],
    };

    test('fetches vehicles successfully', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockVehiclesData),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await fetchVehicles(mockAccessToken);

      expect(result).toEqual(mockVehiclesData.vehicles);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('returns empty array when vehicles property is missing', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await fetchVehicles(mockAccessToken);

      expect(result).toEqual([]);
    });

    test('returns empty array when vehicles is null', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({ vehicles: null }),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await fetchVehicles(mockAccessToken);

      expect(result).toEqual([]);
    });

    test('handles network error', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      await expect(fetchVehicles(mockAccessToken)).rejects.toThrow();
    });

    test('handles HTTP error response', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue('Server error'),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      let error: unknown;
      try {
        await fetchVehicles(mockAccessToken);
      } catch (e) {
        error = e;
      }
      expect(error).toBeDefined();
      expect(extractStatusCode(error)).toBe(500);
    });

    test('handles 401 authentication error', async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        text: jest.fn().mockResolvedValue('Unauthorized'),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const error = await fetchVehicles(mockAccessToken).catch((e) => e);
      expect(isAuthError(error)).toBe(true);
    });

    test('uses correct URL and headers', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockVehiclesData),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await fetchVehicles(mockAccessToken);

      const call = (global.fetch as jest.Mock).mock.calls[0];
      expect(call[0]).toContain('/api/v2/garage');
      expect(call[1].headers.Authorization).toBe(`Bearer ${mockAccessToken}`);
      expect(call[1].headers['Content-Type']).toBe('application/json');
    });
  });

  describe('fetchVehicleInfo', () => {
    const mockAccessToken = 'test-token';
    const mockVin = 'TEST123456789';

    const mockVehicleInfoData = {
      name: 'My Skoda',
      licensePlate: 'ABC-123',
      compositeRenders: [
        {
          viewType: 'HOME',
          layers: [
            {
              url: 'https://example.com/image.jpg',
              type: 'IMAGE',
              order: 0,
              viewPoint: 'FRONT',
            },
          ],
        },
      ],
      specification: {
        model: 'Enyaq',
        title: 'Skoda Enyaq',
        modelYear: '2024',
      },
    };

    test('fetches vehicle info successfully', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockVehicleInfoData),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await fetchVehicleInfo(mockAccessToken, mockVin);

      expect(result.name).toBe('My Skoda');
      expect(result.licensePlate).toBe('ABC-123');
      expect(result.compositeRenders).toEqual(mockVehicleInfoData.compositeRenders);
      expect(result.specification).toEqual(mockVehicleInfoData.specification);
    });

    test('handles missing optional fields', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          name: 'My Skoda',
        }),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await fetchVehicleInfo(mockAccessToken, mockVin);

      expect(result.name).toBe('My Skoda');
      expect(result.licensePlate).toBeUndefined();
      expect(result.compositeRenders).toEqual([]);
      expect(result.specification).toBeUndefined();
    });

    test('returns empty name when name is missing', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await fetchVehicleInfo(mockAccessToken, mockVin);

      expect(result.name).toBe('');
    });

    test('handles network error', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      await expect(fetchVehicleInfo(mockAccessToken, mockVin)).rejects.toThrow();
    });

    test('handles HTTP error response', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        text: jest.fn().mockResolvedValue('Not found'),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      let error: unknown;
      try {
        await fetchVehicleInfo(mockAccessToken, mockVin);
      } catch (e) {
        error = e;
      }
      expect(error).toBeDefined();
      expect(extractStatusCode(error)).toBe(404);
    });

    test('handles 403 authentication error', async () => {
      const mockResponse = {
        ok: false,
        status: 403,
        text: jest.fn().mockResolvedValue('Forbidden'),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const error = await fetchVehicleInfo(mockAccessToken, mockVin).catch((e) => e);
      expect(isAuthError(error)).toBe(true);
    });

    test('uses correct URL and headers', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockVehicleInfoData),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await fetchVehicleInfo(mockAccessToken, mockVin);

      const call = (global.fetch as jest.Mock).mock.calls[0];
      expect(call[0]).toContain(`/api/v2/garage/vehicles/${mockVin}`);
      expect(call[1].headers.Authorization).toBe(`Bearer ${mockAccessToken}`);
      expect(call[1].headers['Content-Type']).toBe('application/json');
    });

    test('handles null compositeRenders', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          name: 'My Skoda',
          compositeRenders: null,
        }),
      } as unknown as Response;

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await fetchVehicleInfo(mockAccessToken, mockVin);

      expect(result.compositeRenders).toEqual([]);
    });
  });
});

