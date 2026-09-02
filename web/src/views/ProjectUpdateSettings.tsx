/**
 * Settings → Project updates: the workspace's default update cadence.
 *
 * The two number fields hold a draft and commit it on blur or Enter, because saving from
 * `onChange` sent a mutation per keystroke — typing "14" wrote 1 and then 14 — and a
 * cleared field parsed to NaN, which was skipped, so the input could not be emptied to
 * retype it. Committing once also means the declared range can actually be enforced:
 * `min`/`max` are advisory on a typed value and the server would have taken 0 or 900.
 */

import { useState } from 'react';

import { useEngine } from '~/app/context';
import { Input, SaveIndicator, Select, useSaveState } from '~/components';
import { report } from '~/features/issue/mutations';
import { updateWorkspaceReminderCadence } from '~/features/workspace/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Store } from '~/store';
import { ApiError } from '~/sync/api';

import styles from '~/features/labels/LabelSettings.module.css';
import own from './ProjectUpdateSettings.module.css';

const WEEKDAYS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
] as const;

const INTERVAL_MIN = 1;
const INTERVAL_MAX = 365;
const HOUR_MIN = 0;
const HOUR_MAX = 23;

/** The typed text, or null when the field is showing the stored value. */
type Draft = string | null;

export function clampInt(text: string, min: number, max: number): number | null {
  const parsed = Number.parseInt(text.trim(), 10);
  if (Number.isNaN(parsed)) return null;
  return Math.min(max, Math.max(min, parsed));
}

function describe(failure: unknown): string {
  return failure instanceof ApiError ? failure.message : 'That change could not be saved.';
}

/**
 * The write, with the failure reported before it is re-thrown — `useSaveState` needs the
 * rejection to draw the failed state, and the log needs it whether or not anyone reads the
 * banner.
 */
function persist(
  engine: Parameters<typeof updateWorkspaceReminderCadence>[0],
  fields: Parameters<typeof updateWorkspaceReminderCadence>[1],
): Promise<unknown> {
  return updateWorkspaceReminderCadence(engine, fields).catch((failure: unknown) => {
    report(failure);
    throw failure;
  });
}

export function ProjectUpdateSettings() {
  const engine = useEngine();
  const save = useSaveState(describe);
  const [intervalDraft, setIntervalDraft] = useState<Draft>(null);
  const [hour, setHour] = useState<Draft>(null);

  const workspace = useLiveQuery(
    (store: Store) => store.workspaces.get(store.workspaceId) ?? null,
    ['workspace'],
  );

  if (workspace === null) {
    return null;
  }

  const commit = (
    draft: Draft,
    setDraft: (next: Draft) => void,
    stored: number,
    min: number,
    max: number,
    write: (value: number) => Parameters<typeof updateWorkspaceReminderCadence>[1],
  ) => {
    setDraft(null);
    if (draft === null) return;
    // An empty or unparseable field is a change of mind, not a value: put the stored
    // number back rather than writing something the reader did not choose.
    const next = clampInt(draft, min, max);
    if (next === null || next === stored) return;
    void save.run(() => persist(engine, write(next)));
  };

  return (
    <div className={`${styles.screen ?? ''} ${own.enter ?? ''}`}>
      <header className={styles.header}>
        <h1 className={styles.title}>Project updates</h1>
      </header>

      <div className={styles.body}>
        {save.error === undefined ? null : (
          <p className={styles.error} role="alert">
            {save.error}
          </p>
        )}

        <section className={styles.section}>
          <p className={styles.sectionHint}>
            How often an in-progress project is expected to post an update. A project whose last
            update is older than the interval is flagged as due on the projects list, and marked
            Update missing three days after that. Each project can override the schedule.
          </p>

          <div className={own.fields}>
            <Input
              type="number"
              inputMode="numeric"
              label="Reminder interval"
              hint={`Days between updates, ${INTERVAL_MIN}–${INTERVAL_MAX}.`}
              min={INTERVAL_MIN}
              max={INTERVAL_MAX}
              value={intervalDraft ?? String(workspace.projectUpdateReminderIntervalDays)}
              onChange={(event) => {
                save.clear();
                setIntervalDraft(event.target.value);
              }}
              onBlur={() =>
                commit(
                  intervalDraft,
                  setIntervalDraft,
                  workspace.projectUpdateReminderIntervalDays,
                  INTERVAL_MIN,
                  INTERVAL_MAX,
                  (value) => ({ projectUpdateReminderIntervalDays: value }),
                )
              }
              // Enter commits the field it is in, the way it would in a form — not a
              // shortcut, and nothing the command menu should ever list.
              // keymap-lint-allow: supplies the activation a native form control would
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />

            <Select
              label="Reminder weekday"
              hint="The day of the week the cycle lands on."
              value={String(workspace.projectUpdateReminderWeekday)}
              onChange={(event) => {
                const value = Number.parseInt(event.target.value, 10);
                void save.run(() => persist(engine, { projectUpdateReminderWeekday: value }));
              }}
            >
              {WEEKDAYS.map((day) => (
                <option key={day.value} value={day.value}>
                  {day.label}
                </option>
              ))}
            </Select>

            <Input
              type="number"
              inputMode="numeric"
              label="Reminder hour"
              hint={`Hour of that day, ${HOUR_MIN}–${HOUR_MAX}.`}
              min={HOUR_MIN}
              max={HOUR_MAX}
              value={hour ?? String(workspace.projectUpdateReminderHour)}
              onChange={(event) => {
                save.clear();
                setHour(event.target.value);
              }}
              onBlur={() =>
                commit(
                  hour,
                  setHour,
                  workspace.projectUpdateReminderHour,
                  HOUR_MIN,
                  HOUR_MAX,
                  (value) => ({ projectUpdateReminderHour: value }),
                )
              }
              // Enter commits the field it is in, the way it would in a form — not a
              // shortcut, and nothing the command menu should ever list.
              // keymap-lint-allow: supplies the activation a native form control would
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />

            <SaveIndicator state={save.state} className={own.saved} />
          </div>
        </section>
      </div>
    </div>
  );
}
