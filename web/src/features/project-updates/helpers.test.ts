import { describe, expect, it } from 'vitest';

import { updateAge } from './helpers';

const NOW = Date.parse('2026-09-06T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

describe('updateAge', () => {
  it('writes the age in the largest unit that fits a cell', () => {
    expect(updateAge(new Date(NOW - 20 * 60 * 1000).toISOString(), NOW)).toBe('now');
    expect(updateAge(new Date(NOW - 5 * HOUR).toISOString(), NOW)).toBe('5h');
    expect(updateAge(new Date(NOW - 3 * 24 * HOUR).toISOString(), NOW)).toBe('3d');
    expect(updateAge(new Date(NOW - 8 * 7 * 24 * HOUR).toISOString(), NOW)).toBe('8w');
  });

  it('stays in weeks rather than hiding missed updates behind months', () => {
    expect(updateAge(new Date(NOW - 60 * 24 * HOUR).toISOString(), NOW)).toBe('8w');
  });
});
