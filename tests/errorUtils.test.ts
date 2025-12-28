/**
 * Tests for Error Utilities
 * 
 * Tests pure error handling functions that extract error messages from various error types.
 */

import { extractErrorMessage } from '../logic/utils/errorUtils';

describe('Error Utilities', () => {
  describe('extractErrorMessage', () => {
    test('extracts message from Error instance', () => {
      const error = new Error('Test error message');
      expect(extractErrorMessage(error)).toBe('Test error message');
    });

    test('extracts message from Error with empty message', () => {
      const error = new Error('');
      expect(extractErrorMessage(error)).toBe('');
    });

    test('converts string to string', () => {
      expect(extractErrorMessage('String error')).toBe('String error');
    });

    test('converts empty string to empty string', () => {
      expect(extractErrorMessage('')).toBe('');
    });

    test('converts number to string', () => {
      expect(extractErrorMessage(123)).toBe('123');
      expect(extractErrorMessage(0)).toBe('0');
      expect(extractErrorMessage(-1)).toBe('-1');
    });

    test('converts boolean to string', () => {
      expect(extractErrorMessage(true)).toBe('true');
      expect(extractErrorMessage(false)).toBe('false');
    });

    test('converts null to string', () => {
      expect(extractErrorMessage(null)).toBe('null');
    });

    test('converts undefined to string', () => {
      expect(extractErrorMessage(undefined)).toBe('undefined');
    });

    test('converts object to string', () => {
      const obj = { key: 'value' };
      expect(extractErrorMessage(obj)).toBe('[object Object]');
    });

    test('converts array to string', () => {
      const arr = [1, 2, 3];
      expect(extractErrorMessage(arr)).toBe('1,2,3');
    });

    test('handles Error with custom properties', () => {
      const error = new Error('Base message');
      (error as unknown as { code: string }).code = 'CUSTOM_CODE';
      expect(extractErrorMessage(error)).toBe('Base message');
    });

    test('handles TypeError', () => {
      const error = new TypeError('Type error message');
      expect(extractErrorMessage(error)).toBe('Type error message');
    });

    test('handles ReferenceError', () => {
      const error = new ReferenceError('Reference error message');
      expect(extractErrorMessage(error)).toBe('Reference error message');
    });

    test('handles SyntaxError', () => {
      const error = new SyntaxError('Syntax error message');
      expect(extractErrorMessage(error)).toBe('Syntax error message');
    });
  });
});

