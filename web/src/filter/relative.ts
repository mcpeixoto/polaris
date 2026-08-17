/**
 * Relative date tokens, resolved against an injected clock and timezone.
 *
 * Two decisions carry this file.
 *
 * The first: tokens are resolved at *evaluation* time, never at save time. A view called
 * "Updated this week" that quietly means "the week of 4 March" because that is when it was
 * saved is worse than useless, and storing the resolved date is exactly what produces it.
 *
 * The second: the clock is a parameter. Nothing here calls `Date.now()`, because the
 * conformance fixture pins a fixed clock and because a filter whose answer depends on an
 * ambient global cannot be tested at a boundary — it can only be tested by waiting.
 *
 * Everything except `now` snaps to the start of a day in the workspace's timezone. That is
 * pinned by the fixture, and it is also the only reading a person means: "created in the
 * last ten days" is ten whole days, not ten days and the current time of day, which would
 * silently drop everything logged this morning ten days ago.
 */

import type { DateOnly } from '~/store/types';

/** The clock and the calendar a filter is resolved against. */
export interface TimeContext {
  /** Epoch milliseconds. Injected — see the note above about `Date.now()`. */
  readonly now: number;
  /**
   * IANA zone the workspace's days are measured in. A due date and "today" are calendar
   * facts, not instants: measured in the wrong zone they are wrong by up to a day, which
   * is a missed deadline rather than a rounding error.
   */
  readonly timezone: string;
}

/**
 * Tokens that name a day (or, for `now`, an instant) without an offset.
 *
 * Deliberately short, and deliberately only tokens that name exactly one day. `endOfWeek`
 * is absent because it has two defensible readings — the last day, or the exclusive bound
 * after it — and a grammar shared by two implementations cannot afford a token whose
 * meaning each side picks for itself.
 */
export const RELATIVE_KEYWORDS = [
  'now',
  'today',
  'yesterday',
  'tomorrow',
  'startOfWeek',
  'startOfMonth',
  'startOfYear',
] as const;

export type RelativeKeyword = (typeof RELATIVE_KEYWORDS)[number];

const KEYWORDS: ReadonlySet<string> = new Set<string>(RELATIVE_KEYWORDS);

/**
 * An offset: sign, count, unit. The sign is required — `7d` reads as both "seven days ago"
 * and "in seven days" depending on who is reading, and a filter must not be ambiguous.
 *
 * `M` is months and is case-sensitive, matching Go's layout convention and leaving `m`
 * free for minutes if a timestamp filter ever needs them.
 */
const OFFSET = /^([+-])(\d+)([dwMy])$/;

/** What a token resolves to: an instant for timestamp fields, a calendar day for dates. */
export interface ResolvedRelative {
  /** Epoch milliseconds — the start of the named day, or the clock itself for `now`. */
  readonly instant: number;
  /** The same moment as a calendar day in the workspace's timezone, `2006-01-02`. */
  readonly date: DateOnly;
}

export function isRelativeToken(value: string): boolean {
  return KEYWORDS.has(value) || OFFSET.test(value);
}

/**
 * Resolves a token against the clock.
 *
 * Throws on a token it does not recognise rather than defaulting to the epoch, which would
 * turn a typo into a filter that silently matches everything. `validate.ts` is the gate;
 * reaching this throw means an AST was compiled without being validated.
 */
export function resolveRelative(token: string, time: TimeContext): ResolvedRelative {
  const today = localDayOf(time.now, time.timezone);

  if (token === 'now') {
    return { instant: time.now, date: formatDay(today) };
  }

  const day = relativeDay(token, today);
  if (day === null) {
    throw new RangeError(`"${token}" is not a relative date token`);
  }
  return { instant: startOfDay(day, time.timezone), date: formatDay(day) };
}

function relativeDay(token: string, today: CivilDay): CivilDay | null {
  switch (token) {
    case 'today':
      return today;
    case 'yesterday':
      return addDays(today, -1);
    case 'tomorrow':
      return addDays(today, 1);
    case 'startOfWeek':
      // Monday. The workspace has no week-start preference to read, and ISO is the
      // convention the rest of the codebase already follows.
      return addDays(today, -((weekdayOf(today) + 6) % 7));
    case 'startOfMonth':
      return { year: today.year, month: today.month, day: 1 };
    case 'startOfYear':
      return { year: today.year, month: 1, day: 1 };
    default:
      break;
  }

  const offset = OFFSET.exec(token);
  if (offset === null) return null;
  const sign = offset[1] === '-' ? -1 : 1;
  const count = sign * Number(offset[2]);
  switch (offset[3]) {
    case 'd':
      return addDays(today, count);
    case 'w':
      return addDays(today, count * 7);
    case 'M':
      return addMonths(today, count);
    case 'y':
      return addMonths(today, count * 12);
    default:
      return null;
  }
}

/** A calendar day with no timezone attached: what "the 5th" means before a zone is applied. */
export interface CivilDay {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** The calendar day an instant falls on, in the given zone. */
export function localDayOf(instant: number, timezone: string): CivilDay {
  const parts = zonedParts(instant, timezone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

/**
 * The instant a local day begins.
 *
 * Two passes, because the offset to apply is the offset *at the answer*, not at the guess:
 * on a day the clocks change, one pass lands an hour out. Where local midnight does not
 * exist at all — zones that spring forward at midnight — the second pass lands on 01:00,
 * which is the correct answer: that is when the day started.
 */
export function startOfDay(day: CivilDay, timezone: string): number {
  const asUTC = Date.UTC(day.year, day.month - 1, day.day);
  const first = asUTC - offsetOf(asUTC, timezone);
  return asUTC - offsetOf(first, timezone);
}

export function formatDay(day: CivilDay): DateOnly {
  return `${pad(day.year, 4)}-${pad(day.month, 2)}-${pad(day.day, 2)}`;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function addDays(day: CivilDay, count: number): CivilDay {
  // Date.UTC normalises an out-of-range day, so this is calendar arithmetic with no zone
  // involved — which is what makes it safe to do before applying one.
  return civilOf(Date.UTC(day.year, day.month - 1, day.day + count));
}

/**
 * Months, clamping the day rather than rolling over: one month before 31 March is
 * 28 February, not 3 March. Rolling over is what `new Date().setMonth()` does, and it is
 * why "a month ago" occasionally skips a month.
 */
function addMonths(day: CivilDay, count: number): CivilDay {
  const total = day.year * 12 + (day.month - 1) + count;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return { year, month, day: Math.min(day.day, daysInMonth(year, month)) };
}

function daysInMonth(year: number, month: number): number {
  return civilOf(Date.UTC(year, month, 0)).day;
}

function weekdayOf(day: CivilDay): number {
  return new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();
}

function civilOf(instant: number): CivilDay {
  const date = new Date(instant);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

interface ZonedParts extends CivilDay {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/**
 * The zone's offset east of UTC at an instant, in milliseconds.
 *
 * Derived by reading the wall clock in the zone and subtracting: `Intl` is the only
 * complete tzdata in the platform, and shipping a second copy to answer one question would
 * be a megabyte that goes stale every time a government moves a transition.
 */
function offsetOf(instant: number, timezone: string): number {
  const parts = zonedParts(instant, timezone);
  const asUTC = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  // Seconds are the finest granularity any zone offset has ever used, so dropping the
  // milliseconds of the instant here cannot lose anything.
  return asUTC - Math.floor(instant / 1000) * 1000;
}

function zonedParts(instant: number, timezone: string): ZonedParts {
  const parts = formatterFor(timezone).formatToParts(new Date(instant));
  let year = 0;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;
  for (const part of parts) {
    const value = Number(part.value);
    switch (part.type) {
      case 'year':
        year = value;
        break;
      case 'month':
        month = value;
        break;
      case 'day':
        day = value;
        break;
      case 'hour':
        hour = value;
        break;
      case 'minute':
        minute = value;
        break;
      case 'second':
        second = value;
        break;
      default:
        break;
    }
  }
  return { year, month, day, hour, minute, second };
}

/**
 * Formatters are cached because constructing one costs more than every other operation in
 * this file put together, and a four-clause filter over relative dates would otherwise
 * build one per clause per keystroke.
 */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  const cached = FORMATTERS.get(timezone);
  if (cached !== undefined) return cached;

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = buildFormatter(timezone);
  } catch {
    // An unknown zone means a stale or corrupt team setting. Falling back to UTC renders
    // dates a few hours out; throwing takes down every list in the product, which is the
    // worse of the two by a distance.
    formatter = buildFormatter('UTC');
  }
  FORMATTERS.set(timezone, formatter);
  return formatter;
}

function buildFormatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    // h23 rather than hour12:false: the latter still renders midnight as 24 in some
    // engines, which reads back as the wrong day.
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
