import { describe, expect, it } from 'vitest';

import { addDaysUtc, daysFromPx, shiftedProjectDates } from './timelineDrag';

describe('daysFromPx', () => {
  it('rounds to the nearest whole day at the current zoom', () => {
    expect(daysFromPx(0, 4)).toBe(0);
    expect(daysFromPx(5, 4)).toBe(1);
    expect(daysFromPx(-7, 4)).toBe(-2);
    expect(daysFromPx(1.9, 4)).toBe(0);
  });

  it('refuses a non-positive zoom rather than inventing days', () => {
    expect(daysFromPx(40, 0)).toBe(0);
    expect(daysFromPx(40, -4)).toBe(0);
  });
});

describe('addDaysUtc', () => {
  it('crosses month and year boundaries in UTC', () => {
    expect(addDaysUtc('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDaysUtc('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysUtc('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('shiftedProjectDates', () => {
  it('shifts both ends when the project has a span', () => {
    expect(shiftedProjectDates({ startDate: '2026-01-01', targetDate: '2026-01-10' }, 3)).toEqual({
      startDate: '2026-01-04',
      targetDate: '2026-01-13',
    });
  });

  it('keeps a one-date bar as one date', () => {
    expect(shiftedProjectDates({ startDate: '2026-02-01' }, -2)).toEqual({
      startDate: '2026-01-30',
    });
    expect(shiftedProjectDates({ targetDate: '2026-02-15' }, 5)).toEqual({
      targetDate: '2026-02-20',
    });
  });

  it('returns null when nothing would change', () => {
    expect(
      shiftedProjectDates({ startDate: '2026-01-01', targetDate: '2026-01-10' }, 0),
    ).toBeNull();
    expect(shiftedProjectDates({}, 4)).toBeNull();
  });
});
