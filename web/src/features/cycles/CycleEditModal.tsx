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
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Button, Input, Modal } from '~/components';
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
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [dateError, setDateError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cycleId = cycle?.id ?? null;
  useEffect(() => {
    if (cycle === null) return;
    setName(cycle.name);
    setDescription(cycle.description ?? '');
    setStartDate(dayIn(cycle.startsAt, timezone));
    setEndDate(dayIn(cycle.endsAt, timezone));
    setDateError(null);
    setError(null);
  }, [cycleId, cycle, timezone]);

  if (cycle === null) return null;

  const canEditStart = !datesLocked && phase === 'Upcoming';
  const canEditEnd = !datesLocked && (phase === 'Current' || phase === 'Upcoming');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') return;

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

    setBusy(true);
    setError(null);
    void Promise.resolve()
      .then(() => onSave(edit))
      .then(
        () => {
          setBusy(false);
          onClose();
        },
        (cause: unknown) => {
          setBusy(false);
          setError(cause instanceof ApiError ? cause.message : 'Could not save this cycle.');
        },
      );
  };

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
      initialFocus={nameRef}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {/* Primary, because it is the one thing this dialog is for and the command
              Enter runs. Two neutral buttons beside each other is a dialog declining to
              say what happens when you press return. */}
          <Button
            variant="primary"
            loading={busy}
            onClick={() => nameRef.current?.form?.requestSubmit()}
            disabled={name.trim() === ''}
          >
            Save
          </Button>
        </>
      }
    >
      <form className={styles.form} onSubmit={submit}>
        <Input
          ref={nameRef}
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Input
          label="Description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        {canEditStart ? (
          <Input
            label="Starts"
            type="date"
            value={startDate}
            onChange={(event) => {
              setStartDate(event.target.value);
              setDateError(null);
            }}
          />
        ) : null}
        {canEditEnd ? (
          <Input
            label="Ends"
            type="date"
            value={endDate}
            error={dateError ?? undefined}
            onChange={(event) => {
              setEndDate(event.target.value);
              setDateError(null);
            }}
          />
        ) : null}
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
