/**
 * Peek, for the project under the cursor.
 *
 * The project list is a scan, and a scan's cost is that answering "what is this one?" meant
 * opening the project and coming back to a list that had lost its filters and its place.
 * Space answers it without leaving: the same panel the issue list has, the same key, the
 * same hold-to-glance, the same Escape.
 *
 * It is the project page squeezed to one column — the name where that page's title is, the
 * summary and description under it, then the rail of properties folded beneath rather than
 * beside. Same words for an unset value as the page uses, so what a person learns to read on
 * one surface reads on the other.
 *
 * The rail is editable, which is the other half of that bargain and was missing for longer
 * than the issue peek's was: a panel that answers "what is this one?" and then makes you
 * open the project to act on the answer has only moved the trip, not saved it. Every picker
 * here writes the peeked project and nothing else — the list's selection is not a target,
 * for the reason `Peek` states about its own rail: this panel draws one thing, and a write
 * that touched six while showing one would say so nowhere.
 */

import { useCallback, useRef } from 'react';

import { Avatar, DatePicker, EmptyState, PriorityIcon, priorityLabel, Tooltip } from '~/components';
import { useEngine } from '~/app/context';
import { projectProgress } from '~/features/initiatives/progress';
import { report } from '~/features/issue/mutations';
import { PriorityPicker } from '~/features/issue/pickers';
import { browserTimezone } from '~/features/locale';
import { UserPicker } from '~/features/members/UserPicker';
import { ProjectHealthCell } from '~/features/project-updates/ProjectHealthCell';
import { ProjectUpdateComposer } from '~/features/project-updates/ProjectUpdateComposer';
import { latestProjectUpdate } from '~/features/project-updates/helpers';
import { updateProject, type ProjectFields } from '~/features/projects/mutations';
import { ProjectStatusPicker } from '~/features/projects/ProjectStatusPicker';
import { formatTimeframe } from '~/features/projects/properties';
import { exact, when } from '~/features/time';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { usePresence } from '~/hooks/usePresence';
import type { DateOnly, ProjectUpdateHealth, Store, TimeframeGranularity, UUID } from '~/store';

import { Fact, glanceDescription, PeekHeader } from './parts';
import styles from './Peek.module.css';

export interface ProjectPeekProps {
  open: boolean;
  projectId: UUID | null;
  /** Shut the panel. The list owns the state, so it owns the close; this is the request. */
  onClose?: (() => void) | undefined;
}

export function ProjectPeek({ open, projectId, onClose }: ProjectPeekProps) {
  const panelRef = useRef<HTMLElement>(null);
  const { present, exitProps } = usePresence(open, panelRef);
  const engine = useEngine();

  const project = useLiveQuery(
    (store) => (!present || projectId === null ? null : readPeek(store, projectId)),
    ['project', 'projectStatus', 'user', 'issue', 'projectUpdate'],
    [present, projectId ?? ''],
  );

  /*
   * One trigger per property, the shape the issue peek's rail uses. They are not `roving`:
   * Peek is a panel rather than a `role="option"` list navigating by
   * `aria-activedescendant`, so these are ordinary focusable controls and `PropertyTrigger`'s
   * own note says to leave the tab order alone here.
   */
  const status = useMenuTrigger<HTMLButtonElement>();
  const priority = useMenuTrigger();
  const lead = useMenuTrigger();
  const target = useMenuTrigger('dialog');
  const health = useMenuTrigger('dialog');

  const write = useCallback(
    (fields: ProjectFields) => {
      if (projectId === null) return;
      updateProject(engine, projectId, fields).catch(report);
    },
    [engine, projectId],
  );

  if (!present) return null;

  if (projectId === null || project === null) {
    return (
      <aside ref={panelRef} className={styles.panel} aria-label="Peek" {...exitProps}>
        <EmptyState
          title={projectId === null ? 'Nothing under the cursor' : 'This project is not here yet'}
          description={
            projectId === null
              ? 'Move to a row, then press Space. Enter opens the project for real.'
              : 'It may still be arriving, or it belongs to a team you are not in.'
          }
        />
      </aside>
    );
  }

  return (
    <aside
      ref={panelRef}
      className={styles.panel}
      aria-label={`Peek ${project.name}`}
      {...exitProps}
    >
      {/* Status is the eyebrow rather than a rail row on this panel, so the control is the
          eyebrow too — a second Status row beneath would print the same word twice and leave
          a reader guessing which of them is the live one. The button is named by its value
          and described by the verb, which is the split `Fact` makes for every row below. */}
      <PeekHeader
        eyebrow={
          <Tooltip label="Change status">
            <button type="button" {...status.props} className={styles.statusTrigger}>
              {project.statusName}
            </button>
          </Tooltip>
        }
        onClose={onClose}
      />

      <h2 className={styles.title}>{project.name}</h2>

      <p className={styles.description}>
        {project.description === '' ? (
          <span className={styles.unset}>No description.</span>
        ) : (
          project.description
        )}
      </p>

      <h3 className={styles.railTitle}>Properties</h3>
      <dl className={styles.facts}>
        {/* Health is the one row here that is not a field on the project: it is the newest
            update's word. So this opens the composer rather than a picker — choosing "At
            risk" with nothing said about it is how a feed fills with rows that carry a
            colour and no reason. */}
        <Fact
          label="Health"
          action="Write an update"
          popup="dialog"
          open={health.open}
          onOpen={(element) => health.showFrom(element)}
        >
          <ProjectHealthCell store={engine.store} projectId={project.id} compact />
        </Fact>
        <Fact
          label="Priority"
          action="Set priority"
          open={priority.open}
          onOpen={(element) => priority.showFrom(element)}
        >
          <PriorityIcon priority={project.priority} decorative />
          {priorityLabel(project.priority)}
        </Fact>
        <Fact
          label="Lead"
          action="Set lead"
          open={lead.open}
          onOpen={(element) => lead.showFrom(element)}
        >
          {project.leadName === null ? (
            <span className={styles.unset}>No lead</span>
          ) : (
            <>
              <Avatar name={project.leadName} src={project.leadAvatar} size="xs" decorative />
              {project.leadName}
            </>
          )}
        </Fact>
        <Fact
          label="Target"
          action="Set target date"
          popup="dialog"
          open={target.open}
          onOpen={(element) => target.showFrom(element)}
        >
          {project.target ?? <span className={styles.unset}>No target date</span>}
        </Fact>
        {/* Progress is arithmetic over the project's issues, so it stays a fact: there is no
            list of values a picker could offer for it. */}
        <Fact label="Progress">
          {project.total === 0 ? (
            <span className={styles.unset}>No issues yet</span>
          ) : (
            `${project.percent}% · ${project.completed}/${project.total} issues`
          )}
        </Fact>
      </dl>

      <p className={styles.dates}>
        Created{' '}
        <time dateTime={project.createdAt} title={exact(project.createdAt)}>
          {when(project.createdAt)}
        </time>
        {' · '}
        Updated{' '}
        <time dateTime={project.updatedAt} title={exact(project.updatedAt)}>
          {when(project.updatedAt)}
        </time>
      </p>

      <p className={styles.hint}>Enter to open · Esc to close</p>

      <ProjectStatusPicker
        open={status.open}
        onClose={status.hide}
        trigger={status.ref}
        value={project.statusId}
        onSelect={(statusId) => write({ statusId })}
      />
      <PriorityPicker
        open={priority.open}
        onClose={priority.hide}
        trigger={priority.ref}
        value={project.priority}
        onSelect={(level) => write({ priority: level })}
      />
      <UserPicker
        open={lead.open}
        onClose={lead.hide}
        trigger={lead.ref}
        label="Lead"
        noneLabel="No lead"
        filterPlaceholder="Set the lead…"
        value={project.leadId}
        onSelect={(leadId) => write({ leadId })}
      />
      {/*
       * The two panels below are `Popover`s, and a Popover registers its Escape in the keymap
       * registry for as long as it is mounted — shut or not. Mounted by their triggers rather
       * than always, so a host that never opens one never needs a `KeymapProvider` and the
       * registry does not carry two disabled bindings for a panel nobody has asked for. The
       * cost is the fade on the way out, which a component cannot animate once it has left
       * the tree; the focus restore survives, because `Popover` captures its anchor while
       * open and returns focus from the cleanup that unmounting runs anyway.
       */}
      {!target.open ? null : (
        <DatePicker
          open
          onClose={target.hide}
          trigger={target.ref}
          value={project.targetDate}
          // The reader's zone rather than a team's: a project belongs to as many teams as it
          // likes, so there is no one team whose Friday this date is.
          timezone={browserTimezone()}
          actionId="projectPeek.closeTargetPicker"
          actionGroup="Projects"
          label="Target date"
          clearLabel="No target date"
          onSelect={(targetDate) =>
            write({ targetDate, targetDateGranularity: project.targetDateGranularity })
          }
        />
      )}
      {!health.open ? null : (
        <ProjectUpdateComposer
          open
          onClose={health.hide}
          trigger={health.ref}
          projectId={project.id}
          // The health the project already claims, so posting again confirms it rather than
          // quietly resetting a struggling project to "On track".
          initialHealth={project.health ?? undefined}
          actionId="projectPeek.closeUpdateComposer"
          actionGroup="Projects"
        />
      )}
    </aside>
  );
}

/**
 * What the panel draws — and, since the rail became editable, the ids behind it.
 *
 * A picker needs the id to tick the value that is already set: a status called "In progress"
 * is not something `ProjectStatusPicker` can find a row for, and a lead's display name is not
 * unique. So every property carries both halves, the string for the panel and the id for the
 * menu.
 */
interface PeekProject {
  readonly id: UUID;
  readonly name: string;
  readonly description: string;
  readonly statusId: UUID;
  readonly statusName: string;
  readonly priority: number;
  readonly leadId: UUID | null;
  readonly leadName: string | null;
  readonly leadAvatar: string | null;
  /** The stored day, for the picker; `target` is the same value in the project's grain. */
  readonly targetDate: DateOnly | null;
  readonly targetDateGranularity: TimeframeGranularity;
  readonly target: string | null;
  /** The newest update's word, which is what the composer opens on. */
  readonly health: ProjectUpdateHealth | null;
  readonly completed: number;
  readonly total: number;
  readonly percent: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function readPeek(store: Store, id: UUID): PeekProject | null {
  const found = store.projects.get(id);
  if (found === undefined) return null;
  const lead = found.leadId === undefined ? undefined : store.users.get(found.leadId);
  const progress = projectProgress(store, found.id);
  // The summary is the sentence somebody wrote to be read in a list, so it leads; the
  // description is the long form and is only reached for when there is no summary.
  const blurb =
    found.summary !== undefined && found.summary !== '' ? found.summary : found.description;

  return {
    id: found.id,
    name: found.name,
    description: glanceDescription(blurb),
    statusId: found.statusId,
    statusName: store.get('projectStatus', found.statusId)?.name ?? 'No status',
    priority: found.priority,
    leadId: found.leadId ?? null,
    leadName: lead?.displayName ?? null,
    leadAvatar: lead?.avatarUrl ?? null,
    targetDate: found.targetDate ?? null,
    targetDateGranularity: found.targetDateGranularity ?? 'day',
    target:
      found.targetDate === undefined
        ? null
        : formatTimeframe(found.targetDate, found.targetDateGranularity ?? 'day'),
    health: latestProjectUpdate(store, found.id)?.health ?? null,
    completed: progress.completed,
    total: progress.total,
    percent: progress.percent,
    createdAt: found.createdAt,
    updatedAt: found.updatedAt,
  };
}
