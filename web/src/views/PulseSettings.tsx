/**
 * Settings → Pulse: whether the workspace has a Pulse feed, and how often the inbox digest
 * goes out.
 *
 * Both writes land on change, and a refusal goes to the page's error slot: with two controls
 * on the screen there is no section the reader could confuse it with.
 */

import { useState } from 'react';

import { useEngine } from '~/app/context';
import { Checkbox, Select, SettingsPage, SettingsSection } from '~/components';
import { SettingsRow } from '~/components/SettingsSection';
import { report } from '~/features/issue/mutations';
import { updateWorkspacePulse } from '~/features/workspace/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Store, Workspace } from '~/store';
import { ApiError } from '~/sync/api';

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
    <SettingsPage title="Pulse" error={error ?? undefined}>
      <SettingsSection description="A feed of project status updates, plus a morning inbox summary for the projects you lead, created, or belong to. Guests never see Pulse.">
        <SettingsRow label="Enable Pulse">
          <Checkbox
            aria-label="Enable Pulse"
            checked={workspace.pulseEnabled}
            onChange={(event) => save({ pulseEnabled: event.target.checked })}
          />
        </SettingsRow>
        <SettingsRow label="Inbox digest" wide>
          <Select
            label="Inbox digest"
            hideLabel
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
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>
  );
}
