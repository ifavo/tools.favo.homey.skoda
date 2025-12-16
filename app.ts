'use strict';

import Homey from 'homey';

const BASE_URL = 'https://mysmob.api.connect.skoda-auto.cz';

interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  idToken: string;
}

module.exports = class SkodaApp extends Homey.App {

  private accessToken?: string;
  private accessTokenExpiry?: number;
  private readonly TOKEN_REFRESH_BUFFER = 300000; // 5 minutes before expiry
  private lastTokenRefresh?: number; // Timestamp of last token refresh
  private readonly MIN_REFRESH_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours in milliseconds
  private isRefreshingToken = false; // Flag to prevent recursive refresh calls

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('SkodaApp has been initialized');
    
    // Listen for settings changes
    this.homey.settings.on('set', this.onSettingsChanged.bind(this));
  }

  /**
   * Try to use the stored access token (from settings) first.
   * If missing or expired, refresh.
   */
  async getStoredAccessTokenOrRefresh(): Promise<string> {
    // Prefer in-memory cache if valid
    if (this.accessToken && this.accessTokenExpiry) {
      const now = Date.now();
      if (now < this.accessTokenExpiry - this.TOKEN_REFRESH_BUFFER) {
        return this.accessToken;
      }
    }

    // Try stored token from settings
    const stored = this.homey.settings.get('_last_access_token');
    if (stored && typeof stored === 'string' && stored.length > 0) {
      const exp = this.decodeAccessTokenExpiry(stored);
      if (exp && Date.now() < exp - this.TOKEN_REFRESH_BUFFER) {
        // Cache it for reuse
        this.accessToken = stored;
        this.accessTokenExpiry = exp;
        this.log('[TOKEN] Using stored access token from settings');
        return stored;
      }
      this.log('[TOKEN] Stored access token expired or no exp claim, will refresh');
    }

    // Fallback to normal refresh logic
    return await this.refreshAccessToken(undefined, false);
  }

  /**
   * Decode JWT exp (best-effort, no verification)
   */
  private decodeAccessTokenExpiry(token: string): number | undefined {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      if (payload.exp) {
        return payload.exp * 1000;
      }
    } catch (err) {
      this.log('[TOKEN] Failed to decode token expiry, will treat as expired');
    }
    return undefined;
  }

  /**
   * Handle settings changes
   * Only clears cache - does NOT automatically test token to prevent infinite loops
   */
  async onSettingsChanged(key: string, value: any): Promise<void> {
    this.log(`[SETTINGS CHANGED] Key: ${key}, Event value type: ${typeof value}`);
    
    if (key === 'refresh_token') {
      // Only clear cache if we're not in the middle of refreshing (to prevent loops)
      if (!this.isRefreshingToken) {
        this.log('[SETTINGS] Refresh token changed, clearing cached access token');
        this.accessToken = undefined;
        this.accessTokenExpiry = undefined;
        this.lastTokenRefresh = undefined;
      } else {
        this.log('[SETTINGS] Refresh token changed during token refresh, ignoring to prevent loop');
      }
    } else if (key === '_test_token_flag') {
      // UI requested explicit token test; read actual flag value from settings
      const flagValue = this.homey.settings.get('_test_token_flag');
      this.log(`[SETTINGS] _test_token_flag detected, stored value: ${flagValue}`);

      if (flagValue === true || flagValue === 'true') {
        this.log('[SETTINGS] Explicit token test requested from UI');
        // Clear the flag
        await this.homey.settings.set('_test_token_flag', false);
        
        // Test the token (bypasses rate limiting)
        setTimeout(async () => {
          try {
            const refreshToken = this.homey.settings.get('refresh_token');
            if (refreshToken && typeof refreshToken === 'string' && refreshToken.trim().length > 0) {
              await this.homey.settings.set('_token_error', '');
              const newAccessToken = await this.refreshAccessToken(refreshToken, true); // Force refresh
              await this.homey.settings.set('_last_access_token', newAccessToken);
              this.log('[SETTINGS] Token test completed successfully');
            } else {
              await this.homey.settings.set('_last_access_token', '');
              await this.homey.settings.set('_token_error', 'Refresh token not configured');
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.error('[SETTINGS] Token test failed:', errorMessage);
            await this.homey.settings.set('_last_access_token', '');
            await this.homey.settings.set('_token_error', errorMessage);
          }
        }, 200);
      }
    }
  }

  /**
   * Test refresh token and return access token (for settings view)
   * This is called explicitly from the UI, so it bypasses rate limiting
   */
  async testToken(refreshToken?: string): Promise<{ success: boolean; accessToken?: string; error?: string }> {
    try {
      const token = refreshToken || this.homey.settings.get('refresh_token');
      
      if (!token) {
        return {
          success: false,
          error: 'Refresh token not configured'
        };
      }

      // Clear cached token to force refresh
      this.accessToken = undefined;
      this.accessTokenExpiry = undefined;
      this.lastTokenRefresh = undefined;

      // Temporarily set the refresh token if provided
      if (refreshToken && refreshToken !== this.homey.settings.get('refresh_token')) {
        await this.homey.settings.set('refresh_token', refreshToken);
      }

      // Get access token (will refresh, bypassing rate limit for explicit test)
      const accessToken = await this.refreshAccessToken(token, true);

      return {
        success: true,
        accessToken: accessToken
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.error('Token test failed:', errorMessage);
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Refresh access token using refresh token
   * @param refreshTokenOverride Optional refresh token to use instead of stored one
   * @param forceRefresh If true, bypasses rate limiting (for explicit tests)
   */
  async refreshAccessToken(refreshTokenOverride?: string, forceRefresh: boolean = false): Promise<string> {
    // Check rate limiting (unless forced for explicit test)
    if (!forceRefresh && this.lastTokenRefresh) {
      const timeSinceLastRefresh = Date.now() - this.lastTokenRefresh;
      if (timeSinceLastRefresh < this.MIN_REFRESH_INTERVAL) {
        const remainingMinutes = Math.ceil((this.MIN_REFRESH_INTERVAL - timeSinceLastRefresh) / 60000);
        this.log(`[TOKEN] Rate limit: Only ${remainingMinutes} minute(s) since last refresh. Using cached token if valid.`);
        
        // If we have a valid cached token, return it
        if (this.accessToken && this.accessTokenExpiry) {
          const now = Date.now();
          if (now < this.accessTokenExpiry - this.TOKEN_REFRESH_BUFFER) {
            this.log('[TOKEN] Using cached access token');
            return this.accessToken;
          }
        }
      }
    }

    // Prevent recursive calls
    if (this.isRefreshingToken) {
      this.log('[TOKEN] Already refreshing token, waiting...');
      // Wait a bit and return cached token if available
      if (this.accessToken) {
        return this.accessToken;
      }
      throw new Error('Token refresh already in progress');
    }

    this.isRefreshingToken = true;
    const refreshToken = refreshTokenOverride || this.homey.settings.get('refresh_token');
    
    this.log(`[TOKEN] refreshAccessToken called, override provided: ${!!refreshTokenOverride}, force: ${forceRefresh}`);
    
    try {
      if (!refreshToken) {
        this.error('[TOKEN] Refresh token not configured');
        throw new Error('Refresh token not configured. Please set it in app settings.');
      }

      if (typeof refreshToken !== 'string' || refreshToken.trim().length === 0) {
        this.error('[TOKEN] Refresh token is empty or invalid');
        throw new Error('Refresh token is empty or invalid. Please set a valid refresh token in app settings.');
      }

      const url = `${BASE_URL}/api/v1/authentication/refresh-token?tokenType=CONNECT`;
      
      this.log(`[TOKEN] Refreshing access token from URL: ${url}`);
      this.log(`[TOKEN] Using refresh token: ${refreshToken.substring(0, 10)}...${refreshToken.substring(refreshToken.length - 10)}`);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token: refreshToken,
        }),
      });

      this.log(`[TOKEN] Response status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorText = await response.text();
        const status = response.status;
        
        this.error(`[TOKEN] Token refresh failed with status ${status}: ${errorText}`);
        
        if (status === 401 || status === 403) {
          throw new Error(`Authentication failed (${status}): Your refresh token may be invalid or expired. Please check your refresh token in App Settings.`);
        } else {
          throw new Error(`Token refresh failed (${status}): ${errorText}`);
        }
      }

      const data = await response.json() as TokenResponse;
      this.log(`[TOKEN] Response received, has accessToken: ${!!data.accessToken}, has refreshToken: ${!!data.refreshToken}`);
      
      if (!data.accessToken) {
        this.error('[TOKEN] No access token in response');
        throw new Error('Invalid response from token refresh endpoint: missing access token');
      }
      
      // Cache the access token
      this.accessToken = data.accessToken;
      this.lastTokenRefresh = Date.now();
      this.log(`[TOKEN] Access token refreshed successfully at ${new Date(this.lastTokenRefresh).toISOString()}`);
      
      // Decode JWT to get expiry (without verification)
      try {
        const payload = JSON.parse(Buffer.from(data.accessToken.split('.')[1], 'base64').toString());
        if (payload.exp) {
          this.accessTokenExpiry = payload.exp * 1000; // Convert to milliseconds
          this.log(`[TOKEN] Access token expires at: ${new Date(this.accessTokenExpiry).toISOString()}`);
        }
      } catch (e) {
        // If we can't decode, assume 1 hour expiry
        this.accessTokenExpiry = Date.now() + 3600000;
        this.log('[TOKEN] Could not decode token expiry, assuming 1 hour');
      }

      // Update refresh token if it changed (only update if different to prevent loops)
      if (data.refreshToken && data.refreshToken !== refreshToken) {
        this.log('[TOKEN] Refresh token updated, saving new token');
        // Temporarily set flag to prevent onSettingsChanged from clearing cache
        this.isRefreshingToken = true;
        await this.homey.settings.set('refresh_token', data.refreshToken);
        // Small delay to let the setting save
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Store access token for display in settings
      try {
        await this.homey.settings.set('_last_access_token', data.accessToken);
        await this.homey.settings.set('_token_error', ''); // Clear any previous errors
        this.log('[TOKEN] Access token stored for display');
      } catch (error) {
        this.error('[TOKEN] Failed to store access token for display:', error);
        // Don't fail the whole operation if display storage fails
      }

      return data.accessToken;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.error('[TOKEN] Error refreshing access token:', errorMessage);
      
      // Store error for display in settings
      try {
        await this.homey.settings.set('_token_error', errorMessage);
        await this.homey.settings.set('_last_access_token', '');
      } catch (e) {
        // Ignore storage errors
      }
      
      throw error;
    } finally {
      this.isRefreshingToken = false;
    }
  }

  /**
   * Get access token, refreshing if needed
   * Respects rate limiting (4 hours between refreshes)
   */
  async getAccessToken(): Promise<string> {
    // Check if we have a valid cached token
    if (this.accessToken && this.accessTokenExpiry) {
      const now = Date.now();
      // Return cached token if it's still valid (with buffer)
      if (now < this.accessTokenExpiry - this.TOKEN_REFRESH_BUFFER) {
        // Store for display (fire and forget)
        try {
          await this.homey.settings.set('_last_access_token', this.accessToken);
        } catch (e) {
          // Ignore storage errors
        }
        return this.accessToken;
      }
    }

    // Check rate limiting - only refresh if enough time has passed
    if (this.lastTokenRefresh) {
      const timeSinceLastRefresh = Date.now() - this.lastTokenRefresh;
      if (timeSinceLastRefresh < this.MIN_REFRESH_INTERVAL) {
        const remainingMinutes = Math.ceil((this.MIN_REFRESH_INTERVAL - timeSinceLastRefresh) / 60000);
        this.log(`[TOKEN] Rate limit: Only ${remainingMinutes} minute(s) since last refresh. Using cached token if available.`);
        
        // If we have a cached token (even if expired), try to use it
        if (this.accessToken) {
          this.log('[TOKEN] Using cached token despite rate limit');
          return this.accessToken;
        }
      }
    }

    // Refresh the token (will respect rate limiting internally)
    return await this.refreshAccessToken();
  }

  /**
   * List vehicles from garage
   */
  async listVehicles(accessToken: string): Promise<Array<{ vin: string; name: string }>> {
    this.log('[VEHICLES] listVehicles: preparing request to garage API');
    const url =
      `${BASE_URL}/api/v2/garage?connectivityGenerations=MOD1` +
      `&connectivityGenerations=MOD2&connectivityGenerations=MOD3` +
      `&connectivityGenerations=MOD4`;

    this.log(`[VEHICLES] listVehicles: GET ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    this.log(`[VEHICLES] listVehicles: response status ${response.status}`);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`List vehicles failed ${response.status}: ${text}`);
    }

    const data = await response.json() as { vehicles?: Array<{ vin: string; name: string }> };
    const vehicles = data.vehicles || [];
    this.log(`[VEHICLES] listVehicles: received ${vehicles.length} vehicle(s)`);
    vehicles.slice(0, 5).forEach((v, i) => {
      this.log(`[VEHICLES] vehicle #${i + 1}: name="${v.name || 'Unnamed'}" vin="${v.vin}"`);
    });
    return vehicles;
  }

  /**
   * Get vehicle info (specification, renders, license plate, etc.)
   */
  async getVehicleInfo(accessToken: string, vin: string): Promise<{
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
  }> {
    this.log(`[INFO] Fetching vehicle info for VIN: ${vin}`);
    const url = `${BASE_URL}/api/v2/garage/vehicles/${vin}`;

    this.log(`[INFO] GET ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    this.log(`[INFO] Response status: ${response.status}`);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Get vehicle info failed ${response.status}: ${text}`);
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
    
    this.log(`[INFO] Vehicle info received: name="${data.name || 'Unnamed'}", licensePlate="${data.licensePlate || 'N/A'}"`);
    
    return {
      name: data.name || '',
      licensePlate: data.licensePlate,
      compositeRenders: data.compositeRenders || [],
      specification: data.specification,
    };
  }

}
