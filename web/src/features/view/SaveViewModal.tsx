/**
 * Name a filter and choose where it lives — the workspace, a team's sidebar, or a project's
 * tab row.
 *
 * Sharing can be flipped later from the saved view itself — this dialog is the first
 * decision, not a trap. A member saving from My Issues defaults to private because a
 * workspace-wide shared view is an admin action, and failing the save after they typed a
 * name is worse than offering the switch already on.
 *
 * Two things it did not used to do.
 *
 * It shows the filter. `filter` and `display` arrived as props and were never rendered, so
 * the dialog asked somebody to name a thing it declined to show them — and the answer to
 * "which filter was this again?" was to cancel, look at the bar, and start over. The chips
 * are the bar's own, read-only (`FilterSummary`).
 *
 * And it is the only "new view" dialog. The project tab row had a second, near-identical
 * one of its own with no keymap registration and a disabled primary in place of a
 * validation message. `projectId` folds it in: the same dialog, worded as the tab row words
 * it, because `attached-views.spec.ts` drives it by those names and — more to the point —
 * because a view attached to a project genuinely is being created rather than saved.
 */

import { useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import { Button, Input, Modal, Switch } from '~/components';
import type { DisplayOptions, FilterNode } from '~/filter';
import { useDialogSubmit } from '~/hooks/useDialogSubmit';
import { useViewer, useViewerId } from '~/hooks/useViewer';
import type { UUID } from '~/store';

import { createView } from './mutations';
import { FilterSummary } from './ui/FilterBar';
import styles from './SaveViewModal.module.css';

export interface SaveViewModalProps {
  /** Whether the dialog is up. Absent means it is, which is how the issue list mounts it. */
  open?: boolean | undefined;
  filter: FilterNode;
  display: DisplayOptions;
  /** Anchors a shared view to one team's sidebar. Absent makes it workspace-wide. */
  teamId?: UUID | undefined;
  /**
   * Attaches the view to a project as a tab. It changes the wording — a tab is created
   * rather than saved — and takes the private switch away, because a tab everyone on the
   * project can see is the only kind there is.
   */
  projectId?: UUID | undefined;
  /** The zone the filter's dates read in. The owning team's, never the reader's. */
  timezone?: string | undefined;
  /**
   * Where to go once the view exists. The default is the workspace view route; the project
   * tab row has a base path of its own and passes this instead.
   */
  onCreated?: ((viewId: UUID) => void) | undefined;
  onClose(): void;
}

export function SaveViewModal({
  open = true,
  filter,
  display,
  teamId,
  projectId,
  timezone,
  onCreated,
  onClose,
}: SaveViewModalProps) {
  const engine = useEngine();
  const navigate = useNavigate();
  const viewerId = useViewerId();
  const viewer = useViewer();
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);

  const attached = projectId !== undefined;
  const admin = viewer?.role === 'admin' || viewer?.role === 'owner';
  const [name, setName] = useState('');
  const [personal, setPersonal] = useState(teamId === undefined && !admin);
  const [nameError, setNameError] = useState<string | null>(null);
  const { saving, error, submit, submitRef } = useDialogSubmit(
    attached ? 'That view could not be created.' : 'Could not save the view',
  );

  const save = async () => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setNameError('A view needs a name');
      nameRef.current?.focus();
      return;
    }
    await submit(async () => {
      const id = await createView(engine, {
        name: trimmed,
        filter,
        display,
        teamId,
        projectId,
        // An attached tab is the project's, not one person's: there is no switch offering
        // otherwise, so there is nothing to read here either.
        private: attached ? false : personal,
        ownerId: viewerId ?? undefined,
      });
      onClose();
      if (id === '') return;
      if (onCreated !== undefined) {
        onCreated(id);
        return;
      }
      void navigate(`/view/${id}`);
    });
  };

  // Reassigned every render, read at dispatch: the registry keeps the action object it was
  // handed at mount, so a `run` closing over this render's `save` would go on saving the
  // filter as it stood when the dialog opened.
  submitRef.current = () => void save();

  useKeyContext('modal', open);
  useActions(
    open
      ? [
          {
            id: 'view.save.submit',
            title: attached ? 'Create view' : 'Save view',
            keys: ['mod+Enter'],
            when: 'modal',
            group: 'Views',
            hidden: true,
            run: () => submitRef.current(),
          },
        ]
      : [],
    [open, attached],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={attached ? 'New view' : 'Save view'}
      description={
        attached
          ? "A saved filter of this project's issues, shown as a tab."
          : "A named filter. Shared views appear in everyone's sidebar; private ones stay yours."
      }
      size="md"
      initialFocus={nameRef}
      footer={
        <>
          {/* Ghost, not the default secondary. A footer says what Enter does with exactly one
              primary; a bordered Cancel beside it is a second control making the same visual
              claim, and the only one of the two that throws the form away. */}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button form={formId} type="submit" variant="primary" loading={saving}>
            {attached ? 'Create view' : 'Save view'}
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
          placeholder={attached ? 'View name' : 'My bugs'}
        />

        {/* What is actually being saved. An attached tab starts from the whole project and
            has nothing to show yet, so the summary is for the case that has one. */}
        {attached ? null : (
          <div className={styles.saving}>
            <h3 className={styles.savingHeading}>What this view will show</h3>
            <FilterSummary
              filter={filter}
              timezone={timezone}
              label="Filter being saved"
              emptyLabel="No filters — every issue in this list"
            />
          </div>
        )}

        {attached ? null : (
          <Switch label="Only visible to me" checked={personal} onChange={setPersonal} />
        )}
        {error !== null && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
