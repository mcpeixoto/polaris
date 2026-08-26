/**
 * Subscribe-to-cycle-calendar dialog: Google Calendar, copy feed URL, download .ics,
 * or rotate a leaked token.
 */

import { useEffect, useState } from 'react';

import { Button, Modal } from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import { ApiError } from '~/sync/api';

import {
  ensureCycleCalendarFeed,
  googleCalendarSubscribeURL,
  rotateCycleCalendarFeed,
} from './calendar';
import styles from './CycleCalendarModal.module.css';

export interface CycleCalendarModalProps {
  open: boolean;
  teamId: string | null;
  teamName: string;
  onClose: () => void;
}

export function CycleCalendarModal({ open, teamId, teamName, onClose }: CycleCalendarModalProps) {
  const [url, setURL] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmingRotate, setConfirmingRotate] = useState(false);

  useEffect(() => {
    if (!open || teamId === null) {
      setURL(null);
      setError(null);
      setCopied(false);
      setConfirmingRotate(false);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError(null);
    void ensureCycleCalendarFeed(teamId)
      .then((result) => {
        if (!cancelled) setURL(result.url);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof ApiError ? cause.message : 'Could not create a calendar feed.');
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, teamId]);

  const copy = async () => {
    if (url === null) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError('Could not copy the feed URL.');
    }
  };

  const download = async () => {
    if (url === null) return;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        setError('Could not download the calendar.');
        return;
      }
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = `${teamName.toLowerCase().replace(/\s+/g, '-')}-cycles.ics`;
      anchor.click();
      URL.revokeObjectURL(href);
    } catch {
      setError('Could not download the calendar.');
    }
  };

  const rotate = async () => {
    if (teamId === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await rotateCycleCalendarFeed(teamId);
      setURL(result.url);
      setCopied(false);
      setConfirmingRotate(false);
    } catch (cause: unknown) {
      setError(cause instanceof ApiError ? cause.message : 'Could not rotate the calendar feed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Subscribe to cycle calendar"
        description={`Add ${teamName} cycles to Google Calendar, copy a feed URL, or download an .ics.`}
        footer={
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
        }
      >
        {error !== null ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {busy && url === null ? <p className={styles.status}>Minting a feed URL…</p> : null}
        {url !== null ? (
          <div className={styles.actions}>
            <Button
              onClick={() => {
                window.open(googleCalendarSubscribeURL(url), '_blank', 'noopener,noreferrer');
              }}
            >
              Add to Google Calendar
            </Button>
            <Button variant="secondary" onClick={() => void copy()}>
              {copied ? 'Copied feed URL' : 'Copy feed URL'}
            </Button>
            <Button variant="secondary" onClick={() => void download()}>
              Download .ics
            </Button>
            <Button variant="danger" onClick={() => setConfirmingRotate(true)}>
              Rotate feed URL
            </Button>
            <p className={styles.url}>{url}</p>
          </div>
        ) : null}
      </Modal>
      <ConfirmDialog
        open={confirmingRotate}
        title="Rotate this calendar feed?"
        consequence="Anyone already subscribed with the current URL will stop receiving cycle dates. Copy the new URL after rotating and add it again."
        confirmLabel="Rotate feed URL"
        destructive
        busy={busy}
        onClose={() => setConfirmingRotate(false)}
        onConfirm={() => void rotate()}
      />
    </>
  );
}
