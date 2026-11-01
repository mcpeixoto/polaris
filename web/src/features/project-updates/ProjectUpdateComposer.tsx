/**
 * Writing the next update, wherever a project's health is drawn.
 *
 * Health is the one property on a project row that is not a field on the project. It is the
 * newest update's word, so the affordance behind a health cell cannot be a picker: choosing
 * "At risk" with nothing said about it is how a feed fills with rows that carry a colour and
 * no reason. What the cell opens is this dialog — the same one from the project list, the
 * peek, an initiative's project rows and the overview, so there is one place to write an
 * update and it has room to write in.
 */

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type Ref } from 'react';

import { useEngine } from '~/app/context';
import { useActions } from '~/app/keymap';
import { Button, ConfirmDialog, Menu, Modal, type MenuNode } from '~/components';
import { WritingField } from '~/editor/WritingField';
import { useDialogSubmit } from '~/hooks/useDialogSubmit';
import { useDiscardGuard } from '~/hooks/useDiscardGuard';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useViewerId } from '~/hooks/useViewer';
import type { ProjectUpdateHealth, UUID } from '~/store';

import { PROJECT_UPDATE_HEALTH_LABEL } from './helpers';
import { HealthDot } from './ProjectHealthBadge';
import { HealthGlyph } from './glyphs';
import { createProjectUpdate } from './mutations';
import styles from './ProjectUpdateComposer.module.css';

const HEALTHS: readonly ProjectUpdateHealth[] = ['on_track', 'at_risk', 'off_track'];

export interface ProjectUpdateFormProps {
  readonly projectId: UUID;
  /** The health the form opens on: the project's current one, so posting again confirms it. */
  readonly initialHealth?: ProjectUpdateHealth | undefined;
  /** Called once the update is filed. The dialog closes on it. */
  readonly onPosted: () => void;
  /** Told whether the form holds anything that closing it would lose. */
  readonly onDirtyChange?: ((dirty: boolean) => void) | undefined;
  readonly formRef?: Ref<HTMLFormElement> | undefined;
  readonly id?: string | undefined;
}

export function ProjectUpdateForm({
  projectId,
  initialHealth = 'on_track',
  onPosted,
  onDirtyChange,
  formRef,
  id,
}: ProjectUpdateFormProps) {
  const engine = useEngine();
  const viewerId = useViewerId();
  const [health, setHealth] = useState<ProjectUpdateHealth>(initialHealth);
  const [body, setBody] = useState('');
  const { saving, error, setError, submit, reset } = useDialogSubmit('That update was not posted.');
  const healthMenu = useMenuTrigger();

  // The health counts as well as the words. It opens on the project's current one, so a
  // change from that is a decision the writer made, and the only copy of it is here.
  const dirty = body.trim() !== '' || health !== initialHealth;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (viewerId === null) return;
    // A blank post is a health change with nothing said about it, and the feed reads as a
    // row of empty entries. Refused here rather than at the API, so the answer is instant.
    const written = body.trim();
    if (written === '') {
      setError('An update needs something to say.');
      return;
    }
    await submit(async () => {
      await createProjectUpdate(engine, {
        projectId,
        health,
        body: written,
        authorId: viewerId,
      });
      setBody('');
      setHealth(initialHealth);
      reset();
      onPosted();
    });
  };

  const healthItems: MenuNode[] = HEALTHS.map((value) => ({
    id: value,
    label: PROJECT_UPDATE_HEALTH_LABEL[value],
    icon: <HealthGlyph health={value} />,
    selected: value === health,
    onSelect: () => setHealth(value),
  }));

  return (
    <form ref={formRef} id={id} className={styles.composer} onSubmit={onSubmit}>
      <WritingField
        label="Update"
        hideLabel
        surface="plain"
        value={body}
        minRows={8}
        maxRows={20}
        placeholder="What changed since the last update?"
        onChange={(next) => {
          setBody(next);
          if (error !== null) setError(null);
        }}
      />
      {error === null ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.composerFoot}>
        <Button
          {...healthMenu.props}
          variant="secondary"
          aria-label="Health"
          icon={<HealthDot health={health} />}
        >
          {PROJECT_UPDATE_HEALTH_LABEL[health]}
        </Button>
        <Menu
          open={healthMenu.open}
          onClose={healthMenu.hide}
          trigger={healthMenu.ref}
          label="Health"
          items={healthItems}
        />
        <Button type="submit" variant="primary" loading={saving} disabled={viewerId === null}>
          Post update
        </Button>
      </div>
    </form>
  );
}

export interface ProjectUpdateComposerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly projectId: UUID;
  readonly initialHealth?: ProjectUpdateHealth | undefined;
}

/**
 * The form in its dialog.
 *
 * One composer per list rather than one per row, for `useMenuTrigger`'s reason: a row that
 * scrolls out of the overscan window unmounts, and a dialog mounted inside it goes with it.
 */
export function ProjectUpdateComposer({
  open,
  onClose,
  projectId,
  initialHealth,
}: ProjectUpdateComposerProps) {
  const formId = useId();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [dirty, setDirty] = useState(false);

  // The form unmounts with the dialog, so the flag has to be lowered here: nothing is left
  // to report the change, and the next open would ask about a draft that no longer exists.
  const close = useCallback(() => {
    setDirty(false);
    onClose();
  }, [onClose]);
  const { requestClose, confirming, keep, discard } = useDiscardGuard(dirty, close);

  // Registered only while the dialog is up: a shut dialog that still bound ⌘⏎ would collide
  // with the next one to claim it. Through the form so it takes the button's path, blank
  // check and double-submit guard included.
  useActions(
    open
      ? [
          {
            id: 'projectUpdate.post',
            title: 'Post update',
            keys: ['mod+Enter'],
            when: 'modal',
            group: 'Projects',
            hidden: true,
            run: () => formRef.current?.requestSubmit(),
          },
        ]
      : [],
    [open],
  );

  return (
    <>
      <Modal open={open} onClose={requestClose} title="Project update" size="lg">
        {/* Keyed on the project so the box does not carry one row's half-written sentence
            over to the next row the reader clicks. */}
        <ProjectUpdateForm
          key={projectId}
          id={formId}
          formRef={formRef}
          projectId={projectId}
          initialHealth={initialHealth}
          onPosted={close}
          onDirtyChange={setDirty}
        />
      </Modal>
      {confirming ? (
        <ConfirmDialog
          open
          title="Discard this update?"
          consequence="It has not been posted, and what you wrote here is not saved anywhere else."
          confirmLabel="Discard"
          destructive
          onConfirm={discard}
          onClose={keep}
        />
      ) : null}
    </>
  );
}
