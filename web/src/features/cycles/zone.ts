/**
 * Calendar days as the team reckons them.
 *
 * A cycle begins at 12:01 AM in the team's timezone (docs/01-features/05-cycles.md), so
 * every day boundary this feature draws — the graph's columns, the day a date input shows,
 * the instant "start cycle today" writes — belongs to `Team.timezone` and to nothing else.
 * Reckoning them in UTC put an extra leading day on the graph for a team east of Greenwich
 * and dropped the last day for one west of it, and it moved the Friday and Monday edges
 * across the weekend, which bends the target line. Reckoning them in the *reader's* zone,
 * which is what `new Date(…).getFullYear()` does, is a third answer again: two people
 * looking at one sprint would see two different windows.
 *
 * Days are `2026-01-05` strings. A calendar date has no zone once it exists — its weekday
 * is arithmetic — so only the conversions at either end need one.
 */

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The wall clock in `timeZone` at an instant, as the UTC epoch of those same numbers.
 *
 * `en-CA` is the shortest route from `Intl` to ISO ordering; the locale is a formatting
 * trick here rather than a language choice, since the output is digits either way.
 */
function wallClockAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  return Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  );
}

/** How far `timeZone` is ahead of UTC at an instant, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  return wallClockAt(instant, timeZone) - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant at which `timeZone`'s clocks read the given wall time.
 *
 * Two passes, because the offset depends on the instant we are trying to find: the first
 * guess lands within an hour, and the second reads the offset that actually applies there.
 * That is what makes the day after a DST change come out right rather than an hour short.
 */
export function instantOfWallClock(wallUtc: number, timeZone: string): number {
  const guess = wallUtc - offsetAt(wallUtc, timeZone);
  return wallUtc - offsetAt(guess, timeZone);
}

/** The calendar day an instant falls on, in the team's zone: `2026-01-05`. */
export function dayIn(iso: string | number, timeZone: string): string {
  const instant = typeof iso === 'number' ? iso : Date.parse(iso);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant));
}

function partsOf(day: string): [number, number, number] {
  const match = DAY_PATTERN.exec(day);
  if (match === null) return [1970, 1, 1];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Midnight opening the day, as a UTC instant. */
export function startOfDayInstant(day: string, timeZone: string): number {
  const [y, m, d] = partsOf(day);
  return instantOfWallClock(Date.UTC(y, m - 1, d), timeZone);
}

/** The last millisecond of the day, as a UTC ISO string comparable with any timestamp. */
export function endOfDayIso(day: string, timeZone: string): string {
  const [y, m, d] = partsOf(day);
  const instant = instantOfWallClock(Date.UTC(y, m - 1, d, 23, 59, 59), timeZone) + 999;
  return new Date(instant).toISOString();
}

/** Calendar arithmetic on the day string itself, which no zone can disturb. */
export function addDays(day: string, count: number): string {
  const [y, m, d] = partsOf(day);
  const moved = new Date(Date.UTC(y, m - 1, d + count));
  return moved.toISOString().slice(0, 10);
}

/** Saturday or Sunday. A weekday is a property of the date, not of where it is read. */
export function isWeekend(day: string): boolean {
  const [y, m, d] = partsOf(day);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/** The time of day an instant reads at in the team's zone, in ms since its midnight. */
export function timeOfDayIn(iso: string, timeZone: string): number {
  const instant = Date.parse(iso);
  const day = dayIn(instant, timeZone);
  return instant - startOfDayInstant(day, timeZone);
}

/**
 * The same time of day as `templateIso`, on another calendar day.
 *
 * Used by the edit dialog: a person moving a cycle's start by a day is not also asking to
 * move the hour it begins at, and pasting a date onto a UTC instant does exactly that for
 * anyone whose zone is not UTC.
 */
export function withDay(day: string, templateIso: string, timeZone: string): string {
  const offsetInDay = timeOfDayIn(templateIso, timeZone);
  return new Date(startOfDayInstant(day, timeZone) + offsetInDay).toISOString();
}
