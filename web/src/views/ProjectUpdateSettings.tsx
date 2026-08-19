import { useState } from 'react';

import { useEngine } from '~/app/context';
import { Input, Select } from '~/components';
import { report } from '~/features/issue/mutations';
import { updateWorkspaceReminderCadence } from '~/features/workspace/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Store } from '~/store';
import { ApiError } from '~/sync/api';

import styles from '~/features/labels/LabelSettings.module.css';

const WEEKDAYS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
] as const;

export function ProjectUpdateSettings() {
  const engine = useEngine();
  const [error, setError] = useState<string | null>(null);

  const workspace = useLiveQuery(
    (store: Store) => store.workspaces.get(store.workspaceId) ?? null,
    ['workspace'],
  );

  const save = (fields: Parameters<typeof updateWorkspaceReminderCadence>[1]) => {
    setError(null);
    updateWorkspaceReminderCadence(engine, fields).catch((failure: unknown) => {
      setError(failure instanceof ApiError ? failure.message : 'That change could not be saved.');
      report(failure);
    });
  };

  if (workspace === null) {
    return null;
  }

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Project updates</h1>
      </header>

      <div className={styles.body}>
        {error === null ? null : (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <section className={styles.section}>
          <p className={styles.sectionHint}>
            Default reminder cadence for in-progress projects. Delivery is not wired yet — these
            settings drive staleness on the projects list and project shell.
          </p>

          <label>
            <span className={styles.sectionHint}>Reminder every (days)</span>
            <Input
              type="number"
              min={1}
              max={365}
              value={String(workspace.projectUpdateReminderIntervalDays)}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                if (!Number.isNaN(parsed)) {
                  save({ projectUpdateReminderIntervalDays: parsed });
                }
              }}
            />
          </label>

          <label>
            <span className={styles.sectionHint}>Reminder weekday</span>
            <Select
              value={String(workspace.projectUpdateReminderWeekday)}
              onChange={(event) =>
                save({ projectUpdateReminderWeekday: Number.parseInt(event.target.value, 10) })
              }
            >
              {WEEKDAYS.map((day) => (
                <option key={day.value} value={day.value}>
                  {day.label}
                </option>
              ))}
            </Select>
          </label>

          <label>
            <span className={styles.sectionHint}>Reminder hour (0–23)</span>
            <Input
              type="number"
              min={0}
              max={23}
              value={String(workspace.projectUpdateReminderHour)}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                if (!Number.isNaN(parsed)) {
                  save({ projectUpdateReminderHour: parsed });
                }
              }}
            />
          </label>
        </section>
      </div>
    </div>
  );
}
