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
import { downloadCsv, exportCap, issuesToCsv, type ExportRole } from '~/features/export/csv';
import { useViewer } from '~/hooks/useViewer';
import styles from './ExportSettings.module.css';

export function ExportSettings() {
  const engine = useEngine();
  const viewer = useViewer();
  const [message, setMessage] = useState<string | null>(null);

  const role: ExportRole = viewer?.role ?? 'member';
  const cap = exportCap(role, 'issues');

  const exportWorkspace = () => {
    setMessage(null);
    if (cap === 0) {
      setMessage('Guests cannot export.');
      return;
    }
    const ids: string[] = [];
    for (const issue of engine.store.issues.values()) {
      if (issue.archivedAt !== undefined) continue;
      ids.push(issue.id);
      if (ids.length >= cap) break;
    }
    downloadCsv('issues.csv', issuesToCsv(engine.store, ids));
    if (engine.store.issues.size > cap) {
      setMessage(
        `Exported the first ${cap} issues. Narrow a view and export from there for the rest.`,
      );
    }
  };

  if (viewer === null) {
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
