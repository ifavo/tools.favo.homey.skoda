/**
 * Tests for Vehicle Status to Capability Mapping
 */

import {
  extractLockedState,
  extractDoorContact,
  extractTrunkContact,
  extractBonnetContact,
  extractWindowContact,
  extractLightContact,
  extractBatteryLevel,
  extractRemainingRange,
  extractChargingPower,
  extractChargingState,
  mapVehicleStatusToCapabilities,
  type CapabilityValues,
} from '../logic/vehicleStatus/capabilityMapping';
import type { VehicleStatus } from '../logic/skodaApi/apiClient';

describe('Vehicle Status to Capability Mapping', () => {
  const createMockVehicleStatus = (overrides: Partial<VehicleStatus> = {}): VehicleStatus => ({
    status: {
      overall: {
        doorsLocked: 'NO',
        locked: 'NO',
        doors: 'CLOSED',
        windows: 'CLOSED',
        lights: 'OFF',
        reliableLockStatus: 'UNLOCKED',
      },
      detail: {
        sunroof: 'CLOSED',
        trunk: 'CLOSED',
        bonnet: 'CLOSED',
      },
      carCapturedTimestamp: '2024-01-01T00:00:00Z',
      ...overrides.status,
    },
    charging: {
      status: {
        chargingRateInKilometersPerHour: 0,
        chargePowerInKw: 0,
        remainingTimeToFullyChargedInMinutes: 0,
        state: 'NOT_CHARGING',
        battery: {
          remainingCruisingRangeInMeters: 0,
          stateOfChargeInPercent: 0,
        },
      },
      settings: {
        targetStateOfChargeInPercent: 100,
        batteryCareModeTargetValueInPercent: 80,
        preferredChargeMode: 'AC',
        availableChargeModes: ['AC'],
        chargingCareMode: 'OFF',
        autoUnlockPlugWhenCharged: 'YES',
        maxChargeCurrentAc: '16A',
      },
      carCapturedTimestamp: '2024-01-01T00:00:00Z',
      errors: [],
      ...overrides.charging,
    },
    timestamp: '2024-01-01T00:00:00Z',
    ...overrides,
  });

  describe('extractLockedState', () => {
    test('returns true when locked is YES', () => {
      const status = createMockVehicleStatus({
        status: {
          overall: {
            locked: 'YES',
            reliableLockStatus: 'UNLOCKED',
          } as any,
        },
      });
      expect(extractLockedState(status.status)).toBe(true);
    });

    test('returns true when reliableLockStatus is LOCKED', () => {
      const status = createMockVehicleStatus({
        status: {
          overall: {
            locked: 'NO',
            reliableLockStatus: 'LOCKED',
          } as any,
        },
      });
      expect(extractLockedState(status.status)).toBe(true);
    });

    test('returns true when both indicate locked', () => {
      const status = createMockVehicleStatus({
        status: {
          overall: {
            locked: 'YES',
            reliableLockStatus: 'LOCKED',
          } as any,
        },
      });
      expect(extractLockedState(status.status)).toBe(true);
    });

    test('returns false when both indicate unlocked', () => {
      const status = createMockVehicleStatus({
        status: {
          overall: {
            locked: 'NO',
            reliableLockStatus: 'UNLOCKED',
          } as any,
        },
      });
      expect(extractLockedState(status.status)).toBe(false);
    });

    test('handles unknown lock states', () => {
      const status = createMockVehicleStatus({
        status: {
          overall: {
            locked: 'UNKNOWN',
            reliableLockStatus: 'UNKNOWN',
          } as any,
        },
      });
      expect(extractLockedState(status.status)).toBe(false);
    });
  });

  describe('extractDoorContact', () => {
    test('returns true when doors are OPEN', () => {
      const status = createMockVehicleStatus({
        status: {
          overall: {
            doors: 'OPEN',
          } as any,
        },
      });
      expect(extractDoorContact(status.status)).toBe(true);
    });

    test('returns false when doors are CLOSED', () => {
      const status = createMockVehicleStatus({
        status: {
          overall: {
            doors: 'CLOSED',
          } as any,
        },
      });
      expect(extractDoorContact(status.status)).toBe(false);
    });

    test('handles unknown door states', () => {
      const status = createMockVehicleStatus({
        status: {
          overall: {
            doors: 'UNKNOWN',
          } as any,
        },
      });
      expect(extractDoorContact(status.status)).toBe(false);
    });
  });

  describe('extractTrunkContact', () => {
    test('returns true when trunk is OPEN', () => {
      const status = createMockVehicleStatus({
        status: {
          detail: {
            trunk: 'OPEN',
          } as any,
        },
      });
      expect(extractTrunkContact(status.status)).toBe(true);
    });

    test('returns false when trunk is CLOSED', () => {
      const status = createMockVehicleStatus({
        status: {
          detail: {
            trunk: 'CLOSED',
          } as any,
        },
      });
      expect(extractTrunkContact(status.status)).toBe(false);
    });
  });

  describe('extractBonnetContact', () => {
    test('returns true when bonnet is OPEN', () => {
      const status = createMockVehicleStatus({
        status: {
          detail: {
            bonnet: 'OPEN',
          } as any,
        },
      });
      expect(extractBonnetContact(status.status)).toBe(true);
    });

    test('returns false when bonnet is CLOSED', () => {
      const status = createMockVehicleStatus({
        status: {
          detail: {
            bonnet: 'CLOSED',
          } as any,
        },
      });
      expect(extractBonnetContact(status.status)).toBe(false);
    });
  });

  describe('extractWindowContact', () => {
    test('returns true when windows are OPEN', () => {
      const status = createMockVehicleStatus({
        status: {
          overall: {
            windows: 'OPEN',
          } as any,
        },
      });
      expect(extractWindowContact(status.status)).toBe(true);
    });

    test('returns false when windows are CLOSED', () => {
      const status = createMockVehicleStatus({
        status: {
          overall: {
            windows: 'CLOSED',
          } as any,
        },
      });
      expect(extractWindowContact(status.status)).toBe(false);
    });
  });

  describe('extractLightContact', () => {
    test('returns true when lights are ON', () => {
      const status = createMockVehicleStatus({
        status: {
          overall: {
            lights: 'ON',
          } as any,
        },
      });
      expect(extractLightContact(status.status)).toBe(true);
    });

    test('returns false when lights are OFF', () => {
      const status = createMockVehicleStatus({
        status: {
          overall: {
            lights: 'OFF',
          } as any,
        },
      });
      expect(extractLightContact(status.status)).toBe(false);
    });

    test('handles unknown light states', () => {
      const status = createMockVehicleStatus({
        status: {
          overall: {
            lights: 'UNKNOWN',
          } as any,
        },
      });
      expect(extractLightContact(status.status)).toBe(false);
    });
  });

  describe('extractBatteryLevel', () => {
    test('extracts battery level correctly', () => {
      const status = createMockVehicleStatus({
        charging: {
          status: {
            battery: {
              stateOfChargeInPercent: 80,
            } as any,
          },
        },
      });
      expect(extractBatteryLevel(status.charging)).toBe(80);
    });

    test('handles zero battery level', () => {
      const status = createMockVehicleStatus({
        charging: {
          status: {
            battery: {
              stateOfChargeInPercent: 0,
            } as any,
          },
        },
      });
      expect(extractBatteryLevel(status.charging)).toBe(0);
    });

    test('handles full battery level', () => {
      const status = createMockVehicleStatus({
        charging: {
          status: {
            battery: {
              stateOfChargeInPercent: 100,
            } as any,
          },
        },
      });
      expect(extractBatteryLevel(status.charging)).toBe(100);
    });

    test('handles fractional battery levels', () => {
      const status = createMockVehicleStatus({
        charging: {
          status: {
            battery: {
              stateOfChargeInPercent: 75.5,
            } as any,
          },
        },
      });
      expect(extractBatteryLevel(status.charging)).toBe(75.5);
    });
  });

  describe('extractRemainingRange', () => {
    test('converts meters to kilometers correctly', () => {
      const status = createMockVehicleStatus({
        charging: {
          status: {
            battery: {
              remainingCruisingRangeInMeters: 300000,
            } as any,
          },
        },
      });
      expect(extractRemainingRange(status.charging)).toBe(300);
    });

    test('rounds to nearest kilometer', () => {
      const status = createMockVehicleStatus({
        charging: {
          status: {
            battery: {
              remainingCruisingRangeInMeters: 305000,
            } as any,
          },
        },
      });
      expect(extractRemainingRange(status.charging)).toBe(305);
    });

    test('handles zero range', () => {
      const status = createMockVehicleStatus({
        charging: {
          status: {
            battery: {
              remainingCruisingRangeInMeters: 0,
            } as any,
          },
        },
      });
      expect(extractRemainingRange(status.charging)).toBe(0);
    });

    test('rounds fractional kilometers correctly', () => {
      const status = createMockVehicleStatus({
        charging: {
          status: {
            battery: {
              remainingCruisingRangeInMeters: 1500,
            } as any,
          },
        },
      });
      expect(extractRemainingRange(status.charging)).toBe(2); // 1.5 km rounds to 2
    });

    test('handles very large ranges', () => {
      const status = createMockVehicleStatus({
        charging: {
          status: {
            battery: {
              remainingCruisingRangeInMeters: 1000000,
            } as any,
          },
        },
      });
      expect(extractRemainingRange(status.charging)).toBe(1000);
    });
  });

  describe('extractChargingPower', () => {
    test('extracts charging power correctly', () => {
      const status = createMockVehicleStatus({
        charging: {
          status: {
            chargePowerInKw: 7.2,
          } as any,
        },
      });
      expect(extractChargingPower(status.charging)).toBe(7.2);
    });

    test('handles zero charging power', () => {
      const status = createMockVehicleStatus({
        charging: {
          status: {
            chargePowerInKw: 0,
          } as any,
        },
      });
      expect(extractChargingPower(status.charging)).toBe(0);
    });

    test('handles high charging power', () => {
      const status = createMockVehicleStatus({
        charging: {
          status: {
            chargePowerInKw: 50,
          } as any,
        },
      });
      expect(extractChargingPower(status.charging)).toBe(50);
    });

    test('handles fractional charging power', () => {
      const status = createMockVehicleStatus({
        charging: {
          status: {
            chargePowerInKw: 3.7,
          } as any,
        },
      });
      expect(extractChargingPower(status.charging)).toBe(3.7);
    });
  });

  describe('extractChargingState', () => {
    test('returns true for CHARGING state', () => {
      const status = createMockVehicleStatus({
        charging: {
          status: {
            state: 'CHARGING',
          } as any,
        },
      });
      expect(extractChargingState(status.charging)).toBe(true);
    });

    test('returns true for CHARGING_AC state', () => {
      const status = createMockVehicleStatus({
        charging: {
          status: {
            state: 'CHARGING_AC',
          } as any,
        },
      });
      expect(extractChargingState(status.charging)).toBe(true);
    });

    test('returns true for CHARGING_DC state', () => {
      const status = createMockVehicleStatus({
        charging: {
          status: {
            state: 'CHARGING_DC',
          } as any,
        },
      });
      expect(extractChargingState(status.charging)).toBe(true);
    });

    test('returns false for NOT_CHARGING state', () => {
      const status = createMockVehicleStatus({
        charging: {
          status: {
            state: 'NOT_CHARGING',
          } as any,
        },
      });
      expect(extractChargingState(status.charging)).toBe(false);
    });

    test('returns false for unknown states', () => {
      const status = createMockVehicleStatus({
        charging: {
          status: {
            state: 'UNKNOWN',
          } as any,
        },
      });
      expect(extractChargingState(status.charging)).toBe(false);
    });

    test('is case sensitive', () => {
      const status = createMockVehicleStatus({
        charging: {
          status: {
            state: 'charging',
          } as any,
        },
      });
      expect(extractChargingState(status.charging)).toBe(false);
    });
  });

  describe('mapVehicleStatusToCapabilities', () => {
    test('maps complete vehicle status correctly', () => {
      const status = createMockVehicleStatus({
        status: {
          overall: {
            locked: 'YES',
            doors: 'OPEN',
            windows: 'CLOSED',
            lights: 'ON',
            reliableLockStatus: 'LOCKED',
          } as any,
          detail: {
            trunk: 'OPEN',
            bonnet: 'CLOSED',
          } as any,
        },
        charging: {
          status: {
            state: 'CHARGING',
            battery: {
              stateOfChargeInPercent: 80,
              remainingCruisingRangeInMeters: 300000,
            } as any,
            chargePowerInKw: 7.2,
          } as any,
        },
      });

      const capabilities = mapVehicleStatusToCapabilities(status);

      expect(capabilities).toEqual({
        locked: true,
        alarm_contact_door: true,
        alarm_contact_trunk: true,
        alarm_contact_bonnet: false,
        alarm_contact_window: false,
        alarm_contact_light: true,
        measure_battery: 80,
        measure_distance: 300,
        measure_power: 7.2,
        onoff: true,
      });
    });

    test('maps all closed/off states correctly', () => {
      const status = createMockVehicleStatus({
        status: {
          overall: {
            locked: 'NO',
            doors: 'CLOSED',
            windows: 'CLOSED',
            lights: 'OFF',
            reliableLockStatus: 'UNLOCKED',
          } as any,
          detail: {
            trunk: 'CLOSED',
            bonnet: 'CLOSED',
          } as any,
        },
        charging: {
          status: {
            state: 'NOT_CHARGING',
            battery: {
              stateOfChargeInPercent: 50,
              remainingCruisingRangeInMeters: 200000,
            } as any,
            chargePowerInKw: 0,
          } as any,
        },
      });

      const capabilities = mapVehicleStatusToCapabilities(status);

      expect(capabilities).toEqual({
        locked: false,
        alarm_contact_door: false,
        alarm_contact_trunk: false,
        alarm_contact_bonnet: false,
        alarm_contact_window: false,
        alarm_contact_light: false,
        measure_battery: 50,
        measure_distance: 200,
        measure_power: 0,
        onoff: false,
      });
    });

    test('handles edge case values', () => {
      const status = createMockVehicleStatus({
        charging: {
          status: {
            battery: {
              stateOfChargeInPercent: 0,
              remainingCruisingRangeInMeters: 500,
            } as any,
            chargePowerInKw: 0.1,
          } as any,
        },
      });

      const capabilities = mapVehicleStatusToCapabilities(status);

      expect(capabilities.measure_battery).toBe(0);
      expect(capabilities.measure_distance).toBe(1); // 500m rounds to 1km
      expect(capabilities.measure_power).toBe(0.1);
    });

    test('handles CHARGING_AC state', () => {
      const status = createMockVehicleStatus({
        charging: {
          status: {
            state: 'CHARGING_AC',
            battery: {
              stateOfChargeInPercent: 50,
              remainingCruisingRangeInMeters: 200000,
            } as any,
            chargePowerInKw: 7.2,
          } as any,
        },
      });

      const capabilities = mapVehicleStatusToCapabilities(status);
      expect(capabilities.onoff).toBe(true);
    });

    test('handles CHARGING_DC state', () => {
      const status = createMockVehicleStatus({
        charging: {
          status: {
            state: 'CHARGING_DC',
            battery: {
              stateOfChargeInPercent: 50,
              remainingCruisingRangeInMeters: 200000,
            } as any,
            chargePowerInKw: 7.2,
          } as any,
        },
      });

      const capabilities = mapVehicleStatusToCapabilities(status);
      expect(capabilities.onoff).toBe(true);
    });
  });
});

