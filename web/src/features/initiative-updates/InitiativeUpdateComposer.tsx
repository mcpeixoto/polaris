/**
 * Writing the next update, wherever an initiative's health is drawn.
 *
 * Health is the one thing on an initiative row that is not a field on the initiative. It is
 * the newest update's word, so the affordance behind a health cell cannot be a picker:
 * choosing "At risk" with nothing said about it is how a feed fills with rows that carry a
 * colour and no reason. What the cell opens is the composer — the same one the overview has
 * always had, which is why the form lives here now and `InitiativeDetail` renders it rather
 * than keeping a second copy free to drift.
 *
 * Two exports, because the two surfaces want different frames around the same form: the
 * overview has a card to put it in, and a list row has a button to hang it off. The project
 * side is the same arrangement, in `features/project-updates/ProjectUpdateComposer.tsx`;
 * the controls differ from it only where this form already differed — a `<select>` for the
 * health rather than a menu — and that is the overview's own shape, kept rather than
 * redesigned on the way out of the view.
 */

import { useState, type FormEvent, type RefObject } from 'react';

import { useEngine } from '~/app/context';
import { Button, Popover, Select, Textarea } from '~/components';
import { HealthDot } from '~/features/project-updates/ProjectHealthBadge';
import { useViewerId } from '~/hooks/useViewer';
import type { ProjectUpdateHealth, UUID } from '~/store';
import { ApiError } from '~/sync/api';

import { INITIATIVE_UPDATE_HEALTH_LABEL } from './helpers';
import { createInitiativeUpdate } from './mutations';
import styles from './InitiativeUpdateComposer.module.css';

/** The three healths, in the order they are read: best first. */
const HEALTHS: readonly ProjectUpdateHealth[] = ['on_track', 'at_risk', 'off_track'];

export interface InitiativeUpdateFormProps {
  readonly initiativeId: UUID;
  /** The health the form opens on: the initiative's current one, so posting again confirms it. */
  readonly initialHealth?: ProjectUpdateHealth | undefined;
  /** Called once the update is filed. The popover closes on it; the overview stays put. */
  readonly onPosted: () => void;
  /** Focus the body on mount. True in the popover, where the click was the intent to write. */
  readonly autoFocus?: boolean | undefined;
}

export function InitiativeUpdateForm({
  initiativeId,
  initialHealth = 'on_track',
  onPosted,
  autoFocus = false,
}: InitiativeUpdateFormProps) {
  const engine = useEngine();
  const viewerId = useViewerId();
  const [health, setHealth] = useState<ProjectUpdateHealth>(initialHealth);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

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
      await createInitiativeUpdate(engine, {
        initiativeId,
        health,
        body: written,
        authorId: viewerId,
      });
      setBody('');
      onPosted();
    } catch (failure) {
      setPostError(
        failure instanceof ApiError ? failure.message : 'That update could not be posted.',
      );
    } finally {
      setPosting(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <Select
        label="Health"
        value={health}
        prefix={<HealthDot health={health} />}
        onChange={(event) => setHealth(event.target.value as ProjectUpdateHealth)}
      >
        {HEALTHS.map((value) => (
          <option key={value} value={value}>
            {INITIATIVE_UPDATE_HEALTH_LABEL[value]}
          </option>
        ))}
      </Select>
      <Textarea
        label="Update"
        value={body}
        minRows={3}
        autoFocus={autoFocus}
        placeholder="What changed since the last update?"
        onChange={(event) => {
          setBody(event.target.value);
          if (postError !== null) setPostError(null);
        }}
      />
      {/* Fields, then the message, then the action — a refusal belongs beside the button
          that was refused, which is where the update editor already puts it. */}
      {postError === null ? null : (
        <p className={styles.error} role="alert">
          {postError}
        </p>
      )}
      <div className={styles.actions}>
        <Button type="submit" variant="primary" disabled={posting || viewerId === null}>
          Post update
        </Button>
      </div>
    </form>
  );
}

export interface InitiativeUpdateComposerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly trigger: RefObject<HTMLElement | null>;
  readonly initiativeId: UUID;
  readonly initialHealth?: ProjectUpdateHealth | undefined;
  /** The id this panel's Escape is registered under. Unique across everything mounted. */
  readonly actionId: string;
  readonly actionGroup?: string | undefined;
}

/**
 * The form on a string, for a surface whose health is one cell in a list.
 *
 * One composer per list rather than one per row, for `useMenuTrigger`'s reason: a row that
 * a fold or a filter takes away unmounts, and a panel mounted inside it goes with it.
 */
export function InitiativeUpdateComposer({
  open,
  onClose,
  trigger,
  initiativeId,
  initialHealth,
  actionId,
  actionGroup,
}: InitiativeUpdateComposerProps) {
  return (
    <Popover
      open={open}
      onClose={onClose}
      trigger={trigger}
      label="Initiative update"
      actionId={actionId}
      actionTitle="Close the update composer"
      actionGroup={actionGroup}
      className={styles.panel}
    >
      {/* Keyed on the initiative so the box does not carry one row's half-written sentence
          over to the next row the reader clicks. */}
      <InitiativeUpdateForm
        key={initiativeId}
        initiativeId={initiativeId}
        initialHealth={initialHealth}
        onPosted={onClose}
        autoFocus
      />
    </Popover>
  );
}
