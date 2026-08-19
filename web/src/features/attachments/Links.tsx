/**
 * Link cards on an issue: the URL-idempotent attachments.
 *
 * Read from the replica. Add is a URL plus an optional title; remove is a confirm on the
 * row. `#` is archives restore, so this panel does not steal it.
 */

import { useRef, useState, type FormEvent } from 'react';

import { useEngine } from '~/app/context';
import { useActions } from '~/app/keymap';
import { Button, IconButton, Input } from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import { formatSubtitle } from '~/features/attachments/tokens';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Attachment, UUID } from '~/store';

import { createAttachment, deleteAttachment } from './mutations';
import styles from './Links.module.css';

export function Links({ issueId }: { issueId: UUID }) {
  const engine = useEngine();
  const urlRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [removing, setRemoving] = useState<Attachment | null>(null);

  const rows = useLiveQuery(
    (store) =>
      [...store.attachmentIdsFor(issueId)]
        .map((id) => store.get('attachment', id))
        .filter((row): row is Attachment => row !== undefined)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    ['attachment'],
    [issueId],
  );

  useActions(
    [
      {
        id: 'issueDetail.addLink',
        title: 'Add link',
        keys: ['mod+shift+u'],
        when: 'detail',
        group: 'Issues',
        run: () => urlRef.current?.focus(),
      },
    ],
    [],
  );

  const onAdd = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = url.trim();
    if (trimmed === '') return;
    void createAttachment(engine, { issueId, url: trimmed, title: title.trim() || undefined });
    setUrl('');
    setTitle('');
  };

  return (
    <section className={styles.panel} aria-labelledby={`${issueId}-links`}>
      <header className={styles.head}>
        <h2 id={`${issueId}-links`} className={styles.title}>
          Links
        </h2>
      </header>

      {rows.length === 0 ? null : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.id} className={styles.row}>
              <a className={styles.link} href={row.url} target="_blank" rel="noreferrer">
                <span className={styles.linkTitle}>
                  {row.title === '' ? hostOf(row.url) : row.title}
                </span>
                {row.subtitle !== undefined && row.subtitle !== '' ? (
                  <span className={styles.subtitle}>
                    {formatSubtitle(row.subtitle, row.metadata)}
                  </span>
                ) : (
                  <span className={styles.subtitle}>{hostOf(row.url)}</span>
                )}
              </a>
              <IconButton
                size="sm"
                variant="ghost"
                icon={<CrossGlyph />}
                aria-label={`Remove ${row.title === '' ? row.url : row.title}`}
                tooltip="Remove link"
                onClick={() => setRemoving(row)}
              />
            </li>
          ))}
        </ul>
      )}

      <form className={styles.form} onSubmit={onAdd}>
        <Input
          ref={urlRef}
          label="URL"
          hideLabel
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="Paste a URL"
        />
        <Input
          label="Title"
          hideLabel
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Title"
        />
        <Button type="submit" size="sm" disabled={url.trim() === ''}>
          Add
        </Button>
      </form>

      <ConfirmDialog
        open={removing !== null}
        title="Remove this link?"
        consequence="The card leaves this issue. The URL itself is unchanged, and attaching it again puts it back."
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (removing !== null) void deleteAttachment(engine, removing.id);
          setRemoving(null);
        }}
        onClose={() => setRemoving(null)}
      />
    </section>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function CrossGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M2.5 2.5l7 7M9.5 2.5l-7 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
