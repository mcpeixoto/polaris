/**
 * Create a dashboard — name, optional personal flag.
 */

import { useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import { Button, Checkbox, Input, Modal } from '~/components';
import { useViewerId } from '~/hooks/useViewer';
import { ApiError } from '~/sync/api';

import { createDashboard } from './mutations';
import styles from './CreateDashboardModal.module.css';

export interface CreateDashboardModalProps {
  onClose(): void;
}

export function CreateDashboardModal({ onClose }: CreateDashboardModalProps) {
  const engine = useEngine();
  const navigate = useNavigate();
  const viewerId = useViewerId();
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [personal, setPersonal] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useKeyContext('modal');
  useActions(
    [
      {
        id: 'dashboard.create.submit',
        title: 'Create dashboard',
        keys: ['mod+Enter'],
        when: 'modal',
        group: 'Dashboards',
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
      setNameError('A dashboard needs a name');
      nameRef.current?.focus();
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const id = await createDashboard(engine, {
        name: trimmed,
        private: personal,
        ownerId: viewerId ?? undefined,
      });
      onClose();
      if (id !== '') void navigate(`/dashboard/${id}`);
    } catch (error) {
      setSaving(false);
      setSaveError(error instanceof ApiError ? error.message : 'Could not create the dashboard');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="New dashboard"
      size="md"
      initialFocus={nameRef}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button form={formId} type="submit" variant="primary" loading={saving}>
            Create dashboard
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
          placeholder="Delivery"
        />
        <Checkbox
          label="Personal — only visible to you"
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
