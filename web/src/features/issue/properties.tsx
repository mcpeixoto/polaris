/**
 * The two property surfaces the detail rail has that a bulk action has no shape for: an
 * estimate, and a due date.
 *
 * They sit here rather than in `pickers.tsx` because both of them need something the three
 * pickers there deliberately do not: an estimate has to read the *team* before it knows what
 * to offer, and a due date is a calendar day whose urgency can only be judged against a clock
 * and a timezone. The three in `pickers.tsx` are pure functions of their props, which is what
 * lets the list hand them a value of `MIXED`; these two are not, and mixing the two kinds in
 * one file would make the simpler contract look optional.
 *
 * Everything else follows that file exactly. Each picker is controlled, does not own its
 * trigger (see `useMenuTrigger`), does not perform the write, and reports a chosen value for
 * the caller to decide what to do with. `Mixed` is imported from there rather than restated,
 * because a second definition of "these rows disagree" is a second answer to what a tick
 * means.
 *
 * Two invariants run through the whole file and are the reason it is worth reading before
 * editing:
 *
 * **Unestimated is not zero.** `undefined` means nobody has said and `0` means somebody said
 * none, and a picker that offered one row for both would quietly convert every unsized issue
 * in a workspace into a zero-point one the first time somebody cleared a field. So the value
 * type carries `null` for "no estimate" the way `AssigneePicker` carries it for "nobody", and
 * `onSelect` hands `null` back rather than `0`.
 *
 * **A due date is a day, not an instant.** It is reckoned in the *team's* timezone, because
 * "overdue" is a fact about the team's Friday rather than the reader's — two people looking at
 * one issue from Lisbon and Los Angeles must not disagree about whether it has slipped. Every
 * clock on this path is injected for the same reason `useView` injects one: a component whose
 * answer depends on an ambient `Date.now()` cannot be tested at a boundary, only by waiting.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import { useActions, useKeyContext } from '~/app/keymap';
import { Button, Input, Menu, type MenuNode, type MenuPlacement } from '~/components';
import {
  estimateLabel,
  estimateOptions,
  estimatesEnabled,
  type EstimateSettings,
} from '~/features/estimate';
import { isOverdue, whenDay } from '~/features/time';
import { formatDay, localDayOf, type CivilDay } from '~/filter';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { DateOnly, DueDateSource, UUID } from '~/store';

import type { Mixed } from './pickers';
import styles from './properties.module.css';

/** The props every picker in this feature shares. Mirrors the one in `pickers.tsx`. */
interface PickerProps {
  open: boolean;
  onClose: () => void;
  /** The control the picker belongs to: what it is positioned against, and where focus returns. */
  trigger: RefObject<HTMLElement | null>;
}

/* ---------------------------------------------------------------------------------------
 * Estimates.
 */

/** The id of the "no estimate" row. A word rather than a number, because none is not zero. */
const UNESTIMATED = 'unestimated';

export interface EstimatePickerProps extends PickerProps {
  /** The team whose scale is on offer. The scale is a team setting; the number is the issue's. */
  teamId: UUID;
  /**
   * The current estimate: a point value, `null` when there is none, `undefined` when the
   * targets disagree.
   *
   * The three cases are separate for the reason `AssigneePicker`'s are: `null` is a real
   * answer — nobody has sized this — and a picker that read it as "mixed" would leave the
   * tick off the row the user is looking straight at.
   */
  value: number | null | Mixed;
  /** `null` clears the estimate. Zero is a real estimate and is never sent in its place. */
  onSelect: (estimate: number | null) => void;
  placement?: MenuPlacement | undefined;
}

/**
 * The team's estimate scale, in that scale's own vocabulary.
 *
 * A t-shirt team sees S, M and L; a Fibonacci team sees 1, 2, 3, 5, 8. Both store the same
 * numbers — see `~/features/estimate`, which owns the ladders and is the only place they are
 * written down — so a team switching scales renames every estimate in it without rewriting a
 * single issue. Restating a ladder here would be a second copy of that decision, and the copy
 * is the one that would be missing the extended top end.
 *
 * Renders nothing at all when the team does not estimate. That is not the same as an empty
 * menu: `none` means the product has no opinion to offer, and an empty popover under a button
 * reads as a control that failed to load. The caller should use `estimatesEnabled` to leave
 * the whole property row out for the same reason.
 */
export function EstimatePicker({
  open,
  onClose,
  trigger,
  placement,
  teamId,
  value,
  onSelect,
}: EstimatePickerProps) {
  const team = useLiveQuery<EstimateSettings | null>(
    (store) => {
      const found = store.get('team', teamId);
      if (found === undefined) return null;
      // Projected to the three fields that matter rather than held whole, so a team renamed
      // in another session does not re-render an open picker.
      return {
        estimateScale: found.estimateScale,
        estimateAllowZero: found.estimateAllowZero,
        estimateExtended: found.estimateExtended,
      };
    },
    ['team'],
    [teamId],
  );

  // A team the replica has not received yet is not a team that estimates in zeroes; it is one
  // this client cannot answer for, and offering a ladder chosen by default would let somebody
  // set an estimate their team does not use.
  if (team === null || !estimatesEnabled(team)) return null;

  const items: MenuNode[] = [
    {
      id: UNESTIMATED,
      label: 'No estimate',
      // Type-ahead has to reach this row by the words a person would use for it, and none of
      // them are in the label: "none" and "clear" are what somebody types when they mean it.
      text: 'no estimate unestimated none clear',
      selected: value === null,
      onSelect: () => onSelect(null),
    },
    { kind: 'separator' },
    ...estimateOptions(team).map((points) => ({
      id: `estimate-${points}`,
      label: estimateLabel(points, team.estimateScale),
      selected: points === value,
      onSelect: () => onSelect(points),
    })),
  ];

  return (
    <Menu
      open={open}
      onClose={onClose}
      trigger={trigger}
      items={items}
      label="Estimate"
      placement={placement}
    />
  );
}

/* ---------------------------------------------------------------------------------------
 * Due dates.
 */

/** How far ahead still counts as urgent: today and tomorrow. See `dueDateTone`. */
const SOON_DAYS = 1;

/** Kept off the viewport edge by this much when the panel has to be shifted to fit. */
const VIEWPORT_MARGIN_PX = 8;

/**
 * `2006-01-02`, and nothing else.
 *
 * The same shape `time.ts` parses with, restated because that module keeps its pattern
 * private and exposes only the two questions it answers. This one asks a third — is what is
 * in the box a day yet — which a half-typed `2026-0` must answer no to, or the panel would
 * write a due date the server rejects and the reader cannot explain.
 */
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

export type DueDateTone = 'overdue' | 'soon' | 'later';

/** What the tone means, for the readers who cannot see a colour. */
const TONE_WORDS: Readonly<Record<DueDateTone, string>> = {
  overdue: 'overdue',
  soon: 'due soon',
  later: 'due',
};

/**
 * How urgent a due date is, reckoned in the zone the day belongs to.
 *
 * The zone is the argument that matters. `2026-09-01` is overdue in Lisbon two hours before it
 * is overdue in London and eight before Los Angeles, and a client that asked the reader's
 * browser instead would show two people looking at one issue two different answers — which is
 * a missed deadline rather than a rounding error.
 *
 * Exported because the list and the board want the same three words for the same date, and a
 * second definition of "soon" is how a row goes amber in one view and not in another.
 */
export function dueDateTone(
  date: DateOnly,
  timezone: string,
  now: number = Date.now(),
): DueDateTone {
  if (isOverdue(date, timezone, now)) return 'overdue';
  // String comparison, which is correct for this format: `2026-09-01` < `2026-09-02` both
  // lexically and calendrically, and it avoids deriving the zone's midnight a second time.
  return date <= formatDay(addDays(localDayOf(now, timezone), SOON_DAYS)) ? 'soon' : 'later';
}

export interface DueDateValueProps {
  /** The day as stored, or `null` when the issue has none. */
  value: DateOnly | null;
  /** The zone the day is reckoned in: the team's, never the reader's. */
  timezone: string;
  /** Pins the clock. Tests only; the wall clock is read at render time otherwise. */
  now?: number | undefined;
  /** Which subsystem owns the date. An `sla` date is a commitment rather than a plan. */
  source?: DueDateSource | undefined;
  className?: string | undefined;
}

/**
 * A due date as it should be read: the day, and how much trouble it is in.
 *
 * A separate component from the picker because the trigger that opens the picker is the
 * caller's — the rail draws a Button, a row in a list draws a cell — and both of them need the
 * same three-way judgement made against the same clock. Leaving that to each caller is how a
 * date goes red in the rail and stays grey in the row above it.
 *
 * The tone is never only a colour. The word goes into the element's text where a screen reader
 * will find it and a `title` where a pointer will, because "this one is red" is not a message
 * that survives a colourblind reader, a monochrome print or a custom theme — the same rule
 * `Badge` states and for the same reason.
 */
export function DueDateValue({
  value,
  timezone,
  now = Date.now(),
  source = 'manual',
  className,
}: DueDateValueProps) {
  if (value === null) {
    return <span className={[styles.value, className].filter(Boolean).join(' ')}>No due date</span>;
  }

  const tone = dueDateTone(value, timezone, now);
  const day = whenDay(value, timezone, now);
  const qualified = `${day}, ${TONE_WORDS[tone]}${source === 'sla' ? ', set by an SLA' : ''}`;

  return (
    <span
      className={[styles.value, styles[tone], className].filter(Boolean).join(' ')}
      title={qualified}
    >
      {/* Two renderings of one fact rather than a word appended to the date. The seen half is
          hidden from the accessibility tree and the heard half carries the whole phrase,
          because a reader given both would be told the date twice — and appending "overdue" to
          a visible "Sep 1" leaves a screen reader announcing two nodes that only make a
          sentence if it happens to pause between them. */}
      <span aria-hidden="true">{day}</span>
      <span className={styles.srOnly}>{qualified}</span>
    </span>
  );
}

export interface DueDatePickerProps extends PickerProps {
  /** The day as stored, or `null` when there is none. */
  value: DateOnly | null;
  /**
   * Which subsystem owns the date.
   *
   * `sla` means a policy put it there, and a human moving it would be overwritten by the next
   * evaluation of that policy. The panel says so rather than offering controls that do
   * nothing, because a control that silently declines is indistinguishable from a bug.
   */
  source: DueDateSource;
  /** The zone the relatives are resolved in: the team's, never the reader's. */
  timezone: string;
  /** Pins the clock. Tests only; the wall clock is read when the panel opens otherwise. */
  now?: number | undefined;
  /** `null` clears the due date. */
  onSelect: (dueDate: DateOnly | null) => void;
  /** Takes the issue out of SLA ownership so a human can set the date again. */
  onClearSla?: () => void;
  /** Applies a duration as an SLA-owned due date. */
  onSetSla?: (minutes: number) => void;
}

/**
 * The due-date panel: four relatives, a date box, and the way to clear it.
 *
 * A panel of real controls rather than a `Menu`, which is the one deviation from `pickers.tsx`
 * worth arguing for and is the same one `DisplayMenu` makes. A Menu is a list of commands its
 * own key handler walks with the arrow keys; a date box inside one would swallow every digit
 * the menu wants to type-ahead with, and a menu item containing a text field is a widget no
 * screen reader has a name for. So the popover shell is local and everything inside it is the
 * library's.
 *
 * The relatives are what people actually mean. "End of week" is the Friday of the week the
 * reader is in — on Saturday that Friday has gone, so it is the next one — and "next week" is
 * the following Monday, both resolved in the team's zone at the moment the panel opens.
 *
 * On the keyboard: Escape is a registered action in the `menu` context, which the panel pushes
 * while it is open. That context is sealed, so `S`, `A` and `P` stop reaching the detail screen
 * underneath while somebody is typing a date. Only ONE surface on a screen may claim Escape in
 * `menu` — the registry refuses a second — which is why the relations panel beside this one
 * adds its links inline instead of in a popover of its own.
 */
export function DueDatePicker({
  open,
  onClose,
  trigger,
  value,
  source,
  timezone,
  now,
  onSelect,
  onClearSla,
  onSetSla,
}: DueDatePickerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [point, setPoint] = useState<Point | null>(null);
  const [draft, setDraft] = useState('');
  // Positioning settles once per opening: the shift is measured from the panel's rendered
  // rect, and re-measuring after moving it would chase its own tail.
  const settledRef = useRef(false);

  /**
   * What the registered Escape reads. The registry captures `run` once, at registration, so a
   * closure over `onClose` would go on calling whichever callback the first render happened to
   * pass — the same reason the issue list reaches its commands through a ref.
   */
  const state = useRef({ open, close: onClose });
  state.current = { open, close: onClose };

  useKeyContext('menu', open);

  useActions(
    [
      {
        id: 'dueDate.closePicker',
        title: 'Close the due date picker',
        keys: ['Escape'],
        when: 'menu',
        group: 'Issues',
        // Hidden from the command menu: "close the thing that is open" is not something
        // anybody searches for, and it still appears in the help overlay.
        hidden: true,
        // Disabled is treated as unbound, so with the panel shut Escape falls through to
        // whatever else claims it rather than being swallowed by a command with nothing to do.
        enabled: () => state.current.open,
        run: () => state.current.close(),
      },
    ],
    [],
  );

  // The box starts on the date the issue actually has, so somebody nudging a deadline by a day
  // edits the day rather than retyping the year. Reset on close rather than on open, so the
  // panel is never rendered for a frame holding the previous issue's date.
  useEffect(() => {
    if (!open) setDraft('');
    else setDraft(value ?? '');
  }, [open, value]);

  useLayoutEffect(() => {
    if (!open) {
      setPoint(null);
      settledRef.current = false;
      return;
    }
    const anchor = trigger.current;
    if (anchor === null) return;
    const rect = anchor.getBoundingClientRect();
    setPoint({ top: rect.bottom, left: rect.left });
  }, [open, trigger]);

  useLayoutEffect(() => {
    if (!open || point === null || settledRef.current) return;
    const panel = panelRef.current;
    if (panel === null) return;
    settledRef.current = true;
    const shift = horizontalShift(panel.getBoundingClientRect());
    if (shift !== 0) setPoint({ top: point.top, left: point.left + shift });
  }, [open, point]);

  useEffect(() => {
    if (!open) return;
    // Captured while open. Reading the ref inside the cleanup would read whatever it points at
    // by then, which after an unmount is null — and the focus restore would silently stop.
    const anchorAtOpen = trigger.current;
    return () => {
      // Only when closing is what lost the focus. Clicking straight into another control
      // closes this too, and dragging focus back out of the field somebody has just clicked
      // into is worse than not restoring it at all.
      const active = document.activeElement;
      if (active === null || active === document.body) anchorAtOpen?.focus();
    };
  }, [open, trigger]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target) === true) return;
      if (trigger.current?.contains(target) === true) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, onClose, trigger]);

  if (!open) return null;

  const style: CSSProperties = point === null ? {} : { top: point.top, left: point.left };

  const choose = (day: DateOnly | null) => {
    onSelect(day);
    // A picker is a decision, so choosing closes it — the same bargain `Menu` makes.
    onClose();
  };

  return createPortal(
    <div
      ref={panelRef}
      // A dialog rather than a menu: it holds a text field and a form, and `menu` promises a
      // list of commands the arrow keys walk. Not `aria-modal` either — the issue behind it
      // stays readable, which is the point of editing a property in place.
      role="dialog"
      aria-label="Due date"
      className={styles.panel}
      style={style}
      tabIndex={-1}
    >
      {source === 'sla' ? (
        // Said rather than enforced silently. A disabled control with no explanation is
        // indistinguishable from a broken one, and the person looking at it is usually the
        // person who most needs to know that a policy is holding the date.
        <>
          <p className={styles.note}>
            This date is set by a service-level agreement, so it is not yours to move. Changing it
            here would be overwritten the next time the policy is evaluated. Change the policy on
            the team, or take the issue out of its scope.
          </p>
          <div className={styles.footer}>
            {onClearSla === undefined ? null : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onClearSla();
                  onClose();
                }}
              >
                Remove SLA
              </Button>
            )}
            <Button size="sm" variant="primary" onClick={onClose}>
              Close
            </Button>
          </div>
        </>
      ) : (
        <>
          <ul className={styles.relatives}>
            {relativesFor(timezone, now ?? Date.now()).map((relative) => {
              const day = whenDay(relative.date, timezone, now);
              return (
                <li key={relative.id}>
                  <button
                    type="button"
                    className={styles.relative}
                    aria-current={relative.date === value ? true : undefined}
                    onClick={() => choose(relative.date)}
                  >
                    <span>{relative.label}</span>
                    {/* The resolved day, because "end of week" is a promise the panel has to
                        show it is keeping — and because somebody checking a date against a
                        calendar should not have to count. Suppressed where it would only
                        repeat the label: "Today Today" is not a second piece of information,
                        and a screen reader says both of them. */}
                    {day === relative.label ? null : (
                      <span className={styles.relativeDay}>{day}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          {/* A form purely so that Enter commits. The alternative is a local key handler,
              which the keymap lint refuses for good reason; submitting a form is the
              platform's own answer to the same problem and needs no handler at all. */}
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
            <Button
              size="sm"
              variant="ghost"
              disabled={value === null}
              onClick={() => choose(null)}
            >
              No due date
            </Button>
            {onSetSla === undefined ? null : (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    onSetSla(1440);
                    onClose();
                  }}
                >
                  24-hour SLA
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    onSetSla(10080);
                    onClose();
                  }}
                >
                  1-week SLA
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}

interface Point {
  readonly top: number;
  readonly left: number;
}

/** How far the panel must move horizontally to stay on screen. Zero when it already fits. */
function horizontalShift(rect: DOMRect): number {
  if (rect.right > window.innerWidth - VIEWPORT_MARGIN_PX) {
    return Math.max(
      window.innerWidth - VIEWPORT_MARGIN_PX - rect.right,
      VIEWPORT_MARGIN_PX - rect.left,
    );
  }
  if (rect.left < VIEWPORT_MARGIN_PX) return VIEWPORT_MARGIN_PX - rect.left;
  return 0;
}

interface Relative {
  readonly id: string;
  readonly label: string;
  readonly date: DateOnly;
}

/**
 * The four days worth offering, resolved in the team's zone.
 *
 * Deliberately not the filter grammar's `RELATIVE_KEYWORDS`. Those are tokens *stored* in a
 * saved view and resolved afresh every time it is opened, which is exactly right there and
 * exactly wrong here: a due date is a day the team has committed to, and a due date that
 * quietly moved itself to next Friday every Friday would be a deadline nobody could miss. So
 * the relatives are a shortcut for typing a date, and what gets written is the date.
 *
 * `endOfWeek` is absent from that grammar because two implementations could read it two ways;
 * here there is only one reader, so it can mean the one thing people mean by it — Friday.
 */
function relativesFor(timezone: string, now: number): readonly Relative[] {
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
 * to three numbers in the team's zone, walks the calendar, and hands it straight to
 * `formatDay`. No instant is derived from it and no zone is applied to it, so there is nothing
 * for an offset to shift.
 */
function addDays(day: CivilDay, count: number): CivilDay {
  const at = new Date(Date.UTC(day.year, day.month - 1, day.day + count));
  return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, day: at.getUTCDate() };
}

/** Monday is 1 and Sunday is 7, matching ISO and matching `relative.ts`'s week. */
function isoWeekdayOf(day: CivilDay): number {
  const weekday = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}
