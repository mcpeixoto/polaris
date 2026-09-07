/**
 * Create an initiative — name first; properties can wait until the overview.
 */

import { useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import { Button, Input, Modal, Select } from '~/components';
import { useViewerId } from '~/hooks/useViewer';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { ApiError } from '~/sync/api';

import { createInitiative } from './mutations';
import styles from './CreateInitiativeModal.module.css';

export interface CreateInitiativeModalProps {
  /**
   * Whether the dialog is up.
   *
   * The shell mounts this component for its own lifetime and tells it, rather than
   * rendering it into existence: a dialog cannot animate its own removal from a tree it has
   * already left, and one that exists only while it is open pushes the `modal` key context
   * and claims ⌘⏎ as a side effect of mounting. Both are gated on this, so a closed dialog
   * claims nothing.
   *
   * Defaults to true, which is the contract this component had before the prop existed:
   * something that mounted it meant it.
   */
  open?: boolean | undefined;
  onClose: () => void;
}

export function CreateInitiativeModal({ open = true, onClose }: CreateInitiativeModalProps) {
  const engine = useEngine();
  const navigate = useNavigate();
  const viewerId = useViewerId();
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const parents = useLiveQuery(
    (store) =>
      [...store.initiatives.values()]
        .filter((row) => row.archivedAt === undefined && row.deletedAt === undefined)
        .map((row) => ({ id: row.id, name: row.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ['initiative'],
  );

  useKeyContext('modal', open);
  // Registered only while the dialog is up: a shut dialog that still bound ⌘⏎ would
  // collide with the next one to claim it.
  useActions(
    open
      ? [
          {
            id: 'initiative.create.submit',
            title: 'Create initiative',
            keys: ['mod+Enter'],
            when: 'modal',
            group: 'Initiatives',
            hidden: true,
            run: () => {
              void save();
            },
          },
        ]
      : [],
    [open],
  );

  const save = async () => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setNameError('An initiative needs a name');
      nameRef.current?.focus();
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const id = await createInitiative(engine, {
        name: trimmed,
        ownerId: viewerId ?? undefined,
        parentInitiativeId: parentId === '' ? undefined : parentId,
      });
      onClose();
      if (id !== '') void navigate(`/initiative/${id}`);
    } catch (error) {
      setSaving(false);
      setSaveError(error instanceof ApiError ? error.message : 'Could not create the initiative');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New initiative"
      size="md"
      initialFocus={nameRef}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button form={formId} type="submit" variant="primary" loading={saving}>
            Create initiative
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
          placeholder="Q3 platform reliability"
        />
        {parents.length > 0 && (
          <Select
            label="Parent"
            hint="Optional. Nests this initiative under another."
            value={parentId}
            onChange={(event) => setParentId(event.target.value)}
          >
            <option value="">No parent</option>
            {parents.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </Select>
        )}
        {saveError !== null && (
          <p className={styles.error} role="alert">
            {saveError}
          </p>
        )}
      </form>
    </Modal>
  );
}
