/**
 * Settings → Profile: the signed-in person's name, how they appear, and the timezone
 * Pulse digest and "today" should use for them.
 *
 * Writes land on blur. There is no Save button — turning a display name and picking a
 * timezone are independent decisions, and a form that batches them would let somebody leave
 * believing they had saved a name they had not.
 */

import { useState } from 'react';

import { useEngine } from '~/app/context';
import { Input, Select } from '~/components';
import { report } from '~/features/issue/mutations';
import { listTimezones } from '~/features/locale';
import { updateProfile } from '~/features/profile/mutations';
import { useViewer } from '~/hooks/useViewer';
import { ApiError } from '~/sync/api';

import styles from '~/features/labels/LabelSettings.module.css';

export function ProfileSettings() {
  const engine = useEngine();
  const viewer = useViewer();
  const [error, setError] = useState<string | null>(null);

  const save = (fields: Parameters<typeof updateProfile>[2]) => {
    if (viewer === null) return;
    setError(null);
    updateProfile(engine, viewer.id, fields).catch((failure: unknown) => {
      setError(failure instanceof ApiError ? failure.message : 'That change could not be saved.');
      report(failure);
    });
  };

  if (viewer === null) {
    return null;
  }

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
      </div>
    </div>
  );
}

function timezoneOptions(current: string): readonly string[] {
  const all = listTimezones();
  if (all.includes(current)) return all;
  return [current, ...all];
}
