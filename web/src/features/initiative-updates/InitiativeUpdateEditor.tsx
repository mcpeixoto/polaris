/**
 * Editing a posted initiative update in place.
 *
 * An update is a dated statement about an initiative, so correcting one has to keep it the
 * same post rather than adding a second: the history is read top to bottom and a duplicate
 * with a different health reads as two decisions instead of one typo. The server allows this
 * to the author only, so the affordance that opens this form is drawn only for the author
 * too — a button that always answers "you can only edit your own initiative updates" is
 * worse than no button.
 */

import { useState, type FormEvent } from 'react';

import { useEngine } from '~/app/context';
import { Button, Select, Textarea } from '~/components';
import type { InitiativeUpdate, ProjectUpdateHealth } from '~/store';
import { ApiError } from '~/sync/api';

import { INITIATIVE_UPDATE_HEALTH_LABEL } from './helpers';
import { updateInitiativeUpdate } from './mutations';
import styles from './InitiativeUpdateEditor.module.css';

const HEALTH_ORDER: readonly ProjectUpdateHealth[] = ['on_track', 'at_risk', 'off_track'];

interface InitiativeUpdateEditorProps {
  readonly update: InitiativeUpdate;
  readonly onDone: () => void;
}

export function InitiativeUpdateEditor({ update, onDone }: InitiativeUpdateEditorProps) {
  const engine = useEngine();
  const [health, setHealth] = useState<ProjectUpdateHealth>(update.health);
  const [body, setBody] = useState(update.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await updateInitiativeUpdate(engine, { id: update.id, health, body });
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
      <Select
        label="Health"
        value={health}
        onChange={(event) => setHealth(event.target.value as ProjectUpdateHealth)}
      >
        {HEALTH_ORDER.map((value) => (
          <option key={value} value={value}>
            {INITIATIVE_UPDATE_HEALTH_LABEL[value]}
          </option>
        ))}
      </Select>
      <Textarea
        label="Edit update"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        minRows={4}
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
