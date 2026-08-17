import { describe, expect, it } from 'vitest';

import { isRelativeToken, resolveRelative, type TimeContext } from './relative';

/** The fixture's clock, so this file and the conformance suite reason about one instant. */
const NOW = Date.parse('2026-08-15T12:00:00Z');

const lisbon: TimeContext = { now: NOW, timezone: 'Europe/Lisbon' };
const utc: TimeContext = { now: NOW, timezone: 'UTC' };

function at(iso: string): number {
  return Date.parse(iso);
}

describe('resolveRelative', () => {
  it('snaps an offset to the start of a day rather than to the current time of day', () => {
    // Ten whole days. Carrying the time of day would silently drop everything logged this
    // morning ten days ago, which is not what "in the last ten days" means to anybody.
    expect(resolveRelative('-10d', lisbon).date).toBe('2026-08-05');
    expect(resolveRelative('-10d', lisbon).instant).toBe(at('2026-08-05T00:00:00+01:00'));
  });

  it('measures the day in the workspace timezone, not in UTC', () => {
    expect(resolveRelative('-10d', utc).instant).toBe(at('2026-08-05T00:00:00Z'));
    // An hour apart, and a due date compared against the wrong one is off by a day for
    // everybody on the wrong side of midnight.
    expect(resolveRelative('-10d', lisbon).instant).not.toBe(resolveRelative('-10d', utc).instant);
  });

  it('takes the calendar day from the zone, so an instant can be tomorrow already', () => {
    const auckland: TimeContext = { now: at('2026-08-15T23:30:00Z'), timezone: 'Pacific/Auckland' };
    expect(resolveRelative('today', auckland).date).toBe('2026-08-16');
    expect(resolveRelative('today', auckland).instant).toBe(at('2026-08-16T00:00:00+12:00'));
  });

  it('uses the offset in force at midnight, not the one in force now', () => {
    // Lisbon leaves summer time at 02:00 local on 25 October 2026. The day still starts at
    // 00:00 WEST; taking the offset at noon — after the change — puts the boundary an hour
    // late and quietly drops an hour of issues from "today".
    const changeover: TimeContext = { now: at('2026-10-25T12:00:00Z'), timezone: 'Europe/Lisbon' };
    expect(resolveRelative('today', changeover).instant).toBe(at('2026-10-25T00:00:00+01:00'));
  });

  it('resolves the keywords against the injected clock', () => {
    expect(resolveRelative('today', lisbon).date).toBe('2026-08-15');
    expect(resolveRelative('yesterday', lisbon).date).toBe('2026-08-14');
    expect(resolveRelative('tomorrow', lisbon).date).toBe('2026-08-16');
    // 15 August 2026 is a Saturday, and the week starts on Monday.
    expect(resolveRelative('startOfWeek', lisbon).date).toBe('2026-08-10');
    expect(resolveRelative('startOfMonth', lisbon).date).toBe('2026-08-01');
    expect(resolveRelative('startOfYear', lisbon).date).toBe('2026-01-01');
  });

  it('keeps `now` an instant, because that is what it names', () => {
    expect(resolveRelative('now', lisbon).instant).toBe(NOW);
    expect(resolveRelative('now', lisbon).date).toBe('2026-08-15');
  });

  it('offsets by weeks, months and years', () => {
    expect(resolveRelative('+3d', lisbon).date).toBe('2026-08-18');
    expect(resolveRelative('-2w', lisbon).date).toBe('2026-08-01');
    expect(resolveRelative('-1M', lisbon).date).toBe('2026-07-15');
    expect(resolveRelative('+1y', lisbon).date).toBe('2027-08-15');
  });

  it('clamps a month offset instead of rolling it over', () => {
    // `setMonth` rolls 31 March back to 3 March, which is why "a month ago" occasionally
    // skips a month.
    const endOfMarch: TimeContext = { now: at('2026-03-31T12:00:00Z'), timezone: 'UTC' };
    expect(resolveRelative('-1M', endOfMarch).date).toBe('2026-02-28');

    const leapDay: TimeContext = { now: at('2028-02-29T12:00:00Z'), timezone: 'UTC' };
    expect(resolveRelative('-1y', leapDay).date).toBe('2027-02-28');
  });

  it('falls back to UTC for a zone the platform does not know', () => {
    // A stale team setting renders dates a few hours out; throwing takes down every list in
    // the product, which is the worse of the two by a distance.
    const broken: TimeContext = { now: NOW, timezone: 'Mars/Olympus' };
    expect(resolveRelative('today', broken).instant).toBe(at('2026-08-15T00:00:00Z'));
  });

  it('throws on a token it does not recognise rather than defaulting to the epoch', () => {
    // A typo that resolved to 1970 is a filter that silently matches everything.
    expect(() => resolveRelative('-7 days', lisbon)).toThrow(RangeError);
    expect(() => resolveRelative('lastTuesday', lisbon)).toThrow(RangeError);
  });
});

describe('isRelativeToken', () => {
  it('recognises the tokens the grammar defines and nothing else', () => {
    for (const token of ['now', 'today', 'yesterday', 'tomorrow', 'startOfWeek', '-7d', '+12M']) {
      expect(isRelativeToken(token), token).toBe(true);
    }
    for (const token of ['7d', '-7', 'd', '-7dd', '-7D', '2026-08-15', '', 'endOfWeek']) {
      expect(isRelativeToken(token), token).toBe(false);
    }
  });
});
