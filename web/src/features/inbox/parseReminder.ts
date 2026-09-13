/**
 * Typed reminder phrases for the inbox snooze custom row.
 *
 * Linear's custom date box accepts whole phrases rather than a calendar widget: `til Friday`,
 * `next quarter`, `for 2 weeks`, `Jan 3 10am`. The product documentation is explicit that they
 * must be typed in full — partial matches are refusals, not guesses — so this parser is a
 * closed set of shapes rather than a natural-language free-for-all.
 *
 * The clock is injected. A phrase that means "Friday" only has one correct answer against a
 * pinned instant, and an ambient `Date.now()` would make that answer untestable.
 */

export interface ReminderParseOk {
  readonly ok: true;
  readonly until: Date;
}

export interface ReminderParseErr {
  readonly ok: false;
  readonly error: string;
}

export type ReminderParse = ReminderParseOk | ReminderParseErr;

const WEEKDAYS: Readonly<Record<string, number>> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const MONTHS: Readonly<Record<string, number>> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

/** Default wall-clock hour when a phrase names a day and not a time. Matches "Tomorrow morning". */
const DEFAULT_HOUR = 9;

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/i;
const NAMED_DAY =
  /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/i;
const FOR_DURATION = /^for\s+(\d+)\s+(days?|weeks?|months?)$/i;
const TIL_WEEKDAY =
  /^(?:til|until)\s+(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)$/i;
const TIL_MONTH =
  /^(?:til|until)\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(\d{1,2}))?$/i;

/**
 * Resolves a typed reminder phrase to an instant strictly after `now`.
 *
 * Returns `{ ok: false }` rather than throwing: the box is being typed into, and a refusal
 * is a message under the field rather than an exception on the render path.
 */
export function parseReminder(raw: string, now: Date = new Date()): ReminderParse {
  const phrase = raw.trim().replace(/\s+/gu, ' ');
  if (phrase === '') {
    return { ok: false, error: 'Type a time — til Friday, next quarter, for 2 weeks…' };
  }

  const lower = phrase.toLowerCase();

  if (lower === 'next quarter') {
    return future(startOfNextQuarter(now), now);
  }

  const duration = FOR_DURATION.exec(lower);
  if (duration !== null) {
    const count = Number(duration[1]);
    if (!Number.isFinite(count) || count < 1) {
      return { ok: false, error: 'Use a whole number of days, weeks or months.' };
    }
    const unit = duration[2] ?? '';
    const until = new Date(now.getTime());
    if (unit.startsWith('day')) until.setDate(until.getDate() + count);
    else if (unit.startsWith('week')) until.setDate(until.getDate() + count * 7);
    else until.setMonth(until.getMonth() + count);
    return future(until, now);
  }

  const tilWeekday = TIL_WEEKDAY.exec(lower);
  if (tilWeekday !== null) {
    const weekday = WEEKDAYS[tilWeekday[1] ?? ''];
    if (weekday === undefined) {
      return { ok: false, error: 'That weekday is not recognised.' };
    }
    return future(atHour(nextWeekday(now, weekday), DEFAULT_HOUR, 0), now);
  }

  const tilMonth = TIL_MONTH.exec(lower);
  if (tilMonth !== null) {
    const month = MONTHS[tilMonth[1] ?? ''];
    if (month === undefined) {
      return { ok: false, error: 'That month is not recognised.' };
    }
    const day = tilMonth[2] === undefined ? 1 : Number(tilMonth[2]);
    if (!Number.isFinite(day) || day < 1 || day > 31) {
      return { ok: false, error: 'That day of the month is not a date.' };
    }
    const until = nextMonthDay(now, month, day);
    if (until === null) {
      return { ok: false, error: 'That day does not exist in that month.' };
    }
    return future(atHour(until, DEFAULT_HOUR, 0), now);
  }

  const named = NAMED_DAY.exec(lower);
  if (named !== null) {
    const month = MONTHS[named[1] ?? ''];
    if (month === undefined) {
      return { ok: false, error: 'That month is not recognised.' };
    }
    const day = Number(named[2]);
    const time = parseClock(named[3], named[4], named[5]);
    if (time === null) {
      return { ok: false, error: 'That time is not a clock reading.' };
    }
    const until = nextMonthDay(now, month, day);
    if (until === null) {
      return { ok: false, error: 'That day does not exist in that month.' };
    }
    return future(atHour(until, time.hour, time.minute), now);
  }

  const iso = ISO_DAY.exec(phrase);
  if (iso !== null) {
    const year = Number(iso[1]);
    const month = Number(iso[2]) - 1;
    const day = Number(iso[3]);
    const time =
      iso[4] === undefined ? { hour: DEFAULT_HOUR, minute: 0 } : parseClock(iso[4], iso[5], iso[6]);
    if (time === null) {
      return { ok: false, error: 'That time is not a clock reading.' };
    }
    const until = new Date(year, month, day, time.hour, time.minute, 0, 0);
    if (until.getFullYear() !== year || until.getMonth() !== month || until.getDate() !== day) {
      return { ok: false, error: 'That day does not exist on the calendar.' };
    }
    return future(until, now);
  }

  return {
    ok: false,
    error: 'Try til Friday, next quarter, for 2 weeks, or Jan 3 10am.',
  };
}

function future(until: Date, now: Date): ReminderParse {
  if (until.getTime() <= now.getTime()) {
    return { ok: false, error: 'That time has already passed.' };
  }
  return { ok: true, until };
}

function parseClock(
  hourRaw: string | undefined,
  minuteRaw: string | undefined,
  meridiemRaw: string | undefined,
): { hour: number; minute: number } | null {
  if (hourRaw === undefined) return { hour: DEFAULT_HOUR, minute: 0 };
  let hour = Number(hourRaw);
  const minute = minuteRaw === undefined ? 0 : Number(minuteRaw);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    return null;
  }
  const meridiem = meridiemRaw?.toLowerCase();
  if (meridiem === 'am' || meridiem === 'pm') {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'am') hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
  } else if (hour < 0 || hour > 23) {
    return null;
  }
  return { hour, minute };
}

function atHour(day: Date, hour: number, minute: number): Date {
  const next = new Date(day.getTime());
  next.setHours(hour, minute, 0, 0);
  return next;
}

/** The next occurrence of `weekday`, or today when today is that weekday and still morning. */
function nextWeekday(now: Date, weekday: number): Date {
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const delta = (weekday - candidate.getDay() + 7) % 7;
  candidate.setDate(candidate.getDate() + delta);
  const atNine = atHour(candidate, DEFAULT_HOUR, 0);
  if (atNine.getTime() > now.getTime()) return candidate;
  candidate.setDate(candidate.getDate() + 7);
  return candidate;
}

/** The next calendar occurrence of month/day at local midnight, or null if the day is invalid. */
function nextMonthDay(now: Date, month: number, day: number): Date | null {
  const thisYear = new Date(now.getFullYear(), month, day);
  if (thisYear.getMonth() !== month || thisYear.getDate() !== day) return null;
  const atNine = atHour(thisYear, DEFAULT_HOUR, 0);
  if (atNine.getTime() > now.getTime()) return thisYear;
  const nextYear = new Date(now.getFullYear() + 1, month, day);
  if (nextYear.getMonth() !== month || nextYear.getDate() !== day) return null;
  return nextYear;
}

function startOfNextQuarter(now: Date): Date {
  const month = now.getMonth();
  const nextQuarterMonth = (Math.floor(month / 3) + 1) * 3;
  if (nextQuarterMonth >= 12) {
    return new Date(now.getFullYear() + 1, 0, 1, DEFAULT_HOUR, 0, 0, 0);
  }
  return new Date(now.getFullYear(), nextQuarterMonth, 1, DEFAULT_HOUR, 0, 0, 0);
}
