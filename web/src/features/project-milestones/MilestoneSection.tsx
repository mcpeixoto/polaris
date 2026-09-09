/**
 * The project's milestones, under the description, where the product says they belong.
 *
 * `projectMilestone` has been a first-class row in the replica and a tick on the timeline
 * since before this existed, and nothing in the client could create one — so every project
 * had an empty milestone axis and no way to fill it. This is the missing half: list, add,
 * rename, retarget, remove.
 *
 * The panel is a `Section`, so it folds like every other panel on a detail screen and adds
 * from the "+" on its header rather than from a form standing permanently open at the
 * bottom of the list. A form that is always there reads as something waiting to be filled
 * in, on a list most projects finish with four rows in.
 *
 * Each row states its own progress in words as well as in the ring, because a ring is a
 * length and a length is not a number anybody can read back to a colleague. Removing one
 * asks first: a milestone carries the issues pinned to it, and until this it was the one
 * destructive act in the product that happened on a single click with no undo behind it.
 *
 * The row's commands are built once, in `itemsFor`, and handed to both the ⋯ button and the
 * right-click menu — two arrays would be two menus that drift apart the first time one of
 * them gains a row. Order is a milestone's whole meaning on a timeline, so the menu carries
 * Move up / Move down: `moveProjectMilestone` already speaks the server's
 * `afterMilestoneId`/`moveToTop`, and dragging a four-row list is a gesture nobody asked for.
 */

import { useRef, useState, type FormEvent } from 'react';

import { useEngine } from '~/app/context';
import {
  Button,
  ConfirmDialog,
  DatePicker,
  IconButton,
  Input,
  Menu,
  Progress,
  Section,
  type MenuNode,
} from '~/components';
import { browserTimezone } from '~/features/locale';
import { whenDay } from '~/features/time';
import { entityRowMenuItems } from '~/features/entity/entityRowMenu';
import { useContextMenu } from '~/hooks/useContextMenu';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { UUID } from '~/store';
import { ApiError } from '~/sync/api';

import {
  ChevronGlyph,
  DotsGlyph,
  PencilGlyph,
  PlusGlyph,
  TrashGlyph,
} from '~/features/issue/glyphs';
import { MilestoneGlyph } from '~/features/projects/glyphs';

import { listProjectMilestones, type MilestoneRow } from './helpers';
import {
  createProjectMilestone,
  deleteProjectMilestone,
  moveProjectMilestone,
  updateProjectMilestone,
} from './mutations';
import styles from './MilestoneSection.module.css';

interface MilestoneSectionProps {
  readonly projectId: UUID;
}

export function MilestoneSection({ projectId }: MilestoneSectionProps) {
  const engine = useEngine();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [targetDate, setTargetDate] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<UUID | null>(null);
  const [removing, setRemoving] = useState<MilestoneRow | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const addDate = useMenuTrigger<HTMLButtonElement>('dialog');
  const nameRef = useRef<HTMLInputElement>(null);
  // Where the keyboard goes when the right-click menu closes: the row it was opened on.
  // There is no scroller here to hand it back to — this is a panel, not a list screen.
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const contextMenu = useContextMenu<UUID>({ returnFocusTo });

  const rows = useLiveQuery(
    (store) => listProjectMilestones(store, projectId),
    ['projectMilestone', 'issue', 'workflowState'],
    [projectId],
  );

  const openAdd = () => {
    setError(null);
    setAdding(true);
    // The "+" is the whole affordance, so the caret lands where the next word goes rather
    // than leaving a form open that somebody still has to click into.
    globalThis.requestAnimationFrame(() => nameRef.current?.focus());
  };

  const onAdd = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const trimmed = name.trim();
    if (trimmed === '') {
      setError('A milestone needs a name.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createProjectMilestone(engine, {
        projectId,
        name: trimmed,
        ...(targetDate === null ? null : { targetDate }),
      });
      setName('');
      setTargetDate(null);
      setAdding(false);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'That milestone was not created.');
    } finally {
      setSaving(false);
    }
  };

  /**
   * One step up or down the list, spelled as the API spells it: land after the row above
   * the one above, or after the row below. Stepping to the front has no predecessor to name,
   * which is exactly what `moveToTop` — `afterId` of null — is for.
   */
  const move = (row: MilestoneRow, delta: -1 | 1) => {
    const index = rows.findIndex((candidate) => candidate.milestone.id === row.milestone.id);
    if (index === -1) return;
    const anchorAt = delta === -1 ? index - 2 : index + 1;
    if (delta === -1 ? index === 0 : index === rows.length - 1) return;
    const afterId = anchorAt < 0 ? null : (rows[anchorAt]?.milestone.id ?? null);
    setMoveError(null);
    moveProjectMilestone(engine, row.milestone.id, afterId).catch((failure: unknown) => {
      setMoveError(failure instanceof ApiError ? failure.message : 'That milestone was not moved.');
    });
  };

  /**
   * The row's commands, built once for the ⋯ button and the right-click menu alike.
   *
   * `entityRowMenuItems` draws the destructive tail — the separator and the danger row — so
   * removing a milestone sits where removing a document or a project sits. The three rows
   * above it are this surface's own; nothing else in the product reorders by menu.
   */
  const itemsFor = (row: MilestoneRow): MenuNode[] => {
    const index = rows.findIndex((candidate) => candidate.milestone.id === row.milestone.id);
    return entityRowMenuItems(
      { noun: 'milestone', name: row.milestone.name },
      {
        properties: [
          {
            id: 'edit',
            label: 'Edit milestone',
            icon: <PencilGlyph />,
            onSelect: () => {
              contextMenu.close();
              setEditing(row.milestone.id);
            },
          },
          {
            id: 'move-up',
            label: 'Move up',
            icon: <ChevronGlyph className={styles.moveUp} />,
            disabled: index <= 0,
            onSelect: () => {
              contextMenu.close();
              move(row, -1);
            },
          },
          {
            id: 'move-down',
            label: 'Move down',
            icon: <ChevronGlyph className={styles.moveDown} />,
            disabled: index === -1 || index === rows.length - 1,
            onSelect: () => {
              contextMenu.close();
              move(row, 1);
            },
          },
        ],
        askDelete: () => {
          contextMenu.close();
          setRemoveError(null);
          setRemoving(row);
        },
        deleteLabel: 'Remove milestone',
        deleteIcon: <TrashGlyph />,
      },
    );
  };

  const contextRow = rows.find((row) => row.milestone.id === contextMenu.id) ?? null;

  const confirmRemove = () => {
    if (removing === null) return;
    const { id } = removing.milestone;
    if (editing === id) setEditing(null);
    setRemoving(null);
    deleteProjectMilestone(engine, id).catch((failure: unknown) => {
      setRemoveError(
        failure instanceof ApiError ? failure.message : 'That milestone was not removed.',
      );
    });
  };

  return (
    <Section
      title="Milestones"
      headingId={`milestones-${projectId}`}
      count={rows.length === 0 ? undefined : rows.length}
      className={styles.section}
      action={
        <IconButton
          size="sm"
          icon={<PlusGlyph />}
          aria-label="New milestone"
          tooltip="New milestone"
          onClick={openAdd}
        />
      }
    >
      {rows.length === 0 && !adding ? (
        <p className={styles.empty}>No milestones yet. The first one is the next checkpoint.</p>
      ) : null}
      {rows.length === 0 ? null : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li
              key={row.milestone.id}
              className={styles.row}
              // Focusable only to be focused: the menu hands the keyboard back here, and
              // Shift+F10 needs somewhere on the row for the browser to aim its event.
              tabIndex={-1}
              onContextMenu={(event) => {
                // The edit form has fields of its own, whose native menu is the right one.
                if (editing === row.milestone.id) return;
                returnFocusTo.current = event.currentTarget;
                contextMenu.openFromEvent(event, row.milestone.id);
              }}
            >
              {editing === row.milestone.id ? (
                <MilestoneEdit row={row} onDone={() => setEditing(null)} />
              ) : (
                <MilestoneReadout row={row} items={itemsFor(row)} />
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <form className={styles.add} onSubmit={onAdd}>
          <Input
            ref={nameRef}
            label="Milestone"
            className={styles.addName}
            value={name}
            placeholder="What is the next checkpoint?"
            autoComplete="off"
            onChange={(event) => {
              setName(event.target.value);
              if (error !== null) setError(null);
            }}
          />
          <Button {...addDate.props} variant="secondary">
            {targetDate === null ? 'Target date' : whenDay(targetDate)}
          </Button>
          <DatePicker
            open={addDate.open}
            onClose={addDate.hide}
            trigger={addDate.ref}
            value={targetDate}
            timezone={browserTimezone()}
            actionId="milestone.closeAddPicker"
            actionGroup="Projects"
            label="Target date"
            clearLabel="No target date"
            onSelect={setTargetDate}
          />
          <Button type="submit" variant="secondary" disabled={saving}>
            Add milestone
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={() => {
              setAdding(false);
              setError(null);
            }}
          >
            Cancel
          </Button>
        </form>
      )}
      {error === null ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {removeError === null ? null : (
        <p className={styles.error} role="alert">
          {removeError}
        </p>
      )}
      {moveError === null ? null : (
        <p className={styles.error} role="alert">
          {moveError}
        </p>
      )}

      {contextMenu.at === null ? null : <div {...contextMenu.anchorProps} />}
      <Menu
        open={contextMenu.at !== null && contextRow !== null}
        onClose={contextMenu.close}
        trigger={contextMenu.anchorRef}
        label={
          contextRow === null ? 'Milestone actions' : `Actions for ${contextRow.milestone.name}`
        }
        keysPresentation="kbd"
        density="compact"
        items={contextRow === null ? [] : itemsFor(contextRow)}
      />

      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.milestone.name ?? 'this milestone'}?`}
        consequence={`The checkpoint leaves the project and its timeline. Issues pinned to it keep their history and stop belonging to a milestone.`}
        confirmLabel="Remove milestone"
        destructive
        onConfirm={confirmRemove}
        onClose={() => setRemoving(null)}
      />
    </Section>
  );
}

interface ReadoutProps {
  readonly row: MilestoneRow;
  /** Built by the section, so the ⋯ and the right-click cannot come to disagree. */
  readonly items: readonly MenuNode[];
}

function MilestoneReadout({ row, items }: ReadoutProps) {
  const menu = useMenuTrigger();
  const { milestone, percent, total } = row;

  const progress = total === 0 ? 'No issues yet' : `${percent}% · ${row.done} of ${total} issues`;

  return (
    <>
      <div className={styles.head}>
        <span
          className={
            row.current ? `${styles.glyph ?? ''} ${styles.glyphCurrent ?? ''}` : styles.glyph
          }
        >
          <MilestoneGlyph />
        </span>
        <span className={styles.name}>{milestone.name}</span>
        {/* The current focus says so in a word. The ring's colour carries the same fact and
            is not allowed to be the only thing that carries it. */}
        {row.current && <span className={styles.current}>Current</span>}
        <span className={styles.when}>
          {milestone.targetDate === undefined ? 'No target date' : whenDay(milestone.targetDate)}
        </span>
        <Progress percent={percent} label={milestone.name} detail={progress} size="sm" />
        {/* One menu rather than two standing buttons: a list of checkpoints is read far more
            often than it is edited, and "Edit  Remove" on every row is a row of commands
            with the content squeezed between them. */}
        <IconButton
          {...menu.props}
          size="sm"
          icon={<DotsGlyph />}
          aria-label={`Actions for ${milestone.name}`}
        />
        <Menu
          open={menu.open}
          onClose={menu.hide}
          trigger={menu.ref}
          label={`Actions for ${milestone.name}`}
          placement="bottom-end"
          keysPresentation="kbd"
          density="compact"
          items={items}
        />
      </div>
      <span className={styles.progressText}>{progress}</span>
    </>
  );
}

interface EditProps {
  readonly row: MilestoneRow;
  readonly onDone: () => void;
}

function MilestoneEdit({ row, onDone }: EditProps) {
  const engine = useEngine();
  const [name, setName] = useState(row.milestone.name);
  const [targetDate, setTargetDate] = useState<string | null>(row.milestone.targetDate ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const date = useMenuTrigger<HTMLButtonElement>('dialog');

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const trimmed = name.trim();
    if (trimmed === '') {
      setError('A milestone needs a name.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateProjectMilestone(engine, row.milestone.id, {
        name: trimmed,
        // An emptied date field is a request to take the date off, which the API spells as
        // its own flag — see `ProjectMilestoneFields`.
        targetDate,
      });
      onDone();
    } catch (failure) {
      setSaving(false);
      setError(failure instanceof ApiError ? failure.message : 'That change was not saved.');
    }
  };

  return (
    <form className={styles.edit} onSubmit={onSubmit}>
      <Input
        label="Name"
        className={styles.addName}
        value={name}
        autoComplete="off"
        onChange={(event) => setName(event.target.value)}
      />
      <Button {...date.props} variant="secondary">
        {targetDate === null ? 'Target date' : whenDay(targetDate)}
      </Button>
      <DatePicker
        open={date.open}
        onClose={date.hide}
        trigger={date.ref}
        value={targetDate}
        timezone={browserTimezone()}
        actionId="milestone.closeEditPicker"
        actionGroup="Projects"
        label="Target date"
        clearLabel="No target date"
        onSelect={setTargetDate}
      />
      <div className={styles.editActions}>
        <Button type="submit" variant="primary" size="sm" disabled={saving}>
          Save milestone
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
      </div>
      {error === null ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
