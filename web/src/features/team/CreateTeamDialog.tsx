/**
 * New team: a name, the key that goes in front of every issue it will ever hold, and
 * whether it is private.
 *
 * Three fields, and the middle one is the whole reason this is a dialog rather than an
 * inline row. A team key is stamped into sixty thousand identifiers and is the one decision
 * here that is expensive to revisit, so it gets a suggestion, a visible preview of what an
 * identifier will look like, and its own validation before the round trip.
 *
 * The suggestion stops the moment the field is touched. A key that keeps rewriting itself
 * under the cursor as the name is typed is a field fighting its user, and the name is
 * usually finished after the key has been corrected.
 */

import { useId, useRef, useState, type FormEvent } from 'react';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import { Button, Checkbox, Input, Modal } from '~/components';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Team } from '~/store';
import { ApiError } from '~/sync/api';

import { createTeam, MAX_TEAM_KEY_LENGTH, suggestTeamKey, teamKeyProblem } from './create';
import styles from './CreateTeamDialog.module.css';

export interface CreateTeamDialogProps {
  onClose: () => void;
  /** Handed the server's row, so the caller can go to the team it just made. */
  onCreated?: ((team: Team) => void) | undefined;
}

export function CreateTeamDialog({ onClose, onCreated }: CreateTeamDialogProps) {
  const engine = useEngine();
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);

  const takenKeys = useLiveQuery(
    (store) => [...store.teams.values()].map((team) => team.key),
    ['team'],
  );

  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  // Whether the key field has been typed into. Until it has, it tracks the name.
  const [keyTouched, setKeyTouched] = useState(false);
  const [isPrivate, setPrivate] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving) return;

    // In submit order, so focus lands on the first thing that is wrong rather than the last.
    const trimmedName = name.trim();
    if (trimmedName === '') {
      setNameError('A team needs a name');
      nameRef.current?.focus();
      return;
    }
    const problem = teamKeyProblem(key, takenKeys);
    if (problem !== null) {
      setKeyError(problem);
      keyRef.current?.focus();
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const team = await createTeam(engine, {
        name: trimmedName,
        key: key.trim().toUpperCase(),
        private: isPrivate,
      });
      onCreated?.(team);
      onClose();
    } catch (failure: unknown) {
      setSaving(false);
      // The server's field-scoped refusal is nearly always about the key — it is the one
      // value another team can already hold — so it goes on the field rather than into a
      // banner the user has to map back onto a form themselves.
      if (failure instanceof ApiError && failure.field === 'key') {
        setKeyError(failure.message);
        keyRef.current?.focus();
        return;
      }
      setSaveError(failure instanceof ApiError ? failure.message : 'Could not create the team');
    }
  };

  const submitRef = useRef<() => void>(() => {});
  submitRef.current = () => void save();

  useKeyContext('modal');
  useActions(
    [
      {
        id: 'team.create.submit',
        title: 'Create team',
        keys: ['mod+Enter'],
        when: 'modal',
        group: 'Teams',
        hidden: true,
        run: () => submitRef.current(),
      },
    ],
    [],
  );

  const preview = key.trim() === '' ? null : `${key.trim().toUpperCase()}-123`;

  return (
    <Modal
      open
      onClose={onClose}
      title="New team"
      size="sm"
      initialFocus={nameRef}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button form={formId} type="submit" variant="primary" loading={saving}>
            Create team
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className={styles.form}
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          void save();
        }}
      >
        <Input
          ref={nameRef}
          label="Name"
          value={name}
          error={nameError ?? undefined}
          placeholder="Design systems"
          autoComplete="off"
          onChange={(event) => {
            const next = event.target.value;
            setName(next);
            if (nameError !== null) setNameError(null);
            if (!keyTouched) {
              setKey(suggestTeamKey(next));
              setKeyError(null);
            }
          }}
        />

        <Input
          ref={keyRef}
          label="Key"
          hint={
            preview === null
              ? 'It goes in front of every issue identifier and is hard to change later.'
              : `Issues in this team will be called ${preview}.`
          }
          value={key}
          error={keyError ?? undefined}
          maxLength={MAX_TEAM_KEY_LENGTH}
          autoComplete="off"
          spellCheck={false}
          className={styles.key}
          onChange={(event) => {
            setKeyTouched(true);
            setKey(event.target.value.toUpperCase());
            if (keyError !== null) setKeyError(null);
          }}
        />

        <Checkbox
          label="Private team"
          checked={isPrivate}
          onChange={(event) => setPrivate(event.target.checked)}
        />
        <p className={styles.hint}>
          A private team and everything in it is invisible to anyone who is not a member.
        </p>

        {saveError === null ? null : (
          <p className={styles.error} role="alert">
            {saveError}
          </p>
        )}
      </form>
    </Modal>
  );
}
