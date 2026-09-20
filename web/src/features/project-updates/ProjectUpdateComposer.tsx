/**
 * Writing the next update, wherever a project's health is drawn.
 *
 * Health is the one property on a project row that is not a field on the project. It is the
 * newest update's word, so the affordance behind a health cell cannot be a picker: choosing
 * "At risk" with nothing said about it is how a feed fills with rows that carry a colour and
 * no reason. What the cell opens is the composer — the same one the overview has always had,
 * which is why the form lives here now and the overview renders it rather than keeping a
 * second copy free to drift.
 *
 * Two exports, because the two surfaces want different frames around the same form: the
 * overview has a column to put it in, and a list row has a button to hang it off.
 */

import { useState, type FormEvent, type RefObject } from 'react';

import { useEngine } from '~/app/context';
import { Button, Menu, Popover, Textarea, type MenuNode } from '~/components';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useViewerId } from '~/hooks/useViewer';
import type { ProjectUpdateHealth, UUID } from '~/store';
import { ApiError } from '~/sync/api';

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
  /** Called once the update is filed. The popover closes on it; the overview clears its box. */
  readonly onPosted: () => void;
  /** Focus the body on mount. True in the popover, where the click was the intent to write. */
  readonly autoFocus?: boolean | undefined;
}

export function ProjectUpdateForm({
  projectId,
  initialHealth = 'on_track',
  onPosted,
  autoFocus = false,
}: ProjectUpdateFormProps) {
  const engine = useEngine();
  const viewerId = useViewerId();
  const [health, setHealth] = useState<ProjectUpdateHealth>(initialHealth);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const healthMenu = useMenuTrigger();

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (posting || viewerId === null) return;
    // A blank post is a health change with nothing said about it, and the feed reads as a
    // row of empty entries. Refused here rather than at the API, so the answer is instant.
    const written = body.trim();
    if (written === '') {
      setPostError('An update needs something to say.');
      return;
    }
    setPosting(true);
    setPostError(null);
    try {
      await createProjectUpdate(engine, {
        projectId,
        health,
        body: written,
        authorId: viewerId,
      });
      setBody('');
      onPosted();
    } catch (failure) {
      // Without this the promise rejected into nothing: the form cleared its posting flag
      // in `finally` and looked exactly as it does after a successful post, so a refused
      // update — offline, a server that said no — read as one that had gone out.
      setPostError(failure instanceof ApiError ? failure.message : 'That update was not posted.');
    } finally {
      setPosting(false);
    }
  };

  const healthItems: MenuNode[] = HEALTHS.map((value) => ({
    id: value,
    label: PROJECT_UPDATE_HEALTH_LABEL[value],
    icon: <HealthGlyph health={value} />,
    selected: value === health,
    onSelect: () => setHealth(value),
  }));

  return (
    <form className={styles.composer} onSubmit={onSubmit}>
      <Textarea
        label="Update"
        hideLabel
        surface="plain"
        value={body}
        minRows={2}
        autoFocus={autoFocus}
        placeholder="What changed since the last update?"
        onChange={(event) => {
          setBody(event.target.value);
          if (postError !== null) setPostError(null);
        }}
      />
      {postError === null ? null : (
        <p className={styles.error} role="alert">
          {postError}
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
        <Button type="submit" variant="primary" disabled={posting || viewerId === null}>
          Post update
        </Button>
      </div>
    </form>
  );
}

export interface ProjectUpdateComposerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly trigger: RefObject<HTMLElement | null>;
  readonly projectId: UUID;
  readonly initialHealth?: ProjectUpdateHealth | undefined;
  /** The id this panel's Escape is registered under. Unique across everything mounted. */
  readonly actionId: string;
  readonly actionGroup?: string | undefined;
}

/**
 * The form on a string, for a surface whose health is one cell in a list.
 *
 * One composer per list rather than one per row, for `useMenuTrigger`'s reason: a row that
 * scrolls out of the overscan window unmounts, and a panel mounted inside it goes with it.
 */
export function ProjectUpdateComposer({
  open,
  onClose,
  trigger,
  projectId,
  initialHealth,
  actionId,
  actionGroup,
}: ProjectUpdateComposerProps) {
  return (
    <Popover
      open={open}
      onClose={onClose}
      trigger={trigger}
      label="Project update"
      actionId={actionId}
      actionTitle="Close the update composer"
      actionGroup={actionGroup}
      className={styles.panel}
    >
      {/* Keyed on the project so the box does not carry one row's half-written sentence
          over to the next row the reader clicks. */}
      <ProjectUpdateForm
        key={projectId}
        projectId={projectId}
        initialHealth={initialHealth}
        onPosted={onClose}
        autoFocus
      />
    </Popover>
  );
}
