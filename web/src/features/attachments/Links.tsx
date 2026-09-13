/**
 * Link cards on an issue: the URL-idempotent attachments, plus image upload.
 *
 * Read from the replica. Add is a URL plus an optional title, or a file from the picker /
 * paste elsewhere; remove is a confirm on the row. `#` is archives restore, so this panel
 * does not steal it.
 */

import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';

import { useEngine } from '~/app/context';
import { useActions } from '~/app/keymap';
import { Button, IconButton, Input, Section } from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import { formatSubtitle } from '~/features/attachments/tokens';
import { uploadImage } from '~/features/files/upload';
import { CrossGlyph, PlusGlyph } from '~/features/issue/glyphs';
import { report } from '~/features/issue/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Attachment, UUID } from '~/store';
import { ApiError } from '~/sync/api';

import { createAttachment, deleteAttachment } from './mutations';
import styles from './Links.module.css';

export function Links({ issueId }: { issueId: UUID }) {
  const engine = useEngine();
  const urlRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [removing, setRemoving] = useState<Attachment | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

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

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined) return;
    setRefusal(null);
    setUploading(true);
    // Upload without issueId: the link card is created here so the replica gets an
    // optimistic row. The server upload path can also attach, but that would skip the
    // client's reconcile and leave a gap until the next delta.
    uploadImage(file)
      .then((uploaded) =>
        createAttachment(engine, {
          issueId,
          url: uploaded.absoluteUrl,
          title: uploaded.name,
        }),
      )
      .catch((error: unknown) => {
        report(error);
        setRefusal(
          error instanceof ApiError && error.message !== ''
            ? error.message
            : 'That image could not be uploaded.',
        );
      })
      .finally(() => setUploading(false));
  };

  return (
    <Section
      title="Links"
      headingId={`${issueId}-links`}
      count={rows.length === 0 ? undefined : rows.length}
      action={
        <IconButton
          size="sm"
          icon={<PlusGlyph />}
          aria-label="Attach a link"
          keys="mod+shift+u"
          onClick={() => urlRef.current?.focus()}
        />
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className={styles.fileInput}
        onChange={onFile}
      />

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
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? 'Uploading…' : 'Upload image'}
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
    </Section>
  );
}

function shownTitle(row: { title: string; url: string }): string {
  return row.title === '' ? hostOf(row.url) : row.title;
}

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
