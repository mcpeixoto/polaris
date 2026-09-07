/**
 * Edit a cycle's name, description, and — depending on phase — its dates.
 *
 * The dates are the hard part, and both halves of the problem are timezone-shaped. A
 * `<input type="date">` speaks calendar days and the store speaks instants, so the
 * conversion happens in the team's zone in both directions: reading a UTC calendar date out
 * of the instant made a no-op edit move the window by a day for every reader west of
 * Greenwich, and pasting the chosen day onto the stored time-of-day moved it back the other
 * way for everybody east.
 *
 * The dialog also refuses an end that is not after its start, and stays open when the write
 * is refused. It used to do neither: an inverted window collapsed the cycle graph to a
 * single point, and the caller wrapped every save in an empty catch, so a rejected edit
 * closed the dialog and looked like it had worked.
 *
 * It was also the one create-or-edit dialog in the product with no keymap registration at
 * all, which had two consequences: ⌘⏎ did nothing in it, and `j`/`k` fell straight through
 * to the cycle list behind it, so typing a name moved the selection on a screen the reader
 * could not see. `useKeyContext('modal')` seals that, and `cycle.edit.submit` is the chord
 * every sibling dialog already answers.
 */

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { useActions, useKeyContext } from '~/app/keymap';
import { Button, DatePicker, Input, Modal, PropertyPill, Textarea } from '~/components';
import { whenDay } from '~/features/time';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import type { Cycle } from '~/store';
import { ApiError } from '~/sync/api';

import { dayIn, withDay } from './zone';
import styles from './CycleEditModal.module.css';

export interface CycleEditModalProps {
  open: boolean;
  cycle: Cycle | null;
  phase: 'Current' | 'Upcoming' | 'Previous';
  /** The team's zone: the one the cycle's days are reckoned in. */
  timezone: string;
  /** Dates follow a parent team; only name and description stay editable. */
  datesLocked?: boolean | undefined;
  onClose: () => void;
  /**
   * Performs the write. Rejecting keeps the dialog open with the reason on it, so the
   * caller hands back the mutation's promise rather than swallowing it.
   */
  onSave: (edit: {
    name: string;
    description: string;
    clearDescription: boolean;
    startsAt?: string;
    endsAt?: string;
  }) => void | Promise<void>;
}

export function CycleEditModal({
  open,
  cycle,
  phase,
  timezone,
  datesLocked = false,
  onClose,
  onSave,
}: CycleEditModalProps) {
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const startTrigger = useMenuTrigger<HTMLButtonElement>('dialog');
  const endTrigger = useMenuTrigger<HTMLButtonElement>('dialog');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** True from the moment a save is accepted until it settles. See the note in `save`. */
  const inFlight = useRef(false);

  const cycleId = cycle?.id ?? null;
  useEffect(() => {
    if (cycle === null) return;
    setName(cycle.name);
    setDescription(cycle.description ?? '');
    setStartDate(dayIn(cycle.startsAt, timezone));
    setEndDate(dayIn(cycle.endsAt, timezone));
    setNameError(null);
    setDateError(null);
    setError(null);
  }, [cycleId, cycle, timezone]);

  const canEditStart = cycle !== null && !datesLocked && phase === 'Upcoming';
  const canEditEnd =
    cycle !== null && !datesLocked && (phase === 'Current' || phase === 'Upcoming');

  const save = () => {
    if (cycle === null) return;
    const trimmed = name.trim();
    if (trimmed === '') {
      // It used to return here in silence, leaving a dialog that answered Save by doing
      // nothing at all. Its siblings say what is missing and put the caret where it goes.
      setNameError('A cycle needs a name');
      nameRef.current?.focus();
      return;
    }
    setNameError(null);

    const edit: Parameters<CycleEditModalProps['onSave']>[0] = {
      name: trimmed,
      description: description.trim(),
      clearDescription: description.trim() === '',
    };
    if (canEditStart && startDate !== dayIn(cycle.startsAt, timezone)) {
      edit.startsAt = withDay(startDate, cycle.startsAt, timezone);
    }
    if (canEditEnd && endDate !== dayIn(cycle.endsAt, timezone)) {
      edit.endsAt = withDay(endDate, cycle.endsAt, timezone);
    }

    const start = Date.parse(edit.startsAt ?? cycle.startsAt);
    const end = Date.parse(edit.endsAt ?? cycle.endsAt);
    if (end <= start) {
      setDateError('The end has to come after the start.');
      return;
    }
    setDateError(null);

    // Written in the same statement as `setBusy`, and read before it: `busy` is state and
    // so is a frame late, which leaves a window in which a second ⌘⏎ — or Enter on the
    // button in the same tick — files the edit twice. `useDialogSubmit` makes the same
    // trade for the create dialogs; this one hands its promise back to the caller and
    // cannot use it.
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    void Promise.resolve()
      .then(() => onSave(edit))
      .then(
        () => {
          inFlight.current = false;
          setBusy(false);
          onClose();
        },
        (cause: unknown) => {
          inFlight.current = false;
          setBusy(false);
          setError(cause instanceof ApiError ? cause.message : 'Could not save this cycle.');
        },
      );
  };

  // Reassigned every render and read at dispatch: the registry keeps the action object it
  // was handed at mount, so a `run` closing over this render's `save` would go on saving the
  // cycle as it stood when the dialog opened.
  const submitRef = useRef<() => void>(() => {});
  submitRef.current = save;

  // Sealed while it is up, which is the half that was missing: without a context of its own
  // the list behind this dialog went on answering `j` and `k` while somebody typed a name.
  useKeyContext('modal', open);
  useActions(
    open
      ? [
          {
            id: 'cycle.edit.submit',
            title: 'Save cycle',
            keys: ['mod+Enter'],
            when: 'modal',
            group: 'Cycles',
            hidden: true,
            run: () => submitRef.current(),
          },
        ]
      : [],
    [open],
  );

  if (cycle === null) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit ${cycle.name}`}
      description={
        datesLocked
          ? "This sub-team inherits its parent's cycle dates. Rename the window here; change the schedule on the parent team."
          : phase === 'Current'
            ? 'The current cycle can only move its end date. Shortening it creates a pause before the next cycle.'
            : phase === 'Upcoming'
              ? 'Upcoming cycles can move both start and end.'
              : 'Past cycles keep their dates; only the name and description can change here.'
      }
      size="md"
      initialFocus={nameRef}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {/* Primary, because it is the one thing this dialog is for and the command
              Enter runs. Two neutral buttons beside each other is a dialog declining to
              say what happens when you press return. */}
          <Button form={formId} type="submit" variant="primary" loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className={styles.form}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          // The picker panels are portalled out of this form's DOM but stay inside its React
          // tree, so the little form each of them uses to commit a typed value bubbles its
          // submit through here. Only this form's own submit is a save; without the check,
          // setting a date filed the edit as a side effect of choosing one.
          if (event.target !== event.currentTarget) return;
          save();
        }}
      >
        <Input
          ref={nameRef}
          label="Name"
          value={name}
          error={nameError ?? undefined}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(null);
          }}
        />
        {/* A cycle's description is the paragraph explaining what this fortnight is for. A
            single-line box for it was a field arguing with its own content. */}
        <Textarea
          label="Description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          minRows={3}
        />
        {canEditStart || canEditEnd ? (
          <div className={styles.dates}>
            {canEditStart ? (
              <>
                <PropertyPill {...startTrigger.props} name="Starts" describe={`${formId}-starts`}>
                  {whenDay(startDate, timezone)}
                </PropertyPill>
                <DatePicker
                  open={startTrigger.open}
                  onClose={startTrigger.hide}
                  trigger={startTrigger.ref}
                  value={startDate}
                  timezone={timezone}
                  label="Starts"
                  // Distinct from the end picker's, because both are mounted at once and the
                  // registry refuses a duplicate action id rather than letting one Escape
                  // quietly shadow the other.
                  actionId="cycle.closeStartDate"
                  actionGroup="Cycles"
                  // A cycle always has a window, so there is no day to clear to. The row is
                  // the panel's own and cannot be taken away; choosing it is ignored.
                  clearLabel="Keep this date"
                  onSelect={(day) => {
                    if (day === null) return;
                    setStartDate(day);
                    setDateError(null);
                  }}
                />
              </>
            ) : null}
            {canEditEnd ? (
              <>
                <PropertyPill {...endTrigger.props} name="Ends" describe={`${formId}-ends`}>
                  {whenDay(endDate, timezone)}
                </PropertyPill>
                <DatePicker
                  open={endTrigger.open}
                  onClose={endTrigger.hide}
                  trigger={endTrigger.ref}
                  value={endDate}
                  timezone={timezone}
                  label="Ends"
                  actionId="cycle.closeEndDate"
                  actionGroup="Cycles"
                  clearLabel="Keep this date"
                  onSelect={(day) => {
                    if (day === null) return;
                    setEndDate(day);
                    setDateError(null);
                  }}
                />
              </>
            ) : null}
          </div>
        ) : null}
        {dateError === null ? null : (
          <p className={styles.error} role="alert">
            {dateError}
          </p>
        )}
        {error === null ? null : (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

export function phaseOf(cycle: Cycle, now: number): 'Current' | 'Upcoming' | 'Previous' {
  const start = Date.parse(cycle.startsAt);
  const end = Date.parse(cycle.endsAt);
  if (cycle.completedAt !== undefined || end <= now) return 'Previous';
  if (start <= now && now < end) return 'Current';
  return 'Upcoming';
}

export function isNextUpcoming(cycle: Cycle, storeCycles: readonly Cycle[], now: number): boolean {
  let next: Cycle | null = null;
  for (const candidate of storeCycles) {
    if (candidate.completedAt !== undefined || Date.parse(candidate.startsAt) <= now) continue;
    if (next === null || Date.parse(candidate.startsAt) < Date.parse(next.startsAt)) {
      next = candidate;
    }
  }
  return next?.id === cycle.id;
}
