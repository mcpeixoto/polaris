import { describe, expect, it } from 'vitest';

import { age } from './inbox';

const NOW = Date.parse('2026-09-06T12:00:00.000Z');

function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('age', () => {
  it('reads as a magnitude, not a sentence', () => {
    expect(age(ago(20_000), NOW)).toBe('now');
    expect(age(ago(5 * MINUTE), NOW)).toBe('5m');
    expect(age(ago(3 * HOUR), NOW)).toBe('3h');
    expect(age(ago(6 * DAY), NOW)).toBe('6d');
    expect(age(ago(15 * DAY), NOW)).toBe('2w');
    expect(age(ago(70 * DAY), NOW)).toBe('2mo');
    expect(age(ago(400 * DAY), NOW)).toBe('1y');
  });

  it('truncates rather than rounds, so it never claims the future', () => {
    expect(age(ago(36 * HOUR), NOW)).toBe('1d');
    expect(age(ago(90 * MINUTE), NOW)).toBe('1h');
  });

  it('treats a timestamp from the future as now, and an unparseable one as nothing', () => {
    expect(age(ago(-HOUR), NOW)).toBe('now');
    expect(age('not a date', NOW)).toBe('');
  });
});
