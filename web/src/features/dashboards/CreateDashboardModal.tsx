/**
 * Create a dashboard — name, and whether it is yours alone.
 *
 * The personal toggle is a `Switch` rather than a `Checkbox` because it does not describe a
 * value the form will collect and send along with the others: it changes what the thing
 * being made *is*, and which sidebar it will appear in. A tick box says "also this"; a
 * switch says "this one is private", which is the sentence the reader is actually composing.
 */

import { useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import { Button, ConfirmDialog, Input, Modal, Switch } from '~/components';
import { useDialogSubmit } from '~/hooks/useDialogSubmit';
import { useDiscardGuard } from '~/hooks/useDiscardGuard';
import { useViewerId } from '~/hooks/useViewer';

import { createDashboard } from './mutations';
import styles from './CreateDashboardModal.module.css';

export interface CreateDashboardModalProps {
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
  onClose(): void;
}

export function CreateDashboardModal({ open = true, onClose }: CreateDashboardModalProps) {
  const engine = useEngine();
  const navigate = useNavigate();
  const viewerId = useViewerId();
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [personal, setPersonal] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const { saving, error, submit, submitRef } = useDialogSubmit('Could not create the dashboard');

  /**
   * The name, and the switch once it has been moved off the default this dialog opened it
   * on. Both are things somebody decided; neither is this dialog's own suggestion. What
   * must not count is anything still sitting where it was put, because a question asked
   * over a dialog that was opened and immediately dismissed teaches people to dismiss it
   * without reading it — which is the same line `CreateTeamDialog` draws around its own
   * private toggle.
   */
  const dirty = name.trim() !== '' || personal;
  const { requestClose, confirming, keep, discard } = useDiscardGuard(dirty, onClose);

  const save = async () => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setNameError('A dashboard needs a name');
      nameRef.current?.focus();
      return;
    }
    await submit(async () => {
      const id = await createDashboard(engine, {
        name: trimmed,
        private: personal,
        ownerId: viewerId ?? undefined,
      });
      onClose();
      if (id !== '') void navigate(`/dashboard/${id}`);
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
            id: 'dashboard.create.submit',
            title: 'Create dashboard',
            keys: ['mod+Enter'],
            when: 'modal',
            group: 'Dashboards',
            hidden: true,
            run: () => submitRef.current(),
          },
        ]
      : [],
    [open],
  );

  return (
    <>
      <Modal
        open={open}
        onClose={requestClose}
        title="New dashboard"
        size="md"
        initialFocus={nameRef}
        footer={
          <>
            <Button variant="ghost" onClick={requestClose}>
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
          <Switch
            label="Personal — only visible to you"
            checked={personal}
            onChange={setPersonal}
          />
          {error !== null && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </form>
      </Modal>
      {confirming ? (
        <ConfirmDialog
          open
          title="Discard this dashboard?"
          consequence="The dashboard has not been created, and the name you typed is not saved anywhere else."
          confirmLabel="Discard"
          destructive
          onConfirm={discard}
          onClose={keep}
        />
      ) : null}
    </>
  );
}
