/**
 * How a cycle's window is written, in one place.
 *
 * Three surfaces drew it independently — the list, the pause row between two cycles, and
 * the picker's hint — and all three dropped the year, so "Jan 5 – Jan 18" named a window in
 * 2024 and one in 2026 identically. In a list whose whole job is telling sprints apart,
 * that is the one fact worth keeping.
 *
 * The year is appended only when it differs from the current one: a team looking at this
 * quarter's cycles knows what year it is, and printing it on every row buys nothing.
 * `features/time` owns instants — `when`, `exact` — and a cycle window is a range of days
 * in the team's zone, which those cannot express.
 */

import { uiLocale } from '~/features/locale';

import { dayIn } from './zone';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dayFormat(withYear: boolean, timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(uiLocale(), {
    ...(withYear ? { year: 'numeric' as const } : {}),
    month: 'short',
    day: 'numeric',
    timeZone,
  });
}

function yearOf(iso: string, timeZone: string): string {
  return dayIn(iso, timeZone).slice(0, 4);
}

/** "Jan 5 – Jan 18", or "Jan 5, 2024 – Jan 18, 2024" once the year stops being this one. */
export function cycleWindow(
  startsAt: string,
  endsAt: string,
  timeZone: string,
  now: number = Date.now(),
): string {
  const thisYear = dayIn(now, timeZone).slice(0, 4);
  const withYear = yearOf(startsAt, timeZone) !== thisYear || yearOf(endsAt, timeZone) !== thisYear;
  const fmt = dayFormat(withYear, timeZone);
  return `${fmt.format(new Date(startsAt))} – ${fmt.format(new Date(endsAt))}`;
}

/**
 * Whole days from now to the cycle's end, in the team's zone, floored at zero.
 *
 * Counted between calendar days rather than by dividing the remaining milliseconds: a
 * cycle ending tonight has "1 day left" to the person living that day, not "0".
 */
export function daysLeft(endsAt: string, timeZone: string, now: number = Date.now()): number {
  const end = Date.parse(`${dayIn(endsAt, timeZone)}T00:00:00.000Z`);
  const today = Date.parse(`${dayIn(now, timeZone)}T00:00:00.000Z`);
  return Math.max(0, Math.round((end - today) / MS_PER_DAY));
}

/** "3 days left", "1 day left", "Ends today". */
export function daysLeftLabel(endsAt: string, timeZone: string, now: number = Date.now()): string {
  const days = daysLeft(endsAt, timeZone, now);
  if (days === 0) return 'Ends today';
  return days === 1 ? '1 day left' : `${days} days left`;
}
