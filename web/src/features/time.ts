/**
 * How the product writes a moment in time.
 *
 * Two rules, and they are about reading rather than about dates. Recent things get a
 * relative phrase, because "3 minutes ago" answers the question an activity feed is actually
 * asked — is this still happening — and a timestamp does not. Anything older than a week
 * gets a real date, because "47 days ago" is arithmetic the reader has to do themselves.
 *
 * `Intl` does the words, so translating the interface translates the dates with it. It is
 * given `uiLocale()` and never `undefined`: an undefined locale means *the browser's*, which
 * on a Portuguese machine rendered "há 20 minutos" inside an entirely English interface.
 * See features/locale.ts.
 *
 * The exact instant is always available in the `title` the callers put beside it, which is
 * why the visible form can afford to be this loose.
 */

import { browserTimezone, uiLocale } from './locale';

const UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ['second', 1000],
  ['minute', 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
];

/** Past this, a relative phrase stops helping and a date starts. */
const RELATIVE_LIMIT_MS = 7 * 24 * 60 * 60 * 1000;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Formatters are expensive to construct and are built on every render otherwise — a
 * virtualised list of five thousand rows would make one per visible row per frame. Cached
 * by locale rather than created once, because the locale changes when the interface is
 * translated and a formatter frozen at module load would keep speaking the old language.
 */
const cache = new Map<string, Intl.RelativeTimeFormat | Intl.DateTimeFormat>();

function cached<T extends Intl.RelativeTimeFormat | Intl.DateTimeFormat>(
  key: string,
  make: () => T,
): T {
  const hit = cache.get(key);
  if (hit) return hit as T;
  const made = make();
  cache.set(key, made);
  return made;
}

function relativeFormat(): Intl.RelativeTimeFormat {
  const locale = uiLocale();
  return cached(`rel:${locale}`, () => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }));
}

function dateFormat(withYear: boolean, timeZone?: string): Intl.DateTimeFormat {
  const locale = uiLocale();
  const zone = timeZone ?? '';
  return cached(
    `date:${locale}:${withYear ? 'y' : 'n'}:${zone}`,
    () =>
      new Intl.DateTimeFormat(locale, {
        ...(withYear ? { year: 'numeric' as const } : {}),
        month: 'short',
        day: 'numeric',
        ...(timeZone ? { timeZone } : {}),
      }),
  );
}

/** "just now", "3 minutes ago", "12 Mar". Falls back to the raw value if it will not parse. */
export function when(timestamp: string, now: number = Date.now()): string {
  const at = Date.parse(timestamp);
  if (Number.isNaN(at)) return timestamp;

  const elapsed = now - at;
  if (Math.abs(elapsed) < RELATIVE_LIMIT_MS) {
    // Walked from the largest unit down, so 90 minutes reads as "1 hour ago" rather than as
    // "90 minutes ago" — the unit a person would have chosen. Truncated rather than rounded,
    // because "2 hours ago" for something 90 minutes old is a claim about the future.
    for (let i = UNITS.length - 1; i >= 0; i--) {
      const unit = UNITS[i];
      if (unit === undefined) continue;
      const [name, size] = unit;
      const count = Math.trunc(elapsed / size);
      if (Math.abs(count) >= 1 || i === 0) return relativeFormat().format(-count, name);
    }
  }

  const date = new Date(at);
  return dateFormat(date.getFullYear() !== new Date(now).getFullYear()).format(date);
}

/** The full instant, for the `title` of whatever `when` is rendered into. */
export function exact(timestamp: string): string {
  const at = Date.parse(timestamp);
  return Number.isNaN(at) ? timestamp : new Date(at).toLocaleString(uiLocale());
}

// ---------------------------------------------------------------------------------------
// Calendar days.
//
// A due date is `2026-09-01` — a day, not an instant — and every naive way of rendering one
// is wrong.
//
// `new Date('2026-09-01')` parses as UTC midnight, so `.getDate()` in any timezone west of
// Greenwich returns 31 and the issue appears to be due the day before. `new Date(2026, 8, 1)`
// is right but silently 0-indexes the month. Both bugs are invisible to whoever writes the
// code, because they only appear to readers in another timezone — which, for an EU-first
// product, is most of them.
//
// So dates are parsed into their three numbers explicitly and formatted in UTC, which makes
// the timezone irrelevant rather than merely usually harmless.

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses `2006-01-02` to a UTC-midnight epoch, or null. */
function parseDateOnly(date: string): number | null {
  const match = DATE_PATTERN.exec(date);
  if (!match) return null;
  const [, y, m, d] = match;
  const at = Date.UTC(Number(y), Number(m) - 1, Number(d));
  // Rejects 2026-02-30, which Date.UTC would happily roll forward into March.
  const back = new Date(at);
  if (back.getUTCMonth() !== Number(m) - 1 || back.getUTCDate() !== Number(d)) return null;
  return at;
}

/** Today in the given timezone, as `2006-01-02`. */
export function today(timeZone: string = browserTimezone(), now: number = Date.now()): string {
  // `en-CA` is the shortest route to ISO order from Intl, and the locale here is a
  // formatting trick rather than a language choice — the output is digits either way.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now));
  return parts;
}

/**
 * "1 Sep", "1 Sep 2027", "Today", "Tomorrow", "Yesterday".
 *
 * `timeZone` is the zone the day is reckoned in — the team's, for a due date, because a due
 * date is the team's Friday rather than the reader's.
 */
export function whenDay(
  date: string,
  timeZone: string = browserTimezone(),
  now: number = Date.now(),
): string {
  const at = parseDateOnly(date);
  if (at === null) return date;

  const todayAt = parseDateOnly(today(timeZone, now));
  if (todayAt !== null) {
    const days = Math.round((at - todayAt) / MS_PER_DAY);
    // Only these three. "In 4 days" reads as a countdown and invites the reader to check
    // the arithmetic; a date does not.
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days === -1) return 'Yesterday';
  }

  const value = new Date(at);
  const thisYear = today(timeZone, now).slice(0, 4);
  return dateFormat(date.slice(0, 4) !== thisYear, 'UTC').format(value);
}

/** Whether a due date has passed, in the zone the day is reckoned in. */
export function isOverdue(
  date: string,
  timeZone: string = browserTimezone(),
  now: number = Date.now(),
): boolean {
  // String comparison, which is correct for this format and avoids re-deriving the
  // timezone boundary twice. `2026-08-31` < `2026-09-01` lexically and calendrically.
  return date < today(timeZone, now);
}
