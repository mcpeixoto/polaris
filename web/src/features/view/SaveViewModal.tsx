/**
 * Name the current filter and choose whether it stays yours or goes in the sidebar.
 *
 * Sharing can be flipped later from the saved view itself — this dialog is the first
 * decision, not a trap. A member saving from My Issues defaults to private because a
 * workspace-wide shared view is an admin action, and failing the save after they typed a
 * name is worse than offering the switch already on.
 */

import { useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import { Button, Checkbox, Input, Modal } from '~/components';
import type { DisplayOptions, FilterNode } from '~/filter';
import { useViewer, useViewerId } from '~/hooks/useViewer';
import type { UUID } from '~/store';
import { ApiError } from '~/sync/api';

import { createView } from './mutations';
import styles from './SaveViewModal.module.css';

export interface SaveViewModalProps {
  filter: FilterNode;
  display: DisplayOptions;
  /** Anchors a shared view to one team's sidebar. Absent makes it workspace-wide. */
  teamId?: UUID | undefined;
  onClose(): void;
}

export function SaveViewModal({ filter, display, teamId, onClose }: SaveViewModalProps) {
  const engine = useEngine();
  const navigate = useNavigate();
  const viewerId = useViewerId();
  const viewer = useViewer();
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);

  const admin = viewer?.role === 'admin' || viewer?.role === 'owner';
  const [name, setName] = useState('');
  const [personal, setPersonal] = useState(teamId === undefined && !admin);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useKeyContext('modal');
  useActions(
    [
      {
        id: 'view.save.submit',
        title: 'Save view',
        keys: ['mod+Enter'],
        when: 'modal',
        group: 'Views',
        hidden: true,
        run: () => {
          void save();
        },
      },
    ],
    [],
  );

  const save = async () => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setNameError('A view needs a name');
      nameRef.current?.focus();
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const id = await createView(engine, {
        name: trimmed,
        filter,
        display,
        teamId,
        private: personal,
        ownerId: viewerId ?? undefined,
      });
      onClose();
      if (id !== '') void navigate(`/view/${id}`);
    } catch (error) {
      setSaving(false);
      setSaveError(error instanceof ApiError ? error.message : 'Could not save the view');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Save view"
      description="A named filter. Shared views appear in everyone's sidebar; private ones stay yours."
      size="md"
      initialFocus={nameRef}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button form={formId} type="submit" variant="primary" loading={saving}>
            Save view
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className={styles.form}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void save();
        }}
      >
        <Input
          ref={nameRef}
          label="Name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(null);
          }}
          error={nameError ?? undefined}
          placeholder="My bugs"
        />
        <Checkbox
          label="Only visible to me"
          checked={personal}
          onChange={(event) => setPersonal(event.target.checked)}
        />
        {saveError !== null && (
          <p className={styles.error} role="alert">
            {saveError}
          </p>
        )}
      </form>
    </Modal>
  );
}
