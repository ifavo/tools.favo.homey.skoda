/**
 * Tests for Charging Control State
 * 
 * Tests the ChargingControlStateImpl class that manages in-memory state
 * for low battery and low price charging control.
 */

import { ChargingControlStateImpl } from '../drivers/skoda-vehicle/chargingControlState';
import type Homey from 'homey';

describe('Charging Control State', () => {
  // Mock Homey.Device
  const createMockDevice = (): Homey.Device => {
    return {
      getStoreValue: jest.fn(),
      getData: jest.fn(),
      getSetting: jest.fn(),
      setSettings: jest.fn(),
      setCapabilityValue: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      homey: {} as Homey.Homey,
    } as unknown as Homey.Device;
  };

  describe('ChargingControlStateImpl', () => {
    test('initializes with default values', () => {
      const device = createMockDevice();
      const manualOverrideDuration = 15 * 60 * 1000; // 15 minutes
      const state = new ChargingControlStateImpl(device, manualOverrideDuration);

      expect(state.lowBatteryDeviceEnabled).toBe(false);
      expect(state.lowPriceDeviceEnabled).toBe(false);
      expect(state.getManualOverrideDuration()).toBe(manualOverrideDuration);
    });

    test('stores manual override duration correctly', () => {
      const device = createMockDevice();
      const duration1 = 10 * 60 * 1000; // 10 minutes
      const duration2 = 30 * 60 * 1000; // 30 minutes

      const state1 = new ChargingControlStateImpl(device, duration1);
      const state2 = new ChargingControlStateImpl(device, duration2);

      expect(state1.getManualOverrideDuration()).toBe(duration1);
      expect(state2.getManualOverrideDuration()).toBe(duration2);
    });

    describe('setLowBatteryEnabled', () => {
      test('sets low battery enabled to true', () => {
        const device = createMockDevice();
        const state = new ChargingControlStateImpl(device, 15 * 60 * 1000);

        state.setLowBatteryEnabled(true);
        expect(state.lowBatteryDeviceEnabled).toBe(true);
      });

      test('sets low battery enabled to false', () => {
        const device = createMockDevice();
        const state = new ChargingControlStateImpl(device, 15 * 60 * 1000);

        state.setLowBatteryEnabled(false);
        expect(state.lowBatteryDeviceEnabled).toBe(false);
      });

      test('can toggle low battery enabled state', () => {
        const device = createMockDevice();
        const state = new ChargingControlStateImpl(device, 15 * 60 * 1000);

        expect(state.lowBatteryDeviceEnabled).toBe(false);
        state.setLowBatteryEnabled(true);
        expect(state.lowBatteryDeviceEnabled).toBe(true);
        state.setLowBatteryEnabled(false);
        expect(state.lowBatteryDeviceEnabled).toBe(false);
      });
    });

    describe('setLowPriceEnabled', () => {
      test('sets low price enabled to true', () => {
        const device = createMockDevice();
        const state = new ChargingControlStateImpl(device, 15 * 60 * 1000);

        state.setLowPriceEnabled(true);
        expect(state.lowPriceDeviceEnabled).toBe(true);
      });

      test('sets low price enabled to false', () => {
        const device = createMockDevice();
        const state = new ChargingControlStateImpl(device, 15 * 60 * 1000);

        state.setLowPriceEnabled(false);
        expect(state.lowPriceDeviceEnabled).toBe(false);
      });

      test('can toggle low price enabled state', () => {
        const device = createMockDevice();
        const state = new ChargingControlStateImpl(device, 15 * 60 * 1000);

        expect(state.lowPriceDeviceEnabled).toBe(false);
        state.setLowPriceEnabled(true);
        expect(state.lowPriceDeviceEnabled).toBe(true);
        state.setLowPriceEnabled(false);
        expect(state.lowPriceDeviceEnabled).toBe(false);
      });
    });

    test('low battery and low price states are independent', () => {
      const device = createMockDevice();
      const state = new ChargingControlStateImpl(device, 15 * 60 * 1000);

      // Set low battery to true, low price should remain false
      state.setLowBatteryEnabled(true);
      expect(state.lowBatteryDeviceEnabled).toBe(true);
      expect(state.lowPriceDeviceEnabled).toBe(false);

      // Set low price to true, low battery should remain true
      state.setLowPriceEnabled(true);
      expect(state.lowBatteryDeviceEnabled).toBe(true);
      expect(state.lowPriceDeviceEnabled).toBe(true);

      // Set low battery to false, low price should remain true
      state.setLowBatteryEnabled(false);
      expect(state.lowBatteryDeviceEnabled).toBe(false);
      expect(state.lowPriceDeviceEnabled).toBe(true);
    });

    test('handles zero duration', () => {
      const device = createMockDevice();
      const state = new ChargingControlStateImpl(device, 0);

      expect(state.getManualOverrideDuration()).toBe(0);
    });

    test('handles large duration values', () => {
      const device = createMockDevice();
      const largeDuration = 24 * 60 * 60 * 1000; // 24 hours
      const state = new ChargingControlStateImpl(device, largeDuration);

      expect(state.getManualOverrideDuration()).toBe(largeDuration);
    });
  });
});

