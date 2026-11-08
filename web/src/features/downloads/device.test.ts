import { describe, expect, it } from 'vitest';
import { devicePlatform } from './device';

describe('download recommendations', () => {
  it('recognizes iPhone and desktop-mode iPad without recommending a DMG', () => {
    expect(devicePlatform('iPhone OS 18', 'iPhone', 5)).toBe('iOS');
    expect(devicePlatform('Macintosh', 'MacIntel', 5)).toBe('iOS');
    expect(devicePlatform('Macintosh', 'MacIntel', 0)).toBe('macOS');
  });
  it('keeps unsupported mobile platforms on the web', () => {
    expect(devicePlatform('Linux; Android 16', 'Linux armv8', 5)).toBe('browser');
    expect(devicePlatform('X11; CrOS x86_64', 'Linux x86_64', 0)).toBe('browser');
    expect(devicePlatform('', '', 0)).toBe('browser');
  });
  it('recognizes supported desktop platforms', () => {
    expect(devicePlatform('Windows NT 10.0', 'Win32', 0)).toBe('Windows');
    expect(devicePlatform('X11; Linux x86_64', 'Linux x86_64', 0)).toBe('Linux');
  });
});
