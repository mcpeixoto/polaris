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

import type { RefObject } from 'react';

import {
  addDays,
  Button,
  DatePicker,
  defaultRelatives,
  Menu,
  Popover,
  type DateRelative,
  type MenuNode,
  type MenuPlacement,
} from '~/components';
import {
  estimateLabel,
  estimateOptions,
  estimatesEnabled,
  type EstimateSettings,
} from '~/features/estimate';
import { isOverdue, whenDay } from '~/features/time';
import { formatDay, localDayOf } from '~/filter';
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
 * The due-date panel: the shared `DatePicker`, plus the two things only an issue has.
 *
 * Everything about choosing a day — the relatives, the date box, the popover shell, the
 * registered Escape — is `components/DatePicker`, because a project's target date and a
 * cycle's window ask exactly the same question. What stays here is what does not generalise:
 * an SLA owns the date on some issues, and an issue is the only thing in the product that can
 * be handed one.
 *
 * On the keyboard: Escape is a registered action in the `menu` context, under the id below.
 * Two guarded bindings may share a key, so a second picker elsewhere on the screen is fine —
 * a second picker with the *same id* is a thrown error, which is why the id is a constant here
 * and a required prop there.
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
  if (source === 'sla') {
    // Said rather than enforced silently. A disabled control with no explanation is
    // indistinguishable from a broken one, and the person looking at it is usually the person
    // who most needs to know that a policy is holding the date.
    return (
      <Popover
        open={open}
        onClose={onClose}
        trigger={trigger}
        label="Due date"
        actionId={CLOSE_PICKER}
        actionTitle="Close the due date picker"
        actionGroup="Issues"
        className={styles.slaPanel}
      >
        <p className={styles.note}>
          This date is set by a service-level agreement, so it is not yours to move. Changing it
          here would be overwritten the next time the policy is evaluated. Change the policy on the
          team, or take the issue out of its scope.
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
      </Popover>
    );
  }

  return (
    <DatePicker
      open={open}
      onClose={onClose}
      trigger={trigger}
      value={value}
      timezone={timezone}
      now={now}
      onSelect={onSelect}
      actionId={CLOSE_PICKER}
      actionGroup="Issues"
      label="Due date"
      clearLabel="No due date"
      relatives={dueRelatives(timezone, now)}
      footer={
        onSetSla === undefined ? null : (
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
        )
      }
    />
  );
}

/**
 * The id this panel's Escape is registered under.
 *
 * One constant for both branches: the SLA note and the picker are two renderings of one
 * panel, never on screen at once, so they claim one action rather than two that would have to
 * be kept from colliding.
 */
const CLOSE_PICKER = 'dueDate.closePicker';

/**
 * The shared relatives, each labelled with the day it resolves to.
 *
 * The day is written by `whenDay` through the UI's own locale, never the runner's — see
 * `features/locale.ts`, which exists because an English interface was rendering Portuguese
 * dates on a Portuguese machine. It is suppressed where it would only repeat the label:
 * "Today Today" is not a second piece of information, and a screen reader says both of them.
 */
function dueRelatives(timezone: string, now: number | undefined): readonly DateRelative[] {
  return defaultRelatives(timezone, now ?? Date.now()).map((relative) => {
    const day = whenDay(relative.date, timezone, now);
    return day === relative.label ? relative : { ...relative, hint: day };
  });
}
