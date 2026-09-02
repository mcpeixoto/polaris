/**
 * Unsent work: the composer you walked away from, comments you have not posted, and
 * drafts saved across devices.
 *
 * Two piles on one screen rather than two screens, because the question is "what did I
 * start and not finish", not which storage it lives in. Local rows say they are on this
 * device; saved rows survive logout. Opening one files it back into the composer it came
 * from.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { useActions, useKeyContext } from '~/app/keymap';
import { Button, EmptyState } from '~/components';
import {
  commentPayloadOf,
  deleteDraft,
  draftTitle,
  fetchDrafts,
  issuePayloadOf,
  type SavedDraft,
} from '~/features/drafts/mutations';
import {
  clearCommentDraft,
  listLocalDrafts,
  writeCommentDraft,
  writeIssueComposerDraft,
  type LocalDraft,
} from '~/features/drafts/local';
import { useCreateIssue } from '~/features/issue/create-context';
import { exact, when } from '~/features/time';
import { ApiError } from '~/sync/api';
import styles from './Drafts.module.css';

type Load =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly saved: readonly SavedDraft[] }
  | { readonly phase: 'failed'; readonly message: string };

export function Drafts() {
  const navigate = useNavigate();
  const create = useCreateIssue();
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [local, setLocal] = useState<readonly LocalDraft[]>(() => listLocalDrafts());
  const [discardError, setDiscardError] = useState<string | null>(null);
  const [retryDiscard, setRetryDiscard] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    fetchDrafts(controller.signal)
      .then((saved) => {
        if (live) setLoad({ phase: 'ready', saved });
      })
      .catch((failure: unknown) => {
        if (!live) return;
        setLoad({
          phase: 'failed',
          message:
            failure instanceof ApiError && failure.isOffline
              ? 'Saved drafts could not be fetched — this device looks offline.'
              : 'Saved drafts could not be fetched.',
        });
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [attempt]);

  const refreshLocal = () => setLocal(listLocalDrafts());

  /**
   * Opens the composer and re-reads both piles when it shuts.
   *
   * Filing a resumed draft deletes it — `deleteDraft` on the create, and the local slot is
   * cleared with it — and this page had no way to find out: it read sessionStorage once at
   * mount and re-fetched the saved list only when something on it was discarded. So the row
   * that had just been filed stayed on screen, offering to resume an issue that now exists.
   */
  const openIssue = (seed: Parameters<typeof create.open>[0]) => {
    create.open(seed, {
      onClosed: () => {
        refreshLocal();
        setAttempt((n) => n + 1);
      },
    });
  };

  const resumeLocal = (draft: LocalDraft) => {
    if (draft.kind === 'issue') {
      openIssue({
        title: draft.title,
        description: draft.description,
        teamId: draft.teamId,
        stateId: draft.stateId,
        assigneeId: draft.assigneeId,
        priority: draft.priority,
        projectId: draft.projectId,
        cycleId: draft.cycleId,
        estimate: draft.estimate,
      });
      return;
    }
    // A comment draft resumes on the issue it belongs to; the composer there will pick
    // the local body back up.
    void navigate(`/issue/${draft.identifier ?? draft.issueId}`);
  };

  const resumeSaved = (draft: SavedDraft) => {
    if (draft.kind === 'issue') {
      const payload = issuePayloadOf(draft);
      openIssue({ ...payload, draftId: draft.id });
      return;
    }
    const payload = commentPayloadOf(draft);
    if (payload === null) return;
    writeCommentDraft(payload);
    void navigate(`/issue/${payload.identifier ?? payload.issueId}`);
  };

  const discardSaved = async (id: string) => {
    setDiscardError(null);
    setRetryDiscard(null);
    try {
      await deleteDraft(id);
      setAttempt((n) => n + 1);
    } catch (failure) {
      // The row is still there and still discardable, so this says so rather than leaving an
      // unhandled rejection in the console and a button that appeared to do nothing.
      setRetryDiscard(id);
      setDiscardError(
        failure instanceof ApiError && failure.isOffline
          ? 'That draft could not be discarded — this device looks offline.'
          : 'That draft could not be discarded.',
      );
    }
  };

  const discardLocal = (draft: LocalDraft) => {
    if (draft.kind === 'issue') writeIssueComposerDraft(null);
    else clearCommentDraft(draft.issueId, draft.parentId);
    refreshLocal();
  };

  useKeyContext('list');
  useActions(
    [
      {
        id: 'draft.create',
        title: 'Create issue from a blank composer',
        keys: ['n'],
        when: 'list',
        group: 'Issues',
        run: () => {
          create.open();
        },
      },
    ],
    [create],
  );

  const saved = load.phase === 'ready' ? load.saved : [];
  const empty = local.length === 0 && saved.length === 0 && load.phase !== 'loading';

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Drafts</h1>
      </header>

      {load.phase === 'loading' && local.length === 0 ? (
        <EmptyState
          title="Loading drafts"
          description="Saved drafts come from the server; local ones are already here."
        />
      ) : empty ? (
        <EmptyState
          title="Nothing unsent"
          description="Press C to start an issue. Walking away keeps it on this device; Esc offers to save it across devices."
          action={
            <Button
              variant="primary"
              onClick={() => {
                create.open();
              }}
            >
              New issue
            </Button>
          }
        />
      ) : (
        <div className={styles.body}>
          {local.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>On this device</h2>
              <p className={styles.sectionNote}>
                Cleared by logout or a restart. Save one to keep it.
              </p>
              <ul className={styles.list}>
                {local.map((draft) => (
                  <li key={localKey(draft)} className={styles.savedRow}>
                    <button type="button" className={styles.row} onClick={() => resumeLocal(draft)}>
                      <span className={styles.kind}>
                        {draft.kind === 'issue' ? 'Issue' : 'Comment'}
                      </span>
                      <span className={styles.name}>
                        {draft.kind === 'issue'
                          ? draft.title.trim() || 'Untitled issue'
                          : draft.body.split('\n')[0] || 'Comment'}
                      </span>
                      <span className={styles.when} title={exact(draft.updatedAt)}>
                        {when(draft.updatedAt)}
                      </span>
                    </button>
                    {/* Every row can be discarded. A comment draft used to have no control
                        at all, so the one pile on this screen that is definitely unsent was
                        also the one nothing could clear. */}
                    <Button size="sm" variant="ghost" onClick={() => discardLocal(draft)}>
                      Discard
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {load.phase === 'failed' ? (
            <p className={styles.error} role="alert">
              {load.message}{' '}
              <Button size="sm" variant="ghost" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </Button>
            </p>
          ) : null}

          {discardError === null ? null : (
            <p className={styles.error} role="alert">
              {discardError}{' '}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (retryDiscard !== null) void discardSaved(retryDiscard);
                }}
              >
                Try again
              </Button>
            </p>
          )}

          {saved.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Saved</h2>
              <p className={styles.sectionNote}>
                Kept for six months, on every device you sign in on.
              </p>
              <ul className={styles.list}>
                {saved.map((draft) => (
                  <li key={draft.id} className={styles.savedRow}>
                    <button type="button" className={styles.row} onClick={() => resumeSaved(draft)}>
                      <span className={styles.kind}>
                        {draft.kind === 'issue' ? 'Issue' : 'Comment'}
                      </span>
                      <span className={styles.name}>{draftTitle(draft)}</span>
                      <span className={styles.when} title={exact(draft.updatedAt)}>
                        {when(draft.updatedAt)}
                      </span>
                    </button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        void discardSaved(draft.id);
                      }}
                    >
                      Discard
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function localKey(draft: LocalDraft): string {
  if (draft.kind === 'issue') return 'issue';
  return `comment:${draft.issueId}:${draft.parentId ?? ''}`;
}
