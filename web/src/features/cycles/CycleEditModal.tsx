/**
 * Edit a cycle's name, description, and — depending on phase — its dates.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Button, Input, Modal } from '~/components';
import type { Cycle } from '~/store';

import styles from './CycleEditModal.module.css';

export interface CycleEditModalProps {
  open: boolean;
  cycle: Cycle | null;
  phase: 'Current' | 'Upcoming' | 'Previous';
  /** Dates follow a parent team; only name and description stay editable. */
  datesLocked?: boolean | undefined;
  onClose: () => void;
  onSave: (edit: {
    name: string;
    description: string;
    clearDescription: boolean;
    startsAt?: string;
    endsAt?: string;
  }) => void;
}

export function CycleEditModal({
  open,
  cycle,
  phase,
  datesLocked = false,
  onClose,
  onSave,
}: CycleEditModalProps) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const cycleId = cycle?.id ?? null;
  useEffect(() => {
    if (cycle === null) return;
    setName(cycle.name);
    setDescription(cycle.description ?? '');
    setStartDate(toDateInput(cycle.startsAt));
    setEndDate(toDateInput(cycle.endsAt));
  }, [cycleId, cycle]);

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
    if (canEditStart && startDate !== toDateInput(cycle.startsAt)) {
      edit.startsAt = mergeDate(startDate, cycle.startsAt);
    }
    if (canEditEnd && endDate !== toDateInput(cycle.endsAt)) {
      edit.endsAt = mergeDate(endDate, cycle.endsAt);
    }
    onSave(edit);
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
          <Button
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
            onChange={(event) => setStartDate(event.target.value)}
          />
        ) : null}
        {canEditEnd ? (
          <Input
            label="Ends"
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        ) : null}
      </form>
    </Modal>
  );
}

function toDateInput(iso: string): string {
  return iso.slice(0, 10);
}

/** Keep the time-of-day from the existing instant; swap the calendar date from the input. */
function mergeDate(date: string, templateIso: string): string {
  return `${date}${templateIso.slice(10)}`;
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
