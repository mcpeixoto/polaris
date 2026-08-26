/**
 * Create a customer — name and optional domains.
 */

import { useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import { Button, Input, Modal } from '~/components';
import { useViewerId } from '~/hooks/useViewer';
import { ApiError } from '~/sync/api';

import { createCustomer } from './mutations';
import styles from './CreateCustomerModal.module.css';

export interface CreateCustomerModalProps {
  onClose: () => void;
}

export function CreateCustomerModal({ onClose }: CreateCustomerModalProps) {
  const engine = useEngine();
  const navigate = useNavigate();
  const viewerId = useViewerId();
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [domains, setDomains] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useKeyContext('modal');
  useActions(
    [
      {
        id: 'customer.create.submit',
        title: 'Create customer',
        keys: ['mod+Enter'],
        when: 'modal',
        group: 'Customers',
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
      setNameError('A customer needs a name');
      nameRef.current?.focus();
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const parsed = domains
        .split(/[\s,]+/)
        .map((item) => item.trim())
        .filter((item) => item !== '');
      const id = await createCustomer(engine, {
        name: trimmed,
        domains: parsed,
        ownerId: viewerId ?? undefined,
      });
      onClose();
      if (id !== '') void navigate(`/customer/${id}`);
    } catch (error) {
      setSaving(false);
      setSaveError(error instanceof ApiError ? error.message : 'Could not create the customer');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="New customer"
      size="md"
      initialFocus={nameRef}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button form={formId} type="submit" variant="primary" loading={saving}>
            Create customer
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
          placeholder="Acme"
        />
        <Input
          label="Domains"
          value={domains}
          onChange={(event) => setDomains(event.target.value)}
          hint="Comma-separated, unique in this workspace"
          placeholder="acme.com"
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
