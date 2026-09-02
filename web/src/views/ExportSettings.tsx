/**
 * Workspace CSV export.
 *
 * View and project exports live on those screens (command menu). This page is the
 * admin-facing "export the workspace" surface: every issue the replica holds, as CSV,
 * downloaded now. Guests cannot export; members are capped at 250; admins at 2,000.
 *
 * The cap is stated before the button rather than after the download. It used to appear only
 * in the `role="status"` note that followed the file, which meant the one moment a person
 * could have narrowed their filter and got the rows they wanted had already passed — they
 * were told what they had lost while holding a file they were about to act on.
 *
 * The generation is a synchronous walk of the replica on the main thread, so on a large
 * workspace it is a freeze. That is not fixed here — the honest fix is a server-side job that
 * mails a link, and it does not exist — and neither is it papered over with a spinner. A
 * `loading` button would have to be painted before the walk begins, and the walk begins in the
 * same task as the click; deferring it a frame to make the spinner appear would be adding
 * latency in order to draw a picture of latency. So the page says plainly, before the click,
 * that this is built here and will lock the tab for a moment. That is the thing a spinner was
 * going to communicate, said in advance, where it is still actionable.
 */

import { useState } from 'react';

import { useEngine } from '~/app/context';
import { Button, EmptyState, SettingsPage, SettingsSection, Spinner } from '~/components';
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
    // Null when nothing was dropped, and null is the right answer: an export that lost
    // nothing has nothing to admit, and a confirmation the reader did not need is one more
    // thing to read past next time the note actually matters.
    setMessage(exportCapNote(ids.length, cap, 'issues'));
  };

  return (
    <SettingsPage title="Export">
      <SettingsSection
        title="Workspace issues"
        description="A CSV of every issue this client can see. Views and project lists also export from the command menu — those files follow the filter you are looking at."
        flush
      >
        {/*
          The unresolved-role frame is a Spinner inside the page, not an EmptyState standing
          in for one. An empty state is a claim that there is nothing here; this is a page
          that does not know yet, and it used to drop the <h1> while saying so.
        */}
        {cap === null ? (
          <div className={styles.loading}>
            <Spinner label="Loading your export permissions" />
          </div>
        ) : cap === 0 ? (
          <EmptyState
            title="Guests cannot export"
            description="Ask an admin if you need a copy of this workspace’s issues."
          />
        ) : (
          <>
            <p className={styles.note}>
              This file holds at most {cap.toLocaleString('en-US')} issues. If the workspace has
              more than that, narrow it with a view filter and export from the command menu instead
              — the whole workspace in one file is not something this client can promise.
            </p>
            <p className={styles.note}>
              It is built here in the browser, so a large workspace makes this tab unresponsive for
              a few seconds.
            </p>
            <Button variant="primary" onClick={exportWorkspace}>
              Download issues CSV
            </Button>
          </>
        )}

        {message !== null ? (
          <p className={styles.note} role="status">
            {message}
          </p>
        ) : null}
      </SettingsSection>
    </SettingsPage>
  );
}
