/**
 * Attach feedback to an issue or project, optionally naming a customer.
 *
 * This was the densest run of native `<select>`s in the product: three of them stacked, one
 * of which offered two hundred issues by identifier with no way to type. A `<select>` is a
 * fine control for four options and a poor one for two hundred — it cannot be filtered, it
 * cannot draw anything beside the words, and it looks like a different control on every
 * platform. All three are `Menu` pickers on a property row now, the shape the rest of the
 * product uses to say "these are the things this record is about".
 *
 * Project reuses `ProjectPicker`, which already knows the ranking that puts the project you
 * are on near the top. Customer and issue are plain filterable menus over the replica,
 * because neither has an ordering rule worth more than alphabetical.
 */

import { useId, useRef, useState, type FormEvent } from 'react';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import { Button, Menu, Modal, PropertyPill, Switch, Textarea, type MenuNode } from '~/components';
import { ProjectPicker } from '~/features/projects/ProjectPicker';
import { useDialogSubmit } from '~/hooks/useDialogSubmit';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import type { UUID } from '~/store';

import { createCustomerRequest } from './mutations';
import styles from './CreateCustomerModal.module.css';

export interface CreateCustomerRequestModalProps {
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
  issueId?: UUID | undefined;
  projectId?: UUID | undefined;
  customerId?: UUID | undefined;
}

export function CreateCustomerRequestModal({
  open = true,
  onClose,
  issueId,
  projectId,
  customerId: seededCustomerId,
}: CreateCustomerRequestModalProps) {
  const engine = useEngine();
  const formId = useId();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const customerMenu = useMenuTrigger();
  const issueMenu = useMenuTrigger();
  const projectMenu = useMenuTrigger();

  const [body, setBody] = useState('');
  const [important, setImportant] = useState(false);
  const [customerId, setCustomerId] = useState<UUID | null>(seededCustomerId ?? null);
  const [chosenIssue, setChosenIssue] = useState<UUID | null>(issueId ?? null);
  const [chosenProject, setChosenProject] = useState<UUID | null>(projectId ?? null);
  const { saving, error, setError, submit, submitRef } = useDialogSubmit(
    'Could not create the customer request',
  );

  const customers = useLiveQuery(
    (store) =>
      [...store.customers.values()]
        .filter((row) => row.archivedAt === undefined && row.deletedAt === undefined)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((row) => ({ id: row.id, name: row.name })),
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
            .map((row) => ({
              id: row.id,
              identifier: store.identifierOf(row),
              title: row.title,
            })),
    ['issue', 'team'],
    [issueId ?? ''],
  );

  const needsTarget = issueId === undefined && projectId === undefined;
  const customer = customers.find((row) => row.id === customerId) ?? null;
  const issue = issues.find((row) => row.id === chosenIssue) ?? null;

  const customerItems: MenuNode[] = [
    {
      id: 'none',
      label: 'No customer',
      selected: customerId === null,
      onSelect: () => setCustomerId(null),
    },
    ...customers.map((row): MenuNode => ({
      id: row.id,
      label: row.name,
      selected: row.id === customerId,
      onSelect: () => setCustomerId(row.id),
    })),
  ];

  const issueItems: MenuNode[] = [
    {
      id: 'none',
      label: 'No issue',
      selected: chosenIssue === null,
      onSelect: () => setChosenIssue(null),
    },
    ...issues.map((row): MenuNode => ({
      id: row.id,
      label: row.title,
      hint: row.identifier,
      // The identifier is how people refer to an issue out loud, so it has to be part of
      // what the filter box matches rather than only part of what is drawn.
      text: `${row.identifier} ${row.title}`.toLowerCase(),
      selected: row.id === chosenIssue,
      onSelect: () => setChosenIssue(row.id),
    })),
  ];

  const save = async () => {
    const targetIssue = issueId ?? chosenIssue ?? undefined;
    const targetProject = projectId ?? chosenProject ?? undefined;
    if (targetIssue === undefined && targetProject === undefined) {
      setError('Attach this request to an issue or a project');
      return;
    }
    await submit(async () => {
      await createCustomerRequest(engine, {
        body: body.trim(),
        important,
        customerId: customerId ?? undefined,
        issueId: targetIssue,
        projectId: targetProject,
      });
      onClose();
    });
  };

  // Reassigned every render, read at dispatch: the registry keeps the action object it was
  // handed at mount, so a `run` closing over this render's `save` would go on submitting
  // the dialog as it stood when it opened.
  submitRef.current = () => void save();

  useKeyContext('modal', open);
  // Registered only while the dialog is up: a shut dialog that still bound ⌘⏎ would
  // collide with the next one to claim it.
  useActions(
    open
      ? [
          {
            id: 'customerRequest.create.submit',
            title: 'Create customer request',
            keys: ['mod+Enter'],
            when: 'modal',
            group: 'Customers',
            hidden: true,
            run: () => submitRef.current(),
          },
        ]
      : [],
    [open],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New customer request"
      size="md"
      initialFocus={bodyRef}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
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

        <div className={styles.pills}>
          {seededCustomerId === undefined && (
            <>
              <PropertyPill
                {...customerMenu.props}
                name="Customer"
                describe={`${formId}-customer`}
                empty={customer === null ? 'No customer' : undefined}
              >
                {customer?.name ?? 'Customer'}
              </PropertyPill>
              <Menu
                open={customerMenu.open}
                onClose={customerMenu.hide}
                trigger={customerMenu.ref}
                items={customerItems}
                label="Customer"
                filterable
                filterPlaceholder="Asked for by…"
                emptyLabel="No customer by that name"
              />
            </>
          )}

          {needsTarget && (
            <>
              <PropertyPill
                {...issueMenu.props}
                name="Issue"
                describe={`${formId}-issue`}
                empty={issue === null ? 'No issue' : undefined}
              >
                {issue === null ? 'Issue' : issue.identifier}
              </PropertyPill>
              <Menu
                open={issueMenu.open}
                onClose={issueMenu.hide}
                trigger={issueMenu.ref}
                items={issueItems}
                label="Issue"
                filterable
                filterPlaceholder="Attach to an issue…"
                emptyLabel="No issue under that name"
              />

              <PropertyPill
                {...projectMenu.props}
                name="Project"
                describe={`${formId}-project`}
                empty={chosenProject === null ? 'No project' : undefined}
              >
                <ProjectPillLabel projectId={chosenProject} />
              </PropertyPill>
              <ProjectPicker
                open={projectMenu.open}
                onClose={projectMenu.hide}
                trigger={projectMenu.ref}
                value={chosenProject}
                onSelect={setChosenProject}
              />
            </>
          )}
        </div>

        <Switch label="Mark as important" checked={important} onChange={setImportant} />

        {error !== null && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

/** The chosen project's name, or the property's own word while there is none. */
function ProjectPillLabel({ projectId }: { projectId: UUID | null }) {
  const project = useLiveQuery(
    (store) => (projectId === null ? null : (store.projects.get(projectId) ?? null)),
    ['project'],
    [projectId ?? ''],
  );
  return <>{project?.name ?? 'Project'}</>;
}
