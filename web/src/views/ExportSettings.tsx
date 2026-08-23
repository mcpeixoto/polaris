/**
 * Workspace CSV export.
 *
 * View and project exports live on those screens (command menu). This page is the
 * admin-facing "export the workspace" surface: every issue the replica holds, as CSV,
 * downloaded now. Guests cannot export; members are capped at 250; admins at 2,000.
 */

import { useState } from 'react';

import { useEngine } from '~/app/context';
import { Button, EmptyState } from '~/components';
import { downloadCsv, exportCap, exportCapNote, issuesToCsv } from '~/features/export/csv';
import { useViewerRole } from '~/hooks/useViewer';
import styles from './ExportSettings.module.css';

export function ExportSettings() {
  const engine = useEngine();
  const viewerRole = useViewerRole();
  const [message, setMessage] = useState<string | null>(null);

  // The role is asked of the session, not of the replica. It used to be
  // `useViewer()?.role ?? 'member'`, and a guest's replica holds no `user` rows at all —
  // the directory is workspace-scoped and guests are not handed it — so for the one person
  // this page has an answer for, the profile never arrived and the screen sat on "Loading
  // export" for the whole session. `null` here is genuinely "not answered yet".
  const cap = viewerRole === null ? null : exportCap(viewerRole, 'issues');

  const exportWorkspace = () => {
    setMessage(null);
    if (cap === null || cap === 0) {
      setMessage('Guests cannot export.');
      return;
    }
    // Every candidate, then the cap — rather than stopping the walk at the cap — because the
    // note has to compare what was written against what there was. Stopping early leaves
    // only `store.issues.size` to compare with, which counts archived rows this loop
    // deliberately skips, and so claims a truncation that did not happen.
    const ids: string[] = [];
    for (const issue of engine.store.issues.values()) {
      if (issue.archivedAt !== undefined) continue;
      ids.push(issue.id);
    }
    downloadCsv('issues.csv', issuesToCsv(engine.store, ids.slice(0, cap)));
    setMessage(exportCapNote(ids.length, cap, 'issues'));
  };

  if (cap === null) {
    return (
      <div className={styles.screen}>
        <EmptyState
          title="Loading export"
          description="This needs to know who you are, which arrives a moment after the workspace does."
        />
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Export</h1>
      </header>

      <div className={styles.body}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Workspace issues</h2>
          <p className={styles.sectionNote}>
            A CSV of every issue this client can see. Views and project lists also export from the
            command menu — those files follow the filter you are looking at.
          </p>
          {cap === 0 ? (
            <EmptyState
              title="Guests cannot export"
              description="Ask an admin if you need a copy of this workspace’s issues."
            />
          ) : (
            <Button variant="primary" onClick={exportWorkspace}>
              Download issues CSV
            </Button>
          )}
          {message !== null ? (
            <p className={styles.note} role="status">
              {message}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
