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
 *
 * The icon is here because it is a real field — the sidebar and the issue composer both draw
 * it — that had no control anywhere in the product, so every team was an initial on the
 * identity ramp whether or not anybody wanted one. It is a pill rather than a fourth row:
 * it is the one thing here nobody has to answer.
 */

import { useId, useRef, useState, type FormEvent } from 'react';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import { Button, Input, Modal, PropertyPill, SWATCHES, Switch } from '~/components';
import { IconPicker } from '~/features/icon/IconPicker';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
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
  const iconTrigger = useMenuTrigger<HTMLButtonElement>('dialog');

  const takenKeys = useLiveQuery(
    (store) => [...store.teams.values()].map((team) => team.key),
    ['team'],
  );

  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  // Whether the key field has been typed into. Until it has, it tracks the name.
  const [keyTouched, setKeyTouched] = useState(false);
  const [isPrivate, setPrivate] = useState(false);
  // The first swatch is the neutral one, which is the right answer for a team that has not
  // chosen: a colour is only drawn once there is an emoji to tint.
  const [icon, setIcon] = useState({ icon: '', color: SWATCHES[0] ?? '#64748b' });
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
        icon: icon.icon,
        color: icon.color,
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
          // The picker panel is portalled out of this form's DOM but stay inside its React
          // tree, so the little form it uses to commit a typed value bubbles its
          // submit through here. Only this form's own submit is a save; without the check,
          // choosing an emoji filed the edit as a side effect of choosing it.
          if (event.target !== event.currentTarget) return;
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

        <div className={styles.pills}>
          <PropertyPill
            {...iconTrigger.props}
            name="Icon"
            describe={`${formId}-icon`}
            empty={icon.icon === '' ? 'No icon' : undefined}
            icon={
              icon.icon === '' ? null : (
                <span aria-hidden="true" style={{ color: icon.color }}>
                  {icon.icon}
                </span>
              )
            }
          >
            {icon.icon === '' ? 'Icon' : icon.icon}
          </PropertyPill>
          <IconPicker
            open={iconTrigger.open}
            onClose={iconTrigger.hide}
            trigger={iconTrigger.ref}
            value={icon}
            onChange={setIcon}
            actionId="team.create.closeIconPicker"
            label="Team icon"
          />
        </div>

        <Switch
          label="Private team"
          hint="A private team and everything in it is invisible to anyone who is not a member."
          checked={isPrivate}
          onChange={setPrivate}
        />

        {saveError === null ? null : (
          <p className={styles.error} role="alert">
            {saveError}
          </p>
        )}
      </form>
    </Modal>
  );
}
