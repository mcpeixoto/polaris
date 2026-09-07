/**
 * Peek: the issue under the cursor, without leaving the list.
 *
 * Space toggles it; holding Space is a glance that goes away on release. Enter is the
 * commitment — it opens the full issue. This panel must not steal the keyboard from the
 * list: `J`/`K` still move, and Peek follows.
 *
 * It is the issue screen squeezed to one column: the identifier and title where that
 * screen's header and title are, the description under them, and the properties rail
 * folded beneath the description rather than beside it. Same glyphs, same words for an
 * unset value, so what a person learns to read on one surface reads on the other.
 */

import { useRef } from 'react';
import { Link } from 'react-router';

import {
  Avatar,
  EmptyState,
  LabelChip,
  PriorityIcon,
  priorityLabel,
  StateIcon,
} from '~/components';
import { estimatesEnabled, issueEstimateLabel } from '~/features/estimate';
import {
  CalendarGlyph,
  CycleGlyph,
  EstimateGlyph,
  ProjectGlyph,
  SubIssueGlyph,
  TagGlyph,
  UnassignedGlyph,
} from '~/features/issue/glyphs';
import { labelViewPath, userViewPath } from '~/features/labels/labelView';
import { DueDateValue } from '~/features/issue/properties';
import { exact, when } from '~/features/time';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { usePresence } from '~/hooks/usePresence';
import type { DateOnly, DueDateSource, StateCategory, Store, UUID } from '~/store';
import { Fact, glanceDescription, PeekHeader } from './parts';
import styles from './Peek.module.css';

export { glanceDescription };

/**
 * The panel is now mounted by the list unconditionally and told whether it is open, rather
 * than being rendered into existence by a ternary. That is what lets it slide out instead of
 * blinking out: a component cannot animate its own removal from a tree it has already left.
 *
 * The cost is one live subscription that exists while the panel is shut. It is deliberately
 * a cheap one — the selector returns `null` on sight when the panel is not present, so a
 * closed Peek does no reading and re-renders on nothing.
 */
export interface PeekProps {
  open: boolean;
  issueId: UUID | null;
  /**
   * Shut the panel. Optional, and the button exists only when it is supplied.
   *
   * The panel used to have no exit but Escape and the line of text saying so, which is a
   * keyboard affordance offered to somebody who opened it from the command menu with a
   * pointer. The list owns the state, so it owns the close; this is the request.
   */
  onClose?: (() => void) | undefined;
}

export function Peek({ open, issueId, onClose }: PeekProps) {
  const panelRef = useRef<HTMLElement>(null);
  const { present, exitProps } = usePresence(open, panelRef);

  const issue = useLiveQuery(
    (store) => (!present || issueId === null ? null : readPeek(store, issueId)),
    ['issue', 'team', 'user', 'workflowState', 'label', 'issueLabel', 'cycle', 'project'],
    [present, issueId ?? ''],
  );

  if (!present) return null;

  if (issueId === null) {
    return (
      <aside ref={panelRef} className={styles.panel} aria-label="Peek" {...exitProps}>
        <EmptyState
          title="Nothing under the cursor"
          description="Move to a row, then press Space. Enter opens the issue for real."
        />
      </aside>
    );
  }

  if (issue === null) {
    return (
      <aside ref={panelRef} className={styles.panel} aria-label="Peek" {...exitProps}>
        <EmptyState
          title="This issue is not here yet"
          description="It may still be arriving, or it belongs to a team you are not in."
        />
      </aside>
    );
  }

  const glyph = { width: 14, height: 14 };

  return (
    <aside
      ref={panelRef}
      className={styles.panel}
      aria-label={`Peek ${issue.identifier}`}
      {...exitProps}
    >
      <PeekHeader eyebrow={issue.identifier} onClose={onClose} />

      <h2 className={styles.title}>{issue.title}</h2>

      <p className={styles.description}>
        {issue.description === '' ? (
          <span className={styles.unset}>No description.</span>
        ) : (
          issue.description
        )}
      </p>

      <h3 className={styles.railTitle}>Properties</h3>
      <dl className={styles.facts}>
        <Fact label="Status">
          <StateIcon category={issue.stateCategory} color={issue.stateColor} decorative />
          {issue.stateName}
        </Fact>
        <Fact label="Priority">
          <PriorityIcon priority={issue.priority} />
          {priorityLabel(issue.priority)}
        </Fact>
        <Fact label="Assignee">
          {issue.assigneeName === null || issue.assigneeId === null ? (
            <>
              <UnassignedGlyph {...glyph} className={styles.glyph} />
              <span className={styles.unset}>Unassigned</span>
            </>
          ) : (
            <Link className={styles.entityLink} to={userViewPath(issue.assigneeId)}>
              <Avatar name={issue.assigneeName} src={issue.assigneeAvatar} size="xs" decorative />
              {issue.assigneeName}
            </Link>
          )}
        </Fact>
        {issue.estimateLabel === null ? null : (
          <Fact label="Estimate">
            <EstimateGlyph {...glyph} className={styles.glyph} />
            {issue.estimateLabel}
          </Fact>
        )}
        <Fact label="Due date">
          <CalendarGlyph {...glyph} className={styles.glyph} />
          <DueDateValue
            value={issue.dueDate}
            timezone={issue.timezone}
            source={issue.dueDateSource}
            className={issue.dueDate === null ? styles.unset : undefined}
          />
        </Fact>
        <Fact label="Cycle">
          <CycleGlyph {...glyph} className={styles.glyph} />
          {issue.cycleName ?? <span className={styles.unset}>No cycle</span>}
        </Fact>
        <Fact label="Project">
          <ProjectGlyph {...glyph} className={styles.glyph} />
          {issue.projectName ?? <span className={styles.unset}>No project</span>}
        </Fact>
        {issue.parent === null ? null : (
          <Fact label="Parent">
            <SubIssueGlyph {...glyph} className={styles.glyph} />
            <span className={styles.parentId}>{issue.parent.identifier}</span>
            <span className={styles.parentTitle}>{issue.parent.title}</span>
          </Fact>
        )}
        <Fact label="Labels" wrap>
          {issue.labels.length === 0 ? (
            <>
              <TagGlyph {...glyph} className={styles.glyph} />
              <span className={styles.unset}>No labels</span>
            </>
          ) : (
            issue.labels.map((label) => (
              <Link key={label.id} className={styles.entityLink} to={labelViewPath(label.id)}>
                <LabelChip compact name={label.name} color={label.color} />
              </Link>
            ))
          )}
        </Fact>
      </dl>

      <p className={styles.dates}>
        Created{' '}
        <time dateTime={issue.createdAt} title={exact(issue.createdAt)}>
          {when(issue.createdAt)}
        </time>
        {' · '}
        Updated{' '}
        <time dateTime={issue.updatedAt} title={exact(issue.updatedAt)}>
          {when(issue.updatedAt)}
        </time>
      </p>

      <p className={styles.hint}>Enter to open · Esc to close</p>
    </aside>
  );
}

interface PeekIssue {
  readonly identifier: string;
  readonly title: string;
  readonly description: string;
  readonly stateName: string;
  readonly stateCategory: StateCategory;
  readonly stateColor: string | undefined;
  readonly priority: number;
  readonly assigneeId: UUID | null;
  readonly assigneeName: string | null;
  readonly assigneeAvatar: string | null;
  readonly cycleName: string | null;
  readonly projectName: string | null;
  readonly parent: { identifier: string; title: string } | null;
  readonly estimateLabel: string | null;
  readonly dueDate: DateOnly | null;
  readonly dueDateSource: DueDateSource;
  readonly timezone: string;
  readonly labels: readonly { id: UUID; name: string; color: string }[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

function readPeek(store: Store, id: UUID): PeekIssue | null {
  const found = store.issues.get(id);
  if (found === undefined) return null;
  const state = store.workflowStates.get(found.stateId);
  const assignee = found.assigneeId === undefined ? undefined : store.users.get(found.assigneeId);
  const team = store.teams.get(found.teamId);
  const parent = found.parentId === undefined ? undefined : store.issues.get(found.parentId);
  const labels: { id: UUID; name: string; color: string }[] = [];
  for (const labelId of store.labelIdsFor(found.id)) {
    const label = store.labels.get(labelId);
    if (label === undefined || label.archivedAt !== undefined || label.isGroup) continue;
    labels.push({ id: label.id, name: label.name, color: label.color });
  }
  labels.sort((a, b) => a.name.localeCompare(b.name));

  return {
    identifier: store.identifierOf(found),
    title: found.title,
    description: glanceDescription(found.description),
    stateName: state?.name ?? 'No status',
    stateCategory: state?.category ?? 'backlog',
    stateColor: state?.color,
    priority: found.priority,
    assigneeId: found.assigneeId ?? null,
    assigneeName: assignee?.displayName ?? null,
    assigneeAvatar: assignee?.avatarUrl ?? null,
    cycleName: found.cycleId === undefined ? null : (store.cycles.get(found.cycleId)?.name ?? null),
    projectName:
      found.projectId === undefined ? null : (store.projects.get(found.projectId)?.name ?? null),
    parent:
      parent === undefined ? null : { identifier: store.identifierOf(parent), title: parent.title },
    estimateLabel:
      team !== undefined && estimatesEnabled(team)
        ? issueEstimateLabel(found.estimate, team)
        : null,
    dueDate: found.dueDate ?? null,
    dueDateSource: found.dueDateSource,
    timezone: team?.timezone ?? 'UTC',
    labels,
    createdAt: found.createdAt,
    updatedAt: found.updatedAt,
  };
}
