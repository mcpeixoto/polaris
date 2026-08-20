/**
 * Attach feedback to an issue or project, optionally naming a customer.
 */

import { useId, useMemo, useRef, useState, type FormEvent } from 'react';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import { Button, Checkbox, Modal, Select, Textarea } from '~/components';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { ApiError } from '~/sync/api';
import type { UUID } from '~/store';

import { createCustomerRequest } from './mutations';
import styles from './CreateCustomerModal.module.css';

export interface CreateCustomerRequestModalProps {
  onClose: () => void;
  issueId?: UUID | undefined;
  projectId?: UUID | undefined;
  customerId?: UUID | undefined;
}

export function CreateCustomerRequestModal({
  onClose,
  issueId,
  projectId,
  customerId: seededCustomerId,
}: CreateCustomerRequestModalProps) {
  const engine = useEngine();
  const formId = useId();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState('');
  const [important, setImportant] = useState(false);
  const [customerId, setCustomerId] = useState(seededCustomerId ?? '');
  const [chosenIssue, setChosenIssue] = useState(issueId ?? '');
  const [chosenProject, setChosenProject] = useState(projectId ?? '');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const customers = useLiveQuery(
    (store) =>
      [...store.customers.values()]
        .filter((row) => row.archivedAt === undefined && row.deletedAt === undefined)
        .sort((a, b) => a.name.localeCompare(b.name)),
    ['customer'],
  );
  const issues = useLiveQuery(
    (store) =>
      issueId !== undefined
        ? []
        : [...store.issues.values()]
            .filter((row) => row.archivedAt === undefined)
            .sort((a, b) => store.identifierOf(a).localeCompare(store.identifierOf(b)))
            .slice(0, 200)
            .map((row) => ({ id: row.id, label: `${store.identifierOf(row)} ${row.title}` })),
    ['issue', 'team'],
    [issueId ?? ''],
  );
  const projects = useLiveQuery(
    (store) =>
      projectId !== undefined
        ? []
        : [...store.projects.values()]
            .filter((row) => row.archivedAt === undefined && row.deletedAt === undefined)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((row) => ({ id: row.id, name: row.name })),
    ['project'],
    [projectId ?? ''],
  );

  const needsTarget = issueId === undefined && projectId === undefined;
  const title = useMemo(() => 'New customer request', []);

  useKeyContext('modal');
  useActions(
    [
      {
        id: 'customerRequest.create.submit',
        title: 'Create customer request',
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
    const targetIssue = issueId ?? (chosenIssue === '' ? undefined : chosenIssue);
    const targetProject = projectId ?? (chosenProject === '' ? undefined : chosenProject);
    if (targetIssue === undefined && targetProject === undefined) {
      setSaveError('Attach this request to an issue or a project');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await createCustomerRequest(engine, {
        body: body.trim(),
        important,
        customerId: customerId === '' ? undefined : customerId,
        issueId: targetIssue,
        projectId: targetProject,
      });
      onClose();
    } catch (error) {
      setSaving(false);
      setSaveError(
        error instanceof ApiError ? error.message : 'Could not create the customer request',
      );
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size="md"
      initialFocus={bodyRef}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button form={formId} type="submit" variant="primary" loading={saving}>
            Add request
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
        <Textarea
          ref={bodyRef}
          label="Request"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="What did they ask for?"
          minRows={4}
        />
        {seededCustomerId === undefined && (
          <Select
            label="Customer"
            value={customerId}
            onChange={(event) => setCustomerId(event.target.value)}
          >
            <option value="">None</option>
            {customers.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </Select>
        )}
        {needsTarget && (
          <>
            <Select
              label="Issue"
              value={chosenIssue}
              onChange={(event) => setChosenIssue(event.target.value)}
            >
              <option value="">None</option>
              {issues.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </Select>
            <Select
              label="Project"
              value={chosenProject}
              onChange={(event) => setChosenProject(event.target.value)}
            >
              <option value="">None</option>
              {projects.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </Select>
          </>
        )}
        <Checkbox
          label="Mark as important"
          checked={important}
          onChange={(event) => setImportant(event.target.checked)}
        />
        {saveError !== null && <p className={styles.error}>{saveError}</p>}
      </form>
    </Modal>
  );
}
