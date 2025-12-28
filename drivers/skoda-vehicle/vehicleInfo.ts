import type Homey from 'homey';
import type { VehicleStatus } from '../../logic/skodaApi/apiClient';
import { extractErrorMessage } from '../../logic/utils/errorUtils';
import { resolveVin, getAccessToken } from './deviceHelpers';

/**
 * Vehicle info management module for handling vehicle information and image updates
 */

/**
 * Update device image from stored URL (from vehicle info)
 * @param device - Homey device instance
 * @param imageUrl - URL of the vehicle image
 */
export async function updateDeviceImageFromUrl(device: Homey.Device, imageUrl: string): Promise<void> {
  if (!imageUrl || typeof imageUrl !== 'string' || imageUrl.length === 0) {
    device.log('[IMAGE] Invalid image URL provided');
    return;
  }

  device.log(`[IMAGE] Image URL: ${imageUrl}`);
  device.log('[IMAGE] Updating device image');

  try {
    // Create an Image instance using Homey SDK 3 Image API
    const myImage = await device.homey.images.createImage();

    // Set the image URL
    myImage.setUrl(imageUrl);

    // Update the image
    await myImage.update();

    // Assign the image to the device as background
    await device.setAlbumArtImage(myImage);

    device.log(`[IMAGE] Device background image set successfully with URL: ${imageUrl}`);
  } catch (imageError: unknown) {
    const errorMessage = extractErrorMessage(imageError);
    device.error(`[IMAGE] Failed to set device image with URL ${imageUrl}:`, errorMessage);
  }
}

/**
 * Update device image from stored URL (called during status updates)
 * Uses the image URL stored from vehicle info endpoint
 * @param device - Homey device instance
 * @param status - Vehicle status object
 */
export async function updateDeviceImage(device: Homey.Device, status: VehicleStatus): Promise<void> {
  try {
    // Try to get image URL from stored settings (from vehicle info endpoint)
    const storedImageUrl = device.getSetting('_vehicle_image_url') as string | undefined;

    if (storedImageUrl && typeof storedImageUrl === 'string' && storedImageUrl.length > 0) {
      // Use stored image URL from vehicle info
      await updateDeviceImageFromUrl(device, storedImageUrl);
    } else {
      // Fallback: try to get from status (though this is usually broken)
      const imageUrl = status.status.renders?.lightMode?.oneX;
      if (imageUrl && typeof imageUrl === 'string' && imageUrl.length > 0) {
        device.log(`[IMAGE] Using fallback image URL from status: ${imageUrl}`);
        await updateDeviceImageFromUrl(device, imageUrl);
      } else {
        device.log('[IMAGE] No image URL available (neither from stored info nor status)');
      }
    }
  } catch (error: unknown) {
    const errorMessage = extractErrorMessage(error);
    device.error('[IMAGE] Failed to update device image:', errorMessage);
    // Don't throw - image update failure shouldn't break status updates
  }
}

/**
 * Fetch and update vehicle info (specification, renders, license plate, etc.) with error recovery
 * @param device - Homey device instance
 */
export async function refreshVehicleInfo(device: Homey.Device): Promise<void> {
  try {
    const vin = resolveVin(device);
    if (!vin) {
      device.log('[INFO] VIN not available, skipping vehicle info fetch');
      return;
    }

    device.log(`[INFO] Fetching vehicle info for VIN: ${vin}`);

    let accessToken: string;
    try {
      accessToken = await getAccessToken(device);
    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      device.error('[INFO] Failed to get access token for vehicle info:', errorMessage);
      throw error; // Re-throw - can't proceed without token
    }

    // Use central auth recovery for getVehicleInfo
    const app = device.homey.app as unknown as {
      executeWithAuthRecovery?: <T>(apiCall: (token: string) => Promise<T>, context?: string) => Promise<T>;
      getVehicleInfo: (token: string, vin: string) => Promise<{
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
      }>;
    };
    let info: {
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
    };
    try {
      if (app && typeof app.executeWithAuthRecovery === 'function') {
        info = await app.executeWithAuthRecovery(async (token: string) => {
          return app.getVehicleInfo(token, vin);
        }, 'INFO');
      } else {
        // Fallback to direct call if recovery function not available
        info = await app.getVehicleInfo(accessToken, vin);
      }
    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      device.error('[INFO] Failed to fetch vehicle info from API:', errorMessage);
      throw error; // Re-throw - can't proceed without info
    }

    // Store license plate
    if (info.licensePlate) {
      await device.setSettings({
        license_plate: info.licensePlate,
      }).catch((error: unknown) => {
        device.error('[INFO] Failed to store license plate:', extractErrorMessage(error));
      });
      device.log(`[INFO] License plate stored: ${info.licensePlate}`);
    }

    // Store vehicle name if different
    if (info.name) {
      const currentName = device.getName();
      if (currentName !== info.name) {
        await device.setSettings({
          vehicle_name: info.name,
        }).catch((error: unknown) => {
          device.error('[INFO] Failed to store vehicle name:', extractErrorMessage(error));
        });
        device.log(`[INFO] Vehicle name stored: ${info.name}`);
      }
    }

    // Store specification data
    if (info.specification) {
      await device.setSettings({
        vehicle_model: info.specification.model || '',
        vehicle_title: info.specification.title || '',
        vehicle_model_year: info.specification.modelYear || '',
      }).catch((error: unknown) => {
        device.error('[INFO] Failed to store vehicle specification:', extractErrorMessage(error));
      });
      device.log(`[INFO] Vehicle specification stored: ${info.specification.model || 'N/A'}`);
    }

    // Extract and store image URL from composite_renders
    // Prefer HOME view, fallback to UNMODIFIED_EXTERIOR_SIDE
    let imageUrl: string | undefined;

    if (info.compositeRenders && info.compositeRenders.length > 0) {
      // Try HOME view first
      const homeRender = info.compositeRenders.find((r: { viewType: string }) => r.viewType === 'HOME');
      if (homeRender && homeRender.layers && homeRender.layers.length > 0) {
        // Get the base layer (order 0)
        const baseLayer = homeRender.layers.find((l: { order: number }) => l.order === 0);
        if (baseLayer && baseLayer.url) {
          imageUrl = baseLayer.url;
          device.log('[INFO] Found HOME view image URL');
        }
      }

      // Fallback to UNMODIFIED_EXTERIOR_SIDE
      if (!imageUrl) {
        const sideRender = info.compositeRenders.find((r: { viewType: string }) => r.viewType === 'UNMODIFIED_EXTERIOR_SIDE');
        if (sideRender && sideRender.layers && sideRender.layers.length > 0) {
          const baseLayer = sideRender.layers.find((l: { order: number }) => l.order === 0);
          if (baseLayer && baseLayer.url) {
            imageUrl = baseLayer.url;
            device.log('[INFO] Found UNMODIFIED_EXTERIOR_SIDE view image URL');
          }
        }
      }
    }

    if (imageUrl) {
      device.log(`[INFO] Image URL from vehicle info: ${imageUrl}`);
      await device.setSettings({
        _vehicle_image_url: imageUrl,
      }).catch((error: unknown) => {
        device.error('[INFO] Failed to store vehicle image URL:', extractErrorMessage(error));
      });

      // Update device image immediately
      await updateDeviceImageFromUrl(device, imageUrl);
    } else {
      device.log('[INFO] No image URL found in composite_renders');
    }

    // Store last fetch timestamp
    await device.setSettings({
      _last_info_fetch: Date.now(),
    }).catch((error: unknown) => {
      device.error('[INFO] Failed to store last info fetch timestamp:', extractErrorMessage(error));
    });

    device.log('[INFO] Vehicle info refreshed successfully');
  } catch (error: unknown) {
    const errorMessage = extractErrorMessage(error);
    device.error('[INFO] Failed to refresh vehicle info:', errorMessage);
    // Don't throw - info update failure shouldn't break device operation
  }
}

