import { useState } from 'react';

import { useEngine } from '~/app/context';
import { Checkbox, Select } from '~/components';
import { report } from '~/features/issue/mutations';
import { updateWorkspacePulse } from '~/features/workspace/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Store, Workspace } from '~/store';
import { ApiError } from '~/sync/api';

import styles from '~/features/labels/LabelSettings.module.css';

const CADENCES: readonly {
  readonly value: Workspace['pulseDigestCadence'];
  readonly label: string;
}[] = [
  { value: 'off', label: 'Never' },
  { value: 'daily', label: 'Daily, around 6:00' },
  { value: 'weekly', label: 'Weekly, Monday around 6:00' },
];

export function PulseSettings() {
  const engine = useEngine();
  const [error, setError] = useState<string | null>(null);

  const workspace = useLiveQuery(
    (store: Store) => store.workspaces.get(store.workspaceId) ?? null,
    ['workspace'],
    [],
  );

  const save = (fields: Parameters<typeof updateWorkspacePulse>[1]) => {
    setError(null);
    updateWorkspacePulse(engine, fields).catch((failure: unknown) => {
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
        <h1 className={styles.title}>Pulse</h1>
      </header>

      <div className={styles.body}>
        {error === null ? null : (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <section className={styles.section}>
          <p className={styles.sectionHint}>
            A feed of project status updates, plus a morning inbox summary for the projects you
            lead, created, or belong to. Guests never see Pulse.
          </p>

          <Checkbox
            label="Enable Pulse"
            checked={workspace.pulseEnabled}
            onChange={(event) => save({ pulseEnabled: event.target.checked })}
          />

          <label>
            <span className={styles.sectionHint}>Inbox digest</span>
            <Select
              value={workspace.pulseDigestCadence}
              disabled={!workspace.pulseEnabled}
              onChange={(event) =>
                save({
                  pulseDigestCadence: event.target.value as Workspace['pulseDigestCadence'],
                })
              }
            >
              {CADENCES.map((row) => (
                <option key={row.value} value={row.value}>
                  {row.label}
                </option>
              ))}
            </Select>
          </label>
        </section>
      </div>
    </div>
  );
}
