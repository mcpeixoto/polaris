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
import { archiveDocument, deleteDocument, updateDocument } from '~/features/documents/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import styles from './DocumentDetail.module.css';

export function DocumentDetail() {
  const navigate = useNavigate();
  const engine = useEngine();
  const { documentId = '' } = useParams<{ documentId: string }>();
  const titleRef = useRef<HTMLInputElement>(null);

  const document = useLiveQuery(
    (store) => store.documents.get(documentId) ?? null,
    ['document'],
    [documentId],
  );

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [titleDirty, setTitleDirty] = useState(false);
  const [bodyDirty, setBodyDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirty = titleDirty || bodyDirty;

  // Adopt what the store says — but never over the top of an unsaved edit to the field it
  // would land in. Any change to this document re-runs the effect, including one that
  // touches a field nobody here is typing in, and a teammate renaming the document used to
  // wipe a half-written body out of the textarea mid-sentence with no way to get it back.
  // Per field rather than per screen, so that rename still shows up in the title while the
  // body being typed is left alone; Save is what reconciles a field somebody did edit.
  //
  // Moving to a *different* document reloads unconditionally: the fields belong to whatever
  // the route points at, and carrying one document's draft onto another would save it there.
  const loaded = useRef<string | null>(null);
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
    const trimmed = title.trim();
    if (trimmed === '') {
      titleRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      await updateDocument(engine, {
        id: document.id,
        title: trimmed,
        body,
      });
      setTitleDirty(false);
      setBodyDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const onArchive = () => {
    void archiveDocument(engine, document.id, true).then(() => navigate(backTo));
  };

  const onDelete = () => {
    void deleteDocument(engine, document.id).then(() => navigate(backTo));
  };

  return (
    <article className={styles.screen}>
      <header className={styles.header}>
        <Link to={backTo} className={styles.back}>
          Documents
        </Link>
        <div className={styles.actions}>
          <Button variant="ghost" onClick={onArchive}>
            Archive
          </Button>
          <Button variant="ghost" onClick={onDelete}>
            Delete
          </Button>
          <Button variant="primary" loading={saving} disabled={!dirty} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </header>

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

      <Textarea
        label="Body"
        hideLabel
        surface="plain"
        className={styles.body}
        value={body}
        minRows={16}
        onChange={(event) => {
          setBody(event.target.value);
          setBodyDirty(true);
        }}
        onBlur={() => void save()}
      />
    </article>
  );
}

function teamKeyOf(store: import('~/store').Store, teamId: string): string {
  return store.get('team', teamId)?.key ?? 'unknown';
}
