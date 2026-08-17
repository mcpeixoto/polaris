import { describe, expect, it } from 'vitest';

import { setUILocale, uiLocale } from './locale';
import { exact, isOverdue, today, when, whenDay } from './time';

const NOW = Date.parse('2026-08-16T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('when', () => {
  it('picks the unit a person would have chosen', () => {
    expect(when(ago(30 * SECOND), NOW)).toBe('30 seconds ago');
    expect(when(ago(5 * MINUTE), NOW)).toBe('5 minutes ago');
    // Truncated, not rounded: "2 hours ago" for something 90 minutes old is a claim about
    // the future.
    expect(when(ago(90 * MINUTE), NOW)).toBe('1 hour ago');
    expect(when(ago(3 * DAY), NOW)).toBe('3 days ago');
  });

  it('switches to a date once the arithmetic stops being free', () => {
    // "47 days ago" is a subtraction the reader has to do themselves.
    expect(when(ago(47 * DAY), NOW)).toMatch(/Jun/);
    expect(when('2019-03-12T09:00:00Z', NOW)).toMatch(/2019/);
  });

  it('returns the raw value rather than Invalid Date', () => {
    expect(when('not a timestamp', NOW)).toBe('not a timestamp');
    expect(exact('not a timestamp')).toBe('not a timestamp');
  });

  // The M0 bug this module was rewritten for: an undefined locale means the *browser's*,
  // so an entirely English interface rendered "há 20 minutos" on a Portuguese machine.
  // Half-translated reads as a rendering fault, not as a feature.
  it('speaks the interface language, not the browser language', () => {
    expect(uiLocale()).toBe('en');
    expect(when(ago(20 * MINUTE), NOW)).toBe('20 minutes ago');

    // An unavailable language falls back rather than throwing: a stored preference for a
    // language that was removed must not stop the app rendering.
    expect(setUILocale('pt-PT')).toBe('en');
    expect(when(ago(20 * MINUTE), NOW)).toBe('20 minutes ago');
  });
});

describe('calendar days', () => {
  // The bug the whole date-only path exists to avoid: `new Date('2026-09-01')` is UTC
  // midnight, so any timezone west of Greenwich reads the day before. It is invisible to
  // whoever writes the code and visible to most of the users.
  it('does not shift the day in a western timezone', () => {
    const noon = Date.parse('2026-09-01T12:00:00Z');
    expect(whenDay('2026-09-05', 'America/Los_Angeles', noon)).toMatch(/Sep\s*5|5\s*Sep/);
    expect(whenDay('2026-09-05', 'Pacific/Kiritimati', noon)).toMatch(/Sep\s*5|5\s*Sep/);
  });

  it('names the three days worth naming', () => {
    const noon = Date.parse('2026-09-01T12:00:00Z');
    expect(whenDay('2026-09-01', 'UTC', noon)).toBe('Today');
    expect(whenDay('2026-09-02', 'UTC', noon)).toBe('Tomorrow');
    expect(whenDay('2026-08-31', 'UTC', noon)).toBe('Yesterday');
    // And stops there. "In 4 days" is a countdown the reader has to verify.
    expect(whenDay('2026-09-05', 'UTC', noon)).not.toMatch(/days/);
  });

  it('reckons the day in the zone it is given', () => {
    // 23:30 UTC is already tomorrow in Lisbon in summer, and still today in New York.
    const lateUTC = Date.parse('2026-09-01T23:30:00Z');
    expect(today('Europe/Lisbon', lateUTC)).toBe('2026-09-02');
    expect(today('America/New_York', lateUTC)).toBe('2026-09-01');
  });

  it('shows the year only when it is not this one', () => {
    const noon = Date.parse('2026-09-01T12:00:00Z');
    expect(whenDay('2026-12-25', 'UTC', noon)).not.toMatch(/2026/);
    expect(whenDay('2027-01-05', 'UTC', noon)).toMatch(/2027/);
  });

  it('rejects a date that is not one rather than rolling it forward', () => {
    // Date.UTC would happily turn this into 2 March.
    expect(whenDay('2026-02-30', 'UTC', NOW)).toBe('2026-02-30');
    expect(whenDay('not-a-date', 'UTC', NOW)).toBe('not-a-date');
  });

  it('knows what is overdue, in the right zone', () => {
    const lateUTC = Date.parse('2026-09-01T23:30:00Z');
    // Already 2 September in Lisbon, so 1 September has passed there and not in New York.
    expect(isOverdue('2026-09-01', 'Europe/Lisbon', lateUTC)).toBe(true);
    expect(isOverdue('2026-09-01', 'America/New_York', lateUTC)).toBe(false);
    expect(isOverdue('2026-09-02', 'Europe/Lisbon', lateUTC)).toBe(false);
  });
});
