/**
 * Settings → Workspace: the name on the sidebar, the URL key, and the logo.
 *
 * Admins only for writes — the mutation refuses members — but everybody can read the name
 * they already see in the shell. Changing the URL key keeps the previous slug as an alias
 * so bookmarks still resolve and nobody else can take it.
 *
 * Every field here is controlled, and that is the whole difference from what this screen
 * used to be. The fields were uncontrolled and saved on blur, and `updateWorkspaceGeneral`
 * quietly dropped an empty required value from its patch and resolved — so clearing the
 * name and tabbing out left the box empty, the sidebar showing the old name, no error and
 * nothing to put it back. A controlled field can revert; an uncontrolled one cannot.
 */

import { useEffect, useState } from 'react';

import { useEngine } from '~/app/context';
import { Input, SaveIndicator, SettingsPage, SettingsSection, useSaveState } from '~/components';
import { updateWorkspaceGeneral } from '~/features/workspace/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Store } from '~/store';
import { ApiError } from '~/sync/api';

import styles from './WorkspaceSettings.module.css';

/** The characters an address may hold. The server enforces the same rule. */
const URL_KEY = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u;

export function WorkspaceSettings() {
  const engine = useEngine();
  const save = useSaveState(describe);

  const workspace = useLiveQuery(
    (store: Store) => store.workspaces.get(store.workspaceId) ?? null,
    ['workspace'],
  );

  const [name, setName] = useState('');
  const [urlKey, setUrlKey] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);

  // Seeded from the store, and re-seeded whenever the store's value moves — which covers
  // the first paint, another admin's rename arriving on the stream, and the engine walking
  // back an optimistic patch the server refused.
  useEffect(() => {
    if (workspace === null) return;
    setName(workspace.name);
    setUrlKey(workspace.urlKey);
    setLogoUrl(workspace.logoUrl ?? '');
  }, [workspace?.name, workspace?.urlKey, workspace?.logoUrl, workspace]);

  if (workspace === null) return null;

  const commitName = () => {
    const next = name.trim();
    if (next === '') {
      setNameError('A workspace needs a name.');
      setName(workspace.name);
      return;
    }
    setNameError(null);
    if (next === workspace.name) return;
    void save.run(() => updateWorkspaceGeneral(engine, { name: next }));
  };

  const commitKey = () => {
    const next = urlKey.trim().toLowerCase();
    if (next === '') {
      setKeyError('A workspace needs an address.');
      setUrlKey(workspace.urlKey);
      return;
    }
    if (!URL_KEY.test(next)) {
      setKeyError('Lower-case letters, digits and hyphens, starting and ending with one.');
      return;
    }
    setKeyError(null);
    if (next === workspace.urlKey) return;
    void save.run(() => updateWorkspaceGeneral(engine, { urlKey: next }));
  };

  return (
    <SettingsPage
      title="Workspace"
      description="The name on the sidebar and the address people type. Only admins can change them."
    >
      <SettingsSection
        title="General"
        status={<SaveIndicator state={save.state} />}
        error={save.error}
        flush
      >
        <Input
          label="Name"
          value={name}
          error={nameError ?? undefined}
          onChange={(event) => {
            setName(event.target.value);
            if (nameError !== null) setNameError(null);
          }}
          onBlur={commitName}
        />

        <Input
          label="URL key"
          // A live preview rather than a rule, because the rule is only interesting when it
          // is broken and the address is what the change actually costs: every bookmark and
          // every invitation link in the workspace points at it.
          hint={
            urlKey.trim() === ''
              ? 'The previous address keeps working, so bookmarks and invites do not break.'
              : `This workspace will live at polaris.app/${urlKey.trim().toLowerCase()}. The previous address keeps working, so bookmarks and invites do not break.`
          }
          value={urlKey}
          error={keyError ?? undefined}
          autoComplete="off"
          spellCheck={false}
          maxLength={48}
          className={styles.urlKey}
          onChange={(event) => {
            setUrlKey(event.target.value);
            if (keyError !== null) setKeyError(null);
          }}
          onBlur={commitKey}
        />

        <Input
          label="Logo URL"
          hint="A public image. Blank keeps the letter mark."
          value={logoUrl}
          onChange={(event) => setLogoUrl(event.target.value)}
          onBlur={() => {
            const next = logoUrl.trim();
            if (next === (workspace.logoUrl ?? '')) return;
            void save.run(() => updateWorkspaceGeneral(engine, { logoUrl: next }));
          }}
        />
      </SettingsSection>
    </SettingsPage>
  );
}

/** The server's own sentence where it wrote one; the mutation's where it refused locally. */
function describe(failure: unknown): string {
  if (failure instanceof ApiError) return failure.message;
  if (failure instanceof Error && failure.message !== '') return failure.message;
  return 'That change could not be saved.';
}
