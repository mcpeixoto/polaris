/**
 * Create a customer — name, optional domains, and who owns the relationship.
 *
 * The owner used to be the viewer, silently and with no control: whoever happened to open
 * the dialog became the person every request against this customer was routed to. That is
 * fine as a default — the common case is that you are adding a customer because you are
 * dealing with them — and wrong as a rule, because the person doing the data entry is
 * routinely not the account owner. So the default stays and the pill makes it visible and
 * changeable before the row exists, which is cheaper than fixing it afterwards.
 */

import { useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import { Avatar, Button, Input, Modal, PropertyPill } from '~/components';
import { UserPicker } from '~/features/members/UserPicker';
import { useDialogSubmit } from '~/hooks/useDialogSubmit';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useViewerId } from '~/hooks/useViewer';
import type { UUID } from '~/store';

import { createCustomer } from './mutations';
import styles from './CreateCustomerModal.module.css';

export interface CreateCustomerModalProps {
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

export function CreateCustomerModal({ open = true, onClose }: CreateCustomerModalProps) {
  const engine = useEngine();
  const navigate = useNavigate();
  const viewerId = useViewerId();
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const ownerMenu = useMenuTrigger();

  const [name, setName] = useState('');
  const [domains, setDomains] = useState('');
  const [ownerId, setOwnerId] = useState<UUID | null>(viewerId);
  const [nameError, setNameError] = useState<string | null>(null);
  const { saving, error, submit, submitRef } = useDialogSubmit('Could not create the customer');

  // Seeded on the false→true edge of `open` rather than at mount. The shell keeps this
  // dialog mounted for its whole lifetime, so `viewerId` is usually still null the one time
  // a `useState` initialiser would run, and the pill would show "No owner" forever.
  const wasOpen = useRef(open);
  if (open !== wasOpen.current) {
    wasOpen.current = open;
    if (open) setOwnerId(viewerId);
  }

  const owner = useLiveQuery(
    (store) => (ownerId === null ? null : (store.users.get(ownerId) ?? null)),
    ['user'],
    [ownerId ?? ''],
  );

  const save = async () => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setNameError('A customer needs a name');
      nameRef.current?.focus();
      return;
    }
    await submit(async () => {
      const parsed = domains
        .split(/[\s,]+/)
        .map((item) => item.trim())
        .filter((item) => item !== '');
      const id = await createCustomer(engine, {
        name: trimmed,
        domains: parsed,
        ownerId: ownerId ?? undefined,
      });
      onClose();
      if (id !== '') void navigate(`/customer/${id}`);
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
            id: 'customer.create.submit',
            title: 'Create customer',
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
      title="New customer"
      size="md"
      initialFocus={nameRef}
      footer={
        <>
          {/* Ghost, not the default secondary — the same argument `SaveViewModal` makes: a
              footer says what Enter does with exactly one primary, and a bordered Cancel
              beside it is a second control making the same visual claim. */}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
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
        <div className={styles.pills}>
          <PropertyPill
            {...ownerMenu.props}
            name="Owner"
            describe={`${formId}-owner`}
            empty={owner === null ? 'No owner' : undefined}
            icon={
              owner === null ? null : (
                <Avatar
                  name={owner.displayName}
                  src={owner.avatarUrl ?? null}
                  size="xs"
                  colorKey={owner.id}
                  decorative
                />
              )
            }
          >
            {owner?.displayName ?? 'Owner'}
          </PropertyPill>
          <UserPicker
            open={ownerMenu.open}
            onClose={ownerMenu.hide}
            trigger={ownerMenu.ref}
            label="Owner"
            noneLabel="No owner"
            filterPlaceholder="Owned by…"
            value={ownerId}
            onSelect={setOwnerId}
          />
        </div>
        {error !== null && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
