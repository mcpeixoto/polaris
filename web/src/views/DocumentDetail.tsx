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
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (document === null) return;
    setTitle(document.title);
    setBody(document.body);
    setDirty(false);
  }, [document?.id, document?.title, document?.body, document]);

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
      setDirty(false);
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
            setDirty(true);
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
          setDirty(true);
        }}
        onBlur={() => void save()}
      />
    </article>
  );
}

function teamKeyOf(store: import('~/store').Store, teamId: string): string {
  return store.get('team', teamId)?.key ?? 'unknown';
}
