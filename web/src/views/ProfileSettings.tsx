/**
 * Settings → Profile: the signed-in person's name, how they appear, and the timezone
 * Pulse digest and "today" should use for them.
 *
 * Writes land on blur. There is no Save button — turning a display name and picking a
 * timezone are independent decisions, and a form that batches them would let somebody leave
 * believing they had saved a name they had not.
 *
 * That bargain only holds if the screen says the write happened, and for a long time it did
 * not: a successful save was silent, which is the same thing on screen as doing nothing, and
 * a form nobody can tell they have submitted gets submitted again. `SaveIndicator` is the
 * missing half of dropping the button.
 *
 * ## An emptied name is refused, not swallowed
 *
 * `updateProfile` drops an empty `name` or `displayName` and then no-ops, because a workspace
 * member with no name is not a thing the rest of the product can render. The screen used to
 * agree silently: the field stayed visibly blank, the store kept the old value, and nothing
 * was said in either direction — so the person walked away from a name they had "changed".
 * The blur now refuses it on the field and puts the previous value back, which is the only
 * honest pair: the input shows what the product holds, and the message says why.
 *
 * Leaving the workspace is here rather than under Members: it is a decision about the
 * signed-in person, and an admin Remove is a different path that needs a different
 * confirmation.
 */

import { useState, type FocusEvent } from 'react';

import { useEngine } from '~/app/context';
import {
  Button,
  DangerZone,
  DangerZoneRow,
  Input,
  SaveIndicator,
  Select,
  SettingsPage,
  SettingsSection,
  useSaveState,
} from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import { leaveWorkspace } from '~/features/authorisedOauth/mutations';
import { report } from '~/features/issue/mutations';
import { listTimezones } from '~/features/locale';
import { updateProfile } from '~/features/profile/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewer } from '~/hooks/useViewer';
import type { Store } from '~/store';
import { ApiError } from '~/sync/api';

import styles from './ProfileSettings.module.css';

/** The two fields the server will not accept as empty, and the screen must not pretend to. */
type NameField = 'name' | 'displayName';

export function ProfileSettings() {
  const engine = useEngine();
  const viewer = useViewer();
  const saved = useSaveState(describe);
  /** A refusal this screen made itself, on the field it is about. One at a time. */
  const [problem, setProblem] = useState<{ field: NameField; message: string } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const workspace = useLiveQuery(
    (store: Store) => store.workspaces.get(store.workspaceId) ?? null,
    ['workspace'],
  );

  const save = (fields: Parameters<typeof updateProfile>[2]) => {
    if (viewer === null) return;
    void saved.run(() =>
      updateProfile(engine, viewer.id, fields).catch((failure: unknown) => {
        report(failure);
        throw failure;
      }),
    );
  };

  /**
   * A name field's blur: refuse an empty value, otherwise save it.
   *
   * Writing back to `event.target.value` is the uncontrolled equivalent of reverting state,
   * and it is what these fields have always been — `defaultValue`, so that typing is never
   * fighting a render. The restore happens in the same event as the message, so the field
   * never sits blank next to a sentence explaining that blank is not allowed.
   */
  const saveName = (field: NameField, event: FocusEvent<HTMLInputElement>) => {
    if (viewer === null) return;
    const previous = field === 'name' ? viewer.name : viewer.displayName;
    const value = event.target.value;
    if (value.trim() === '') {
      setProblem({
        field,
        message:
          field === 'name'
            ? 'A username cannot be empty — it is what names your issues and comments.'
            : 'A display name cannot be empty. Turn full names off in Preferences instead.',
      });
      event.target.value = previous;
      return;
    }
    setProblem(null);
    save(field === 'name' ? { name: value } : { displayName: value });
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
  const messageFor = (field: NameField) => (problem?.field === field ? problem.message : undefined);
  const clear = (field: NameField) => {
    if (problem?.field === field) setProblem(null);
  };

  return (
    <SettingsPage title="Profile" description="You, as the rest of the workspace sees you.">
      <SettingsSection
        title="Identity"
        description="How you appear on issues and comments. Only you can change this — an admin renaming a colleague is not a thing this product does."
        // Success and failure in one place, beside the heading of the section that owns the
        // write. A page-top banner for the failure and nothing at all for the success is how
        // this screen used to report both.
        status={<SaveIndicator state={saved.state} />}
        error={saved.error}
      >
        <Input
          label="Username"
          hint="Short handle used when full names are off."
          defaultValue={viewer.name}
          error={messageFor('name')}
          onChange={() => clear('name')}
          onBlur={(event) => saveName('name', event)}
        />
        <Input
          label="Display name"
          hint="Shown when Preferences → Show full names is on."
          defaultValue={viewer.displayName}
          error={messageFor('displayName')}
          onChange={() => clear('displayName')}
          onBlur={(event) => saveName('displayName', event)}
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
          <p className={styles.accountNote}>
            Email {viewer.email} is the account, not this workspace.
          </p>
        )}
      </SettingsSection>

      <DangerZone error={leaveError ?? undefined}>
        <DangerZoneRow
          title={`Leave ${workspaceName}`}
          consequence={`You stop being a member of ${workspaceName}. Your issues and comments stay attributed. The last owner cannot leave — somebody has to remain who can invite and manage billing.`}
          action={
            <Button
              variant="danger"
              onClick={() => {
                setLeaveError(null);
                setLeaving(true);
              }}
            >
              Leave {workspaceName}
            </Button>
          }
        />
      </DangerZone>

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
    </SettingsPage>
  );
}

/** The server's sentence where there is one; this screen's where there is not. */
function describe(failure: unknown): string {
  return failure instanceof ApiError ? failure.message : 'That change could not be saved.';
}

function timezoneOptions(current: string): readonly string[] {
  const all = listTimezones();
  if (all.includes(current)) return all;
  return [current, ...all];
}
