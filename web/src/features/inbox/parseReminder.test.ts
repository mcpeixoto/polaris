/**
 * The closed set of reminder phrases the inbox custom snooze box accepts.
 *
 * Pinned against a Wednesday morning in September so "til Friday" and "next quarter" each
 * have one correct answer, and against a late-in-the-day clock so "til Wednesday" rolls.
 */

import { describe, expect, it } from 'vitest';

import { parseReminder } from './parseReminder';

/** Wednesday 2 September 2026, 09:00 local. */
const WEDNESDAY_MORNING = new Date(2026, 8, 2, 9, 0, 0, 0);
/** Wednesday 2 September 2026, 18:00 local — past the default 09:00. */
const WEDNESDAY_EVENING = new Date(2026, 8, 2, 18, 0, 0, 0);

describe('parseReminder', () => {
  it('resolves next quarter to the first morning of the following quarter', () => {
    const parsed = parseReminder('next quarter', WEDNESDAY_MORNING);
    expect(parsed).toEqual({
      ok: true,
      until: new Date(2026, 9, 1, 9, 0, 0, 0),
    });
  });

  it('resolves til Friday to this week when that morning is still ahead', () => {
    const parsed = parseReminder('til Friday', WEDNESDAY_MORNING);
    expect(parsed).toEqual({
      ok: true,
      until: new Date(2026, 8, 4, 9, 0, 0, 0),
    });
  });

  it('accepts until as a synonym of til', () => {
    const parsed = parseReminder('until Monday', WEDNESDAY_MORNING);
    expect(parsed).toEqual({
      ok: true,
      until: new Date(2026, 8, 7, 9, 0, 0, 0),
    });
  });

  it('rolls a weekday that has already passed today to next week', () => {
    const parsed = parseReminder('til Wednesday', WEDNESDAY_EVENING);
    expect(parsed).toEqual({
      ok: true,
      until: new Date(2026, 8, 9, 9, 0, 0, 0),
    });
  });

  it('resolves til <month> to the first of that month ahead', () => {
    const parsed = parseReminder('til December', WEDNESDAY_MORNING);
    expect(parsed).toEqual({
      ok: true,
      until: new Date(2026, 11, 1, 9, 0, 0, 0),
    });
  });

  it('resolves for N weeks from now', () => {
    const parsed = parseReminder('for 2 weeks', WEDNESDAY_MORNING);
    expect(parsed).toEqual({
      ok: true,
      until: new Date(2026, 8, 16, 9, 0, 0, 0),
    });
  });

  it('resolves a named day with a wall-clock time', () => {
    const parsed = parseReminder('Jan 3 10am', WEDNESDAY_MORNING);
    expect(parsed).toEqual({
      ok: true,
      until: new Date(2027, 0, 3, 10, 0, 0, 0),
    });
  });

  it('resolves an ISO day at the default morning hour', () => {
    const parsed = parseReminder('2026-12-24', WEDNESDAY_MORNING);
    expect(parsed).toEqual({
      ok: true,
      until: new Date(2026, 11, 24, 9, 0, 0, 0),
    });
  });

  it('refuses an empty phrase with a hint rather than a guess', () => {
    expect(parseReminder('   ', WEDNESDAY_MORNING)).toEqual({
      ok: false,
      error: 'Type a time — til Friday, next quarter, for 2 weeks…',
    });
  });

  it('refuses a partial weekday rather than guessing Friday from Fri', () => {
    // "fri" alone is not in the closed set — Linear requires the phrase typed in full.
    expect(parseReminder('fri', WEDNESDAY_MORNING).ok).toBe(false);
  });

  it('refuses a time that has already passed', () => {
    const parsed = parseReminder('2026-09-01', WEDNESDAY_MORNING);
    expect(parsed).toEqual({
      ok: false,
      error: 'That time has already passed.',
    });
  });
});
