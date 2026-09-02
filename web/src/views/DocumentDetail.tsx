/**
 * One document: title and markdown body.
 *
 * The body is a textarea, deliberately — collaborative editing is a later slice and the
 * field currently holds plain markdown, same as issue descriptions.
 */

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { Button, EmptyState, Input, Textarea } from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import { archiveDocument, deleteDocument, updateDocument } from '~/features/documents/mutations';
import { EntityLoading, useEntityState } from '~/features/entity-gate/EntityGate';
import { Markdown } from '~/features/markdown/Markdown';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { ApiError } from '~/sync/api';
import styles from './DocumentDetail.module.css';

export function DocumentDetail() {
  const navigate = useNavigate();
  const engine = useEngine();
  const { documentId = '' } = useParams<{ documentId: string }>();
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const document = useLiveQuery(
    (store) => store.documents.get(documentId) ?? null,
    ['document'],
    [documentId],
  );

  // Seeded from the replica rather than from empty strings. The effect below fills the
  // fields a frame later, which is a frame in which the screen claims the document has no
  // title and no body — and a frame in which anything typed is thrown away by the very
  // first run of that effect, because a document nobody has loaded yet counts as switched.
  const [title, setTitle] = useState(document?.title ?? '');
  const [body, setBody] = useState(document?.body ?? '');
  const [titleDirty, setTitleDirty] = useState(false);
  const [bodyDirty, setBodyDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // Which of the two destructive actions is waiting on an answer, and whether its request
  // is in flight. Both used to be one ghost button away from happening by accident.
  const [confirming, setConfirming] = useState<'archive' | 'delete' | null>(null);
  const [removing, setRemoving] = useState(false);
  // The body is read as rendered markdown until somebody puts the caret in it. `editing`
  // is what swaps the two; the textarea itself never leaves the DOM, because it is the
  // field's accessible representation and the value every other effect on this screen
  // reads.
  const [editing, setEditing] = useState(false);
  const dirty = titleDirty || bodyDirty;

  // The fields as they stand *now*, readable from a callback that has been waiting on the
  // network. `save` closes over the values it sent, which are not necessarily the values on
  // the screen by the time the server answers.
  const showing = useRef({ title, body });
  useEffect(() => {
    showing.current = { title, body };
  }, [title, body]);

  /**
   * The edit as it stands, for the exits that do not blur a field.
   *
   * Saving on blur made this screen inconsistent in a way no mental model survives. Clicking
   * the "Documents" link at the top saved, because the click moves focus out of the textarea
   * first. Browser Back did not. Reloading did not. Pressing Escape, or simply stopping
   * typing and walking away, did not. So the rule was neither "an explicit Save is the only
   * thing that counts" nor "your work is kept" — it was "clicking away saves and everything
   * else throws it out", which cannot be learned and cannot be relied on.
   *
   * Resolved towards keeping the work, because that is what the rest of the product already
   * does: an issue title and an issue description are both saved when the screen goes away
   * without a blur, and a document is the surface where somebody is *most* likely to have
   * written something that exists nowhere else. Save stays, and still means "send it now";
   * it stops being the only thing that ever sends it.
   */
  const pending = useRef<{
    id: string;
    title: string;
    body: string;
    stored: string;
    dirty: boolean;
  } | null>(null);
  useEffect(() => {
    pending.current =
      document === null
        ? null
        : { id: document.id, title, body, stored: document.title, dirty: titleDirty || bodyDirty };
  }, [document, title, body, titleDirty, bodyDirty]);

  useEffect(() => {
    const flush = () => {
      const edit = pending.current;
      pending.current = null;
      if (edit === null || !edit.dirty) return;
      // A blank title cannot be saved, and on this path there is nobody to tell: refusing
      // outright would take the body down with it, which is the larger loss by far. The
      // title the document already had is the honest stand-in — it is exactly what the
      // on-screen refusal leaves in place.
      const next = edit.title.trim() === '' ? edit.stored : edit.title.trim();
      updateDocument(engine, { id: edit.id, title: next, body: edit.body }).catch(() => {
        // The screen is going. A refusal here has nowhere to be shown, and the write is in
        // the outbox if it was merely the network.
      });
    };
    const onHidden = () => {
      if (globalThis.document.visibilityState === 'hidden') flush();
    };
    globalThis.document.addEventListener('visibilitychange', onHidden);
    return () => {
      globalThis.document.removeEventListener('visibilitychange', onHidden);
      flush();
    };
  }, [engine]);

  // Adopt what the store says — but never over the top of an unsaved edit to the field it
  // would land in. Any change to this document re-runs the effect, including one that
  // touches a field nobody here is typing in, and a teammate renaming the document used to
  // wipe a half-written body out of the textarea mid-sentence with no way to get it back.
  // Per field rather than per screen, so that rename still shows up in the title while the
  // body being typed is left alone; Save is what reconciles a field somebody did edit.
  //
  // Moving to a *different* document reloads unconditionally: the fields belong to whatever
  // the route points at, and carrying one document's draft onto another would save it there.
  const loaded = useRef<string | null>(document?.id ?? null);
  useEffect(() => {
    if (document === null) return;
    const switched = loaded.current !== document.id;
    loaded.current = document.id;
    if (switched) {
      setTitle(document.title);
      setBody(document.body);
      setTitleDirty(false);
      setBodyDirty(false);
      return;
    }
    if (!titleDirty) setTitle(document.title);
    if (!bodyDirty) setBody(document.body);
  }, [document?.id, document?.title, document?.body, document, titleDirty, bodyDirty]);

  const state = useEntityState(document);

  // A deep link on a cold start used to say the document had been deleted while its row was
  // still on the wire, and offer a button off the page. The gate holds the skeleton until
  // the replica has actually settled.
  if (state === 'loading') return <EntityLoading label="Loading document…" lines={8} />;
  if (document === null) {
    return (
      <EmptyState
        title="No such document"
        description="It may have been deleted or archived, or it may belong to a team you cannot see."
        action={<Button onClick={() => navigate(-1)}>Go back</Button>}
      />
    );
  }

  const backTo =
    document.projectId === undefined
      ? `/team/${teamKeyOf(engine.store, document.teamId)}/documents`
      : `/project/${document.projectId}/documents`;

  const save = async () => {
    if (saving || !dirty) return;
    const sentTitle = title;
    const sentBody = body;
    const trimmed = sentTitle.trim();
    if (trimmed === '') {
      titleRef.current?.focus();
      return;
    }
    setSaving(true);
    setFailure(null);
    try {
      await updateDocument(engine, {
        id: document.id,
        title: trimmed,
        body: sentBody,
      });
      // Only a field that has not moved since the request left is clean. Typing does not
      // stop while a save is in flight — a slow connection is when it is most likely to
      // carry on — and clearing the flag for a field that did move hands the effect above
      // permission to replace those keystrokes with the value that was sent, silently, with
      // Save going disabled as if the newer text had been written. Leaving the field dirty
      // keeps it on the screen and keeps Save live to send it.
      if (showing.current.title === sentTitle) setTitleDirty(false);
      if (showing.current.body === sentBody) setBodyDirty(false);
    } catch (error) {
      // A refusal has to be said out loud. The server rejects a title over its limit, and
      // an uncaught rejection here left the page looking as though nothing had happened —
      // the text still on the screen, Save still lit, and the only account of why it did
      // not stick in the browser console. The edit stays put and stays dirty, so saying so
      // is all that is missing.
      setFailure(messageFor(error, 'That could not be saved just now.'));
    } finally {
      setSaving(false);
    }
  };

  /**
   * Archive and delete, behind the same confirmation the rest of the product uses.
   *
   * They were two identical ghost buttons side by side, one of which is reversible and one
   * of which is not, and a document is the surface most likely to hold the only copy of
   * something. The dialog stays open on a refusal and shows the server's own words, rather
   * than dropping them behind a screen the navigation has already left.
   */
  const confirmRemoval = () => {
    if (confirming === null) return;
    const archiving = confirming === 'archive';
    setRemoving(true);
    setFailure(null);
    const work = archiving
      ? archiveDocument(engine, document.id, true)
      : deleteDocument(engine, document.id);
    void work
      .then(() => {
        setConfirming(null);
        void navigate(backTo);
      })
      .catch((error: unknown) =>
        setFailure(
          messageFor(
            error,
            archiving ? 'That could not be archived.' : 'That could not be deleted.',
          ),
        ),
      )
      .finally(() => setRemoving(false));
  };

  return (
    <article className={styles.screen}>
      <header className={styles.header}>
        <Link to={backTo} className={styles.back}>
          Documents
        </Link>
        <div className={styles.actions}>
          <Button variant="ghost" onClick={() => setConfirming('archive')}>
            Archive
          </Button>
          <Button variant="danger" onClick={() => setConfirming('delete')}>
            Delete
          </Button>
          <Button variant="primary" loading={saving} disabled={!dirty} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </header>

      {failure === null ? null : (
        <p className={styles.error} role="alert">
          {failure}
        </p>
      )}

      <h1 className={styles.title}>
        <Input
          ref={titleRef}
          label="Title"
          hideLabel
          surface="plain"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setTitleDirty(true);
          }}
          onBlur={() => void save()}
        />
      </h1>

      <div className={styles.bodyWrap}>
        <Textarea
          ref={bodyRef}
          label="Body"
          hideLabel
          surface="plain"
          className={styles.body}
          value={body}
          minRows={16}
          onFocus={() => setEditing(true)}
          onChange={(event) => {
            setBody(event.target.value);
            setBodyDirty(true);
          }}
          onBlur={() => {
            setEditing(false);
            void save();
          }}
        />
        {editing ? null : (
          /*
           * The document as it reads, laid over the field that holds its source.
           *
           * A document was stored as markdown and shown as markdown, so every reader saw
           * `## Heading` where a heading belonged. This is the read side of that: it is
           * `aria-hidden`, carries no focus stops of its own and is transparent to the
           * pointer, so the textarea underneath is still the field in every sense — a click
           * lands on it and focuses it natively, which is what swaps this layer away.
           * Duplicating the body in the accessibility tree would announce it twice.
           */
          <div className={styles.reader} aria-hidden="true">
            {body.trim() === '' ? (
              <p className={styles.placeholder}>Empty. Click to write.</p>
            ) : (
              <Markdown source={body} interactive={false} />
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirming !== null}
        title={confirming === 'archive' ? 'Archive this document?' : 'Delete this document?'}
        consequence={
          confirming === 'archive'
            ? `“${document.title}” leaves the documents list and stays in the archive, where it can be restored.`
            : `“${document.title}” and everything written in it go for good. There is no undo.`
        }
        confirmLabel={confirming === 'archive' ? 'Archive' : 'Delete'}
        destructive={confirming === 'delete'}
        busy={removing}
        error={confirming === null ? undefined : (failure ?? undefined)}
        onConfirm={confirmRemoval}
        onClose={() => {
          setConfirming(null);
          setFailure(null);
        }}
      />
    </article>
  );
}

/** The server's own words where there are any, and a plain sentence where there are not. */
function messageFor(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message !== '') return error.message;
  return fallback;
}

function teamKeyOf(store: import('~/store').Store, teamId: string): string {
  return store.get('team', teamId)?.key ?? 'unknown';
}
