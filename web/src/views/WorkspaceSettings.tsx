/**
 * Settings → Workspace: the name on the sidebar, the URL key, and the logo.
 *
 * Admins only for writes — the mutation refuses members — but everybody can read the name
 * they already see in the shell. Changing the URL key keeps the previous slug as an alias
 * so bookmarks still resolve and nobody else can take it.
 */

import { useState } from 'react';

import { useEngine } from '~/app/context';
import { Input } from '~/components';
import { report } from '~/features/issue/mutations';
import { updateWorkspaceGeneral } from '~/features/workspace/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Store } from '~/store';
import { ApiError } from '~/sync/api';

import styles from '~/features/labels/LabelSettings.module.css';

export function WorkspaceSettings() {
  const engine = useEngine();
  const [error, setError] = useState<string | null>(null);

  const workspace = useLiveQuery(
    (store: Store) => store.workspaces.get(store.workspaceId) ?? null,
    ['workspace'],
  );

  const save = (fields: Parameters<typeof updateWorkspaceGeneral>[1]) => {
    setError(null);
    updateWorkspaceGeneral(engine, fields).catch((failure: unknown) => {
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
        <h1 className={styles.title}>Workspace</h1>
      </header>

      <div className={styles.body}>
        {error === null ? null : (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <section className={styles.section}>
          <p className={styles.sectionHint}>
            The name on the sidebar and the address people type. Only admins can change them.
          </p>

          <Input
            label="Name"
            defaultValue={workspace.name}
            onBlur={(event) => save({ name: event.target.value })}
          />
          <Input
            label="URL key"
            hint="The previous address keeps working, so bookmarks and invites do not break."
            defaultValue={workspace.urlKey}
            autoComplete="off"
            spellCheck={false}
            maxLength={48}
            onBlur={(event) => {
              const next = event.target.value.trim().toLowerCase();
              if (next === '' || next === workspace.urlKey) return;
              save({ urlKey: next });
            }}
          />
          <Input
            label="Logo URL"
            hint="A public image. Blank keeps the letter mark."
            defaultValue={workspace.logoUrl ?? ''}
            onBlur={(event) => save({ logoUrl: event.target.value })}
          />
        </section>
      </div>
    </div>
  );
}
