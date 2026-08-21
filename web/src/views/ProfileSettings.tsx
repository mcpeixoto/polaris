/**
 * Settings → Profile: the signed-in person's name, how they appear, and the timezone
 * Pulse digest and "today" should use for them.
 *
 * Writes land on blur. There is no Save button — turning a display name and picking a
 * timezone are independent decisions, and a form that batches them would let somebody leave
 * believing they had saved a name they had not.
 *
 * Leaving the workspace is here rather than under Members: it is a decision about the
 * signed-in person, and an admin Remove is a different path that needs a different
 * confirmation.
 */

import { useState } from 'react';

import { useEngine } from '~/app/context';
import { Button, Input, Select } from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import { leaveWorkspace } from '~/features/authorisedOauth/mutations';
import { report } from '~/features/issue/mutations';
import { listTimezones } from '~/features/locale';
import { updateProfile } from '~/features/profile/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewer } from '~/hooks/useViewer';
import type { Store } from '~/store';
import { ApiError } from '~/sync/api';

import styles from '~/features/labels/LabelSettings.module.css';

export function ProfileSettings() {
  const engine = useEngine();
  const viewer = useViewer();
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const workspace = useLiveQuery(
    (store: Store) => store.workspaces.get(store.workspaceId) ?? null,
    ['workspace'],
  );

  const save = (fields: Parameters<typeof updateProfile>[2]) => {
    if (viewer === null) return;
    setError(null);
    updateProfile(engine, viewer.id, fields).catch((failure: unknown) => {
      setError(failure instanceof ApiError ? failure.message : 'That change could not be saved.');
      report(failure);
    });
  };

  const confirmLeave = async () => {
    if (busy) return;
    setBusy(true);
    setLeaveError(null);
    try {
      await leaveWorkspace();
      try {
        localStorage.removeItem('polaris.workspace');
      } catch {
        /* private mode */
      }
      window.location.assign('/');
    } catch (failure) {
      setLeaveError(
        failure instanceof ApiError ? failure.message : 'You could not leave this workspace.',
      );
      setBusy(false);
    }
  };

  if (viewer === null) {
    return null;
  }

  const workspaceName = workspace?.name ?? 'this workspace';

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Profile</h1>
      </header>

      <div className={styles.body}>
        {error === null ? null : (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <section className={styles.section}>
          <p className={styles.sectionHint}>
            How you appear on issues and comments. Only you can change this — an admin renaming a
            colleague is not a thing this product does.
          </p>

          <Input
            label="Username"
            hint="Short handle used when full names are off."
            defaultValue={viewer.name}
            onBlur={(event) => save({ name: event.target.value })}
          />
          <Input
            label="Display name"
            hint="Shown when Preferences → Show full names is on."
            defaultValue={viewer.displayName}
            onBlur={(event) => save({ displayName: event.target.value })}
          />
          <Input
            label="Avatar URL"
            hint="A public image. Blank keeps initials."
            defaultValue={viewer.avatarUrl ?? ''}
            onBlur={(event) => save({ avatarUrl: event.target.value })}
          />
          <Select
            label="Timezone"
            hint="Pulse digest and calendar days that belong to you, not to a team."
            value={viewer.timezone}
            onChange={(event) => save({ timezone: event.target.value })}
          >
            {timezoneOptions(viewer.timezone).map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </Select>
          {viewer.email === undefined ? null : (
            <p className={styles.sectionHint}>
              Email {viewer.email} is the account, not this workspace.
            </p>
          )}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Leave workspace</h2>
          <p className={styles.sectionHint}>
            You stop being a member of {workspaceName}. Your issues and comments stay attributed.
            The last owner cannot leave — somebody has to remain who can invite and manage billing.
          </p>
          <Button
            variant="danger"
            onClick={() => {
              setLeaveError(null);
              setLeaving(true);
            }}
          >
            Leave {workspaceName}
          </Button>
        </section>
      </div>

      <ConfirmDialog
        open={leaving}
        title={`Leave ${workspaceName}?`}
        consequence={`You will lose access to ${workspaceName}. Work you created stays attributed to you. If this is your only workspace, you will land on the create-workspace screen.`}
        confirmLabel="Leave workspace"
        destructive
        busy={busy}
        error={leaveError ?? undefined}
        onConfirm={() => void confirmLeave()}
        onClose={() => setLeaving(false)}
      />
    </div>
  );
}

function timezoneOptions(current: string): readonly string[] {
  const all = listTimezones();
  if (all.includes(current)) return all;
  return [current, ...all];
}
