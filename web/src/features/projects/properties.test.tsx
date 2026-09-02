/**
 * A timeframe printed at the precision it was actually entered with.
 *
 * The granularity is the difference between a date and a promise: a quarter target is a
 * real day in the database and a three-month window on screen, and printing the day would
 * be the client asserting a precision nobody entered.
 */

import { describe, expect, it } from 'vitest';

import { formatTimeframe } from './properties';

describe('formatTimeframe', () => {
  it('prints a day as a day', () => {
    expect(formatTimeframe('2026-06-30', 'day')).toMatch(/2026/);
    expect(formatTimeframe('2026-06-30', 'day')).toMatch(/30/);
  });

  it('cuts a month back to its month', () => {
    expect(formatTimeframe('2026-06-30', 'month')).not.toMatch(/30/);
    expect(formatTimeframe('2026-06-30', 'month')).toMatch(/2026/);
  });

  it('names the quarter, the half and the year', () => {
    expect(formatTimeframe('2026-06-30', 'quarter')).toBe('Q2 2026');
    expect(formatTimeframe('2026-01-05', 'quarter')).toBe('Q1 2026');
    expect(formatTimeframe('2026-06-30', 'half')).toBe('H1 2026');
    expect(formatTimeframe('2026-07-01', 'half')).toBe('H2 2026');
    expect(formatTimeframe('2026-06-30', 'year')).toBe('2026');
  });

  it('hands back a date it cannot read rather than printing "Invalid Date"', () => {
    expect(formatTimeframe('not-a-date', 'day')).toBe('not-a-date');
  });
});
