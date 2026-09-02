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
import { report } from '~/features/issue/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Attachment, UUID } from '~/store';
import { ApiError } from '~/sync/api';

import { createAttachment, deleteAttachment } from './mutations';
import styles from './Links.module.css';

export function Links({ issueId }: { issueId: UUID }) {
  const engine = useEngine();
  const urlRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [removing, setRemoving] = useState<Attachment | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

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
    const typedTitle = title.trim();
    setRefusal(null);
    setUrl('');
    setTitle('');
    // `report` still writes the line, because a console trace is what a developer reads. It
    // was the whole answer, which it cannot be: the server refuses a URL it cannot parse and
    // one over 2048 characters, the optimistic card is rolled back, and the person who typed
    // it watched it vanish with no reason given anywhere they were looking. So the message
    // goes on the screen and the box gets its text back to correct.
    createAttachment(engine, { issueId, url: trimmed, title: typedTitle || undefined }).catch(
      (error: unknown) => {
        report(error);
        setUrl(trimmed);
        setTitle(typedTitle);
        setRefusal(
          error instanceof ApiError && error.message !== ''
            ? error.message
            : 'That link could not be added.',
        );
      },
    );
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
                <span className={styles.linkTitle}>{shownTitle(row)}</span>
                <LinkSubtitle row={row} />
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

      {refusal === null ? null : (
        <p className={styles.refusal} role="alert">
          {refusal}
        </p>
      )}

      <ConfirmDialog
        open={removing !== null}
        title="Remove this link?"
        consequence="The card leaves this issue. The URL itself is unchanged, and attaching it again puts it back."
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (removing !== null) deleteAttachment(engine, removing.id).catch(report);
          setRemoving(null);
        }}
        onClose={() => setRemoving(null)}
      />
    </section>
  );
}

/**
 * What the first line of the card says.
 *
 * The server already defaults a title-less attachment to its host, so `row.title` is very
 * often the host string rather than empty — which is why the fallback below cannot be the
 * only place the host is considered.
 */
function shownTitle(row: { title: string; url: string }): string {
  return row.title === '' ? hostOf(row.url) : row.title;
}

/**
 * The second line, or nothing.
 *
 * A link with no metadata and no title of its own was rendering "github.com" above
 * "github.com": the title line falls back to the host, and so did this one, and neither knew
 * the other had. A subtitle that only repeats the line above it is not a quiet detail, it is
 * the card looking broken — so when the host is already the title, there is no second line.
 */
function LinkSubtitle({
  row,
}: {
  row: { title: string; url: string; subtitle?: string | undefined; metadata?: unknown };
}) {
  if (row.subtitle !== undefined && row.subtitle !== '') {
    return <span className={styles.subtitle}>{formatSubtitle(row.subtitle, row.metadata)}</span>;
  }
  const host = hostOf(row.url);
  if (host === shownTitle(row)) return null;
  return <span className={styles.subtitle}>{host}</span>;
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
