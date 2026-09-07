/**
 * Unsent work: the composer you walked away from, comments you have not posted, and
 * drafts saved across devices.
 *
 * Two piles on one screen rather than two screens, because the question is "what did I
 * start and not finish", not which storage it lives in. Local rows say they are on this
 * device; saved rows survive logout. Opening one files it back into the composer it came
 * from.
 *
 * The screen used to claim the list key context and register a single "new issue" action
 * into it, so `j`, `k` and Enter did nothing on a screen that had told the keyboard it was
 * a list. The claim is honoured now rather than dropped: both piles feed one cursor —
 * unsent work is one question, whichever store it sits in — and Enter resumes the row under
 * it. Two listboxes carry it because a listbox may hold options and groups and not the two
 * headings and the paragraph between the piles; the cursor is one, and only the box holding
 * it names an active descendant.
 *
 * Waiting is drawn with `EntityLoading`, not with an `EmptyState` titled "Loading drafts".
 * An empty state is an answer, and "there is nothing unsent" is precisely the answer this
 * screen does not have while the saved pile is still on the wire.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { useActions, useKeyContext } from '~/app/keymap';
import { Button, EmptyState, Field, useFieldIds } from '~/components';
import { EntityLoading } from '~/features/entity-gate/EntityGate';
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
import { useListCursor, listRowDomId } from '~/hooks/useListCursor';
import type { UUID } from '~/store';
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
  const fetchErrorIds = useFieldIds();
  const discardErrorIds = useFieldIds();

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

  const saved = load.phase === 'ready' ? load.saved : [];
  const empty = local.length === 0 && saved.length === 0 && load.phase !== 'loading';

  // One list, in the order it is drawn: local first, then saved. A local row's id is its
  // slot rather than a uuid, because that is what identifies it — there is one issue
  // composer draft per device and one comment draft per thread.
  const ids: readonly UUID[] = [
    ...local.map((draft) => localKey(draft)),
    ...saved.map((draft) => draft.id),
  ];

  const resume = (id: UUID) => {
    const localDraft = local.find((draft) => localKey(draft) === id);
    if (localDraft !== undefined) {
      resumeLocal(localDraft);
      return;
    }
    const savedDraft = saved.find((draft) => draft.id === id);
    if (savedDraft !== undefined) resumeSaved(savedDraft);
  };

  useKeyContext('list');
  const cursor = useListCursor({ ids, prefix: 'draftList', noun: 'draft', onOpen: resume });

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

  const activeIn = (rowIds: readonly string[]): string | undefined =>
    cursor.cursorId !== null && rowIds.includes(cursor.cursorId)
      ? listRowDomId('draftList', cursor.cursorId)
      : undefined;

  const rowClass = (id: string) =>
    [styles.savedRow, id === cursor.cursorId ? styles.cursorRow : null].filter(Boolean).join(' ');

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Drafts</h1>
      </header>

      {load.phase === 'loading' && local.length === 0 ? (
        <EntityLoading label="Loading drafts…" lines={3} />
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
              <ul
                className={styles.list}
                role="listbox"
                aria-label="Drafts on this device"
                tabIndex={0}
                aria-activedescendant={activeIn(local.map((draft) => localKey(draft)))}
              >
                {local.map((draft) => (
                  <li
                    key={localKey(draft)}
                    {...cursor.rowProps(localKey(draft))}
                    role="option"
                    className={rowClass(localKey(draft))}
                  >
                    <button
                      type="button"
                      className={styles.row}
                      onClick={() => {
                        cursor.setCursor(localKey(draft));
                        resumeLocal(draft);
                      }}
                    >
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

          {/* The message and the control that answers it, through the same `Field` every
              form control on the product renders through — rather than a `<p role="alert">`
              of this screen's own, which is how two spellings of an error message start. */}
          {load.phase === 'failed' ? (
            <Field ids={fetchErrorIds} error={load.message}>
              <Button
                id={fetchErrorIds.controlId}
                size="sm"
                variant="ghost"
                onClick={() => setAttempt((n) => n + 1)}
              >
                Try again
              </Button>
            </Field>
          ) : null}

          {discardError === null ? null : (
            <Field ids={discardErrorIds} error={discardError}>
              <Button
                id={discardErrorIds.controlId}
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (retryDiscard !== null) void discardSaved(retryDiscard);
                }}
              >
                Try again
              </Button>
            </Field>
          )}

          {saved.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Saved</h2>
              <p className={styles.sectionNote}>
                Kept for six months, on every device you sign in on.
              </p>
              <ul
                className={styles.list}
                role="listbox"
                aria-label="Saved drafts"
                tabIndex={0}
                aria-activedescendant={activeIn(saved.map((draft) => draft.id))}
              >
                {saved.map((draft) => (
                  <li
                    key={draft.id}
                    {...cursor.rowProps(draft.id)}
                    role="option"
                    className={rowClass(draft.id)}
                  >
                    <button
                      type="button"
                      className={styles.row}
                      onClick={() => {
                        cursor.setCursor(draft.id);
                        resumeSaved(draft);
                      }}
                    >
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
