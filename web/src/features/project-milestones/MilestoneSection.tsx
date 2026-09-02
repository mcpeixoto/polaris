/**
 * The project's milestones, under the description, where the product says they belong.
 *
 * `projectMilestone` has been a first-class row in the replica and a tick on the timeline
 * since before this existed, and nothing in the client could create one — so every project
 * had an empty milestone axis and no way to fill it. This is the missing half: list, add,
 * rename, retarget, remove.
 *
 * Each row states its own progress in words as well as in the bar, because a bar is a
 * length and a length is not a number anybody can read back to a colleague.
 */

import { useState, type FormEvent } from 'react';

import { useEngine } from '~/app/context';
import { Button, Input } from '~/components';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { UUID } from '~/store';
import { ApiError } from '~/sync/api';

import { listProjectMilestones, type MilestoneRow } from './helpers';
import {
  createProjectMilestone,
  deleteProjectMilestone,
  updateProjectMilestone,
} from './mutations';
import styles from './MilestoneSection.module.css';

interface MilestoneSectionProps {
  readonly projectId: UUID;
}

export function MilestoneSection({ projectId }: MilestoneSectionProps) {
  const engine = useEngine();
  const [name, setName] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<UUID | null>(null);

  const rows = useLiveQuery(
    (store) => listProjectMilestones(store, projectId),
    ['projectMilestone', 'issue', 'workflowState'],
    [projectId],
  );

  const onAdd = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const trimmed = name.trim();
    if (trimmed === '') {
      setError('A milestone needs a name.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createProjectMilestone(engine, {
        projectId,
        name: trimmed,
        ...(targetDate === '' ? null : { targetDate }),
      });
      setName('');
      setTargetDate('');
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'That milestone was not created.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={styles.section} aria-labelledby={`milestones-${projectId}`}>
      <h2 className={styles.sectionTitle} id={`milestones-${projectId}`}>
        Milestones
      </h2>
      {rows.length === 0 ? (
        <p className={styles.empty}>No milestones yet. The first one is the next checkpoint.</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) =>
            editing === row.milestone.id ? (
              <li key={row.milestone.id} className={styles.row}>
                <MilestoneEdit row={row} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={row.milestone.id} className={styles.row}>
                <MilestoneReadout row={row} onEdit={() => setEditing(row.milestone.id)} />
              </li>
            ),
          )}
        </ul>
      )}
      <form className={styles.add} onSubmit={onAdd}>
        <Input
          label="Milestone"
          className={styles.addName}
          value={name}
          placeholder="What is the next checkpoint?"
          autoComplete="off"
          onChange={(event) => {
            setName(event.target.value);
            if (error !== null) setError(null);
          }}
        />
        <Input
          label="Target date"
          type="date"
          value={targetDate}
          onChange={(event) => setTargetDate(event.target.value)}
        />
        <Button type="submit" variant="secondary" disabled={saving}>
          Add milestone
        </Button>
      </form>
      {error === null ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

interface ReadoutProps {
  readonly row: MilestoneRow;
  readonly onEdit: () => void;
}

function MilestoneReadout({ row, onEdit }: ReadoutProps) {
  const engine = useEngine();
  const [error, setError] = useState<string | null>(null);
  const { milestone, percent, total } = row;

  const progress = total === 0 ? 'No issues yet' : `${percent}% · ${row.done} of ${total} issues`;

  const onDelete = () => {
    deleteProjectMilestone(engine, milestone.id).catch((failure: unknown) => {
      setError(failure instanceof ApiError ? failure.message : 'That milestone was not removed.');
    });
  };

  return (
    <>
      <div className={styles.head}>
        <span className={styles.name}>{milestone.name}</span>
        {/* The current focus says so in a word. The bar's colour carries the same fact and
            is not allowed to be the only thing that carries it. */}
        {row.current && <span className={styles.current}>Current</span>}
        <span className={styles.when}>
          {milestone.targetDate === undefined ? 'No target date' : formatDay(milestone.targetDate)}
        </span>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          aria-label={`Remove milestone ${milestone.name}`}
        >
          Remove
        </Button>
      </div>
      <div
        className={styles.track}
        role="img"
        aria-label={`${milestone.name}: ${progress}`}
        title={progress}
      >
        <span
          className={`${styles.fill ?? ''} ${row.current ? (styles.fillCurrent ?? '') : ''}`.trim()}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className={styles.progressText}>{progress}</span>
      {error === null ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </>
  );
}

interface EditProps {
  readonly row: MilestoneRow;
  readonly onDone: () => void;
}

function MilestoneEdit({ row, onDone }: EditProps) {
  const engine = useEngine();
  const [name, setName] = useState(row.milestone.name);
  const [targetDate, setTargetDate] = useState(row.milestone.targetDate ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const trimmed = name.trim();
    if (trimmed === '') {
      setError('A milestone needs a name.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateProjectMilestone(engine, row.milestone.id, {
        name: trimmed,
        // An emptied date field is a request to take the date off, which the API spells as
        // its own flag — see `ProjectMilestoneFields`.
        targetDate: targetDate === '' ? null : targetDate,
      });
      onDone();
    } catch (failure) {
      setSaving(false);
      setError(failure instanceof ApiError ? failure.message : 'That change was not saved.');
    }
  };

  return (
    <form className={styles.edit} onSubmit={onSubmit}>
      <Input
        label="Name"
        className={styles.addName}
        value={name}
        autoComplete="off"
        onChange={(event) => setName(event.target.value)}
      />
      <Input
        label="Target date"
        type="date"
        value={targetDate}
        onChange={(event) => setTargetDate(event.target.value)}
      />
      <div className={styles.editActions}>
        <Button type="submit" variant="primary" size="sm" disabled={saving}>
          Save milestone
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
      </div>
      {error === null ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function formatDay(day: string): string {
  return new Date(`${day.slice(0, 10)}T00:00:00.000Z`).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
