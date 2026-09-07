/**
 * Choosing a day: a handful of relatives, a date box, and the way to clear it.
 *
 * Written once because a workspace is full of dates that are not an issue's due date — a
 * project's start and target, an initiative's target, a cycle's window — and every one of them
 * had been reaching for a raw `<input type="date">`. That control gives no relatives, no way to
 * say "no date" that is distinguishable from an empty box, and a different widget in every
 * browser. This is the due-date panel with the issue taken out of it.
 *
 * The relatives are what people actually mean. "End of week" is the Friday of the week the
 * reader is in — on a Saturday that Friday has gone, so it is the next one — and "next week"
 * is the following Monday, both resolved in the *owning* zone at the moment the panel opens.
 * That zone is a prop and never the reader's, because "overdue" is a fact about the team's
 * Friday rather than the reader's: two people looking at one project from Lisbon and Los
 * Angeles must not disagree about whether it has slipped.
 *
 * What it deliberately does not do is decide what a date means. It reports a chosen day and
 * the caller writes it, the same bargain the property pickers make; `null` is "no date" and is
 * a real answer, not an absence.
 *
 * `actionId` is required and has no default. See the note in `Popover.tsx`: two of these are
 * mounted side by side on a project (start and target), and the registry throws on a duplicate
 * action id rather than letting one Escape quietly shadow the other.
 */

import { useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';

import { formatDay, localDayOf, type CivilDay } from '~/filter';

import { Button } from './Button';
import styles from './DatePicker.module.css';
import { Input } from './Input';
import { Popover } from './Popover';

/** `YYYY-MM-DD`, the only shape a stored day takes. */
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/u;

/** One shortcut for typing a date: what it is called, and the day it resolves to today. */
export interface DateRelative {
  readonly id: string;
  readonly label: string;
  readonly date: string;
  /**
   * The resolved day, drawn beside the label — "end of week" is a promise the panel has to
   * show it is keeping, and somebody checking a date against a calendar should not have to
   * count. Omitted where it would only repeat the label: "Today Today" is not a second piece
   * of information, and a screen reader says both of them.
   */
  readonly hint?: string | undefined;
}

export interface DatePickerProps {
  open: boolean;
  onClose: () => void;
  /** The control the panel belongs to: what it is positioned against, and where focus returns. */
  trigger: RefObject<HTMLElement | null>;
  /** The stored day, or `null` when there is none. */
  value: string | null;
  /** The zone the relatives are resolved in: the team's or the project's, never the reader's. */
  timezone: string;
  /** Pins the clock. Tests only; the wall clock is read when the panel opens otherwise. */
  now?: number | undefined;
  /** `null` clears the date. */
  onSelect: (day: string | null) => void;
  /** The id this panel's Escape is registered under. Unique across everything mounted at once. */
  actionId: string;
  /** The help overlay's section for that Escape. */
  actionGroup?: string | undefined;
  /** The panel's accessible name: "Due date", "Target date". */
  label: string;
  /** The clear row's wording, which is the caller's noun: "No due date". */
  clearLabel?: string | undefined;
  /** Overrides the four defaults, for a surface where "end of week" is not a useful offer. */
  relatives?: readonly DateRelative[] | undefined;
  /** Extra controls at the trailing edge of the footer, beside the clear row. */
  footer?: ReactNode;
}

export function DatePicker({
  open,
  onClose,
  trigger,
  value,
  timezone,
  now,
  onSelect,
  actionId,
  actionGroup,
  label,
  clearLabel = 'No date',
  relatives,
  footer,
}: DatePickerProps) {
  const [draft, setDraft] = useState('');

  // The box starts on the date the thing actually has, so somebody nudging a deadline by a day
  // edits the day rather than retyping the year.
  //
  // Seeded on the false→true edge of `open` and not on every change to `value`, because the
  // date can move underneath somebody who is typing one: another client's edit, a policy
  // evaluation, or this client's own delta echoing back. Depending on `value` meant any of
  // those overwrote a half-typed day with the stored one, which is the picker deciding it
  // knows better than the person using it.
  //
  // A render-phase update rather than an effect, which is what keeps the seeding invisible:
  // the panel is portalled and fades out, so an effect would have shown the previous value
  // for a frame on opening, and emptying the field on closing would have done it under the
  // eyes of somebody watching it leave.
  const wasOpen = useRef(false);
  if (open !== wasOpen.current) {
    wasOpen.current = open;
    if (open) setDraft(value ?? '');
  }

  const choose = (day: string | null) => {
    onSelect(day);
    // A picker is a decision, so choosing closes it — the same bargain `Menu` makes.
    onClose();
  };

  const offered = relatives ?? defaultRelatives(timezone, now ?? Date.now());

  return (
    <Popover
      open={open}
      onClose={onClose}
      trigger={trigger}
      label={label}
      actionId={actionId}
      actionTitle={`Close the ${label.toLowerCase()} picker`}
      actionGroup={actionGroup}
      className={styles.panel}
    >
      <ul className={styles.relatives}>
        {offered.map((relative) => (
          <li key={relative.id}>
            <button
              type="button"
              className={styles.relative}
              aria-current={relative.date === value ? true : undefined}
              onClick={() => choose(relative.date)}
            >
              <span>{relative.label}</span>
              {relative.hint === undefined ? null : (
                <span className={styles.relativeDay}>{relative.hint}</span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {/* A form purely so that Enter commits. The alternative is a local key handler, which the
          keymap lint refuses for good reason; submitting a form is the platform's own answer to
          the same problem and needs no handler at all. */}
      <form
        className={styles.dateForm}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (!CALENDAR_DAY.test(draft)) return;
          choose(draft);
        }}
      >
        <Input
          label="Or a date"
          type="date"
          value={draft}
          autoComplete="off"
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={!CALENDAR_DAY.test(draft)}>
          Set
        </Button>
      </form>

      <div className={styles.footer}>
        <Button size="sm" variant="ghost" disabled={value === null} onClick={() => choose(null)}>
          {clearLabel}
        </Button>
        {footer}
      </div>
    </Popover>
  );
}

/**
 * The four days worth offering, resolved in the owning zone.
 *
 * Deliberately not the filter grammar's `RELATIVE_KEYWORDS`. Those are tokens *stored* in a
 * saved view and resolved afresh every time it is opened, which is exactly right there and
 * exactly wrong here: a deadline is a day somebody has committed to, and one that quietly
 * moved itself to next Friday every Friday would be a deadline nobody could miss. So the
 * relatives are a shortcut for typing a date, and what gets written is the date.
 *
 * `endOfWeek` is absent from that grammar because two implementations could read it two ways;
 * here there is only one reader, so it can mean the one thing people mean by it — Friday.
 *
 * The hints are left to the caller through `relatives`, because writing a day out is a
 * locale decision and this file has no business making it.
 */
export function defaultRelatives(timezone: string, now: number): readonly DateRelative[] {
  const today = localDayOf(now, timezone);
  const weekday = isoWeekdayOf(today);
  return [
    { id: 'today', label: 'Today', date: formatDay(today) },
    { id: 'tomorrow', label: 'Tomorrow', date: formatDay(addDays(today, 1)) },
    // The Friday of the week the reader is in, which on a Saturday has already gone — so the
    // arithmetic wraps and it is next Friday rather than a day in the past.
    {
      id: 'endOfWeek',
      label: 'End of week',
      date: formatDay(addDays(today, (5 - weekday + 7) % 7)),
    },
    { id: 'nextWeek', label: 'Next week', date: formatDay(addDays(today, 8 - weekday)) },
  ];
}

/**
 * Calendar arithmetic on a civil day, with no timezone involved.
 *
 * `Date.UTC` here is not the bug `time.ts` warns about, and the difference is worth stating
 * because the two look identical. That bug is parsing a *day string* into an instant and then
 * reading it back in the reader's zone. This takes a day that `localDayOf` has already reduced
 * to three numbers in the owning zone, walks the calendar, and hands it straight to
 * `formatDay`. No instant is derived from it and no zone is applied to it, so there is nothing
 * for an offset to shift.
 */
export function addDays(day: CivilDay, count: number): CivilDay {
  const at = new Date(Date.UTC(day.year, day.month - 1, day.day + count));
  return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, day: at.getUTCDate() };
}

/** Monday is 1 and Sunday is 7, matching ISO and matching `relative.ts`'s week. */
export function isoWeekdayOf(day: CivilDay): number {
  const weekday = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}
