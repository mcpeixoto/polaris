/**
 * Correcting the words of a request that is already attached.
 *
 * Inline rather than a dialogue: a request is read in a list beside the issue or the
 * customer it belongs to, and the edit that matters is usually adding the sentence of
 * context the original quote left out. Lifting that into a modal loses the thing being
 * corrected from view while it is corrected.
 */

import { useState, type FormEvent } from 'react';

import { useEngine } from '~/app/context';
import { Button, Textarea } from '~/components';
import type { UUID } from '~/store';
import { ApiError } from '~/sync/api';

import styles from './CustomerRequestEditor.module.css';
import { updateCustomerRequest } from './mutations';

export interface CustomerRequestEditorProps {
  readonly requestId: UUID;
  readonly body: string;
  readonly onDone: () => void;
}

export function CustomerRequestEditor({ requestId, body, onDone }: CustomerRequestEditorProps) {
  const engine = useEngine();
  const [draft, setDraft] = useState(body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await updateCustomerRequest(engine, requestId, { body: draft.trim() });
      onDone();
    } catch (failure) {
      setSaving(false);
      setError(failure instanceof ApiError ? failure.message : 'That edit could not be saved.');
    }
  };

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      {error === null ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <Textarea
        label="Edit request"
        value={draft}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        minRows={3}
      />
      <div className={styles.actions}>
        <Button type="submit" variant="primary" size="sm" disabled={saving}>
          Save changes
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
