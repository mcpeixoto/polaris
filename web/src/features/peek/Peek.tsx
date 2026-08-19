/**
 * Peek: the issue under the cursor, without leaving the list.
 *
 * Space toggles it; holding Space is a glance that goes away on release. Enter is the
 * commitment — it opens the full issue. This panel must not steal the keyboard from the
 * list: `J`/`K` still move, and Peek follows.
 */

import { type ReactNode } from 'react';

import { Avatar, EmptyState, LabelChip, PriorityIcon, priorityLabel, StateIcon } from '~/components';
import { estimatesEnabled, issueEstimateLabel } from '~/features/estimate';
import { exact, when } from '~/features/time';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { StateCategory, Store, UUID } from '~/store';
import styles from './Peek.module.css';

export function Peek({ issueId }: { issueId: UUID | null }) {
  const issue = useLiveQuery(
    (store) => (issueId === null ? null : readPeek(store, issueId)),
    ['issue', 'team', 'user', 'workflowState', 'label', 'issueLabel', 'cycle', 'project'],
    [issueId ?? ''],
  );

  if (issueId === null) {
    return (
      <aside className={styles.panel} aria-label="Peek">
        <EmptyState
          title="Nothing under the cursor"
          description="Move to a row, then press Space. Enter opens the issue for real."
        />
      </aside>
    );
  }

  if (issue === null) {
    return (
      <aside className={styles.panel} aria-label="Peek">
        <EmptyState
          title="This issue is not here yet"
          description="It may still be arriving, or it belongs to a team you are not in."
        />
      </aside>
    );
  }

  return (
    <aside className={styles.panel} aria-label={`Peek ${issue.identifier}`}>
      <header className={styles.header}>
        <span className={styles.identifier}>{issue.identifier}</span>
        <h2 className={styles.title}>{issue.title}</h2>
      </header>

      <p className={styles.description}>
        {issue.description === '' ? 'No description.' : issue.description}
      </p>

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
          {issue.assigneeName === null ? (
            'No assignee'
          ) : (
            <>
              <Avatar name={issue.assigneeName} src={issue.assigneeAvatar} size="xs" />
              {issue.assigneeName}
            </>
          )}
        </Fact>
        {issue.cycleName === null ? null : <Fact label="Cycle">{issue.cycleName}</Fact>}
        {issue.projectName === null ? null : <Fact label="Project">{issue.projectName}</Fact>}
        {issue.estimateLabel === null ? null : <Fact label="Estimate">{issue.estimateLabel}</Fact>}
      </dl>

      {issue.labels.length > 0 && (
        <div className={styles.labels}>
          {issue.labels.map((label) => (
            <LabelChip key={label.id} compact name={label.name} color={label.color} />
          ))}
        </div>
      )}

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

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
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
  readonly assigneeName: string | null;
  readonly assigneeAvatar: string | null;
  readonly cycleName: string | null;
  readonly projectName: string | null;
  readonly estimateLabel: string | null;
  readonly labels: readonly { id: UUID; name: string; color: string }[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

function readPeek(store: Store, id: UUID): PeekIssue | null {
  const found = store.issues.get(id);
  if (found === undefined) return null;
  const state = store.workflowStates.get(found.stateId);
  const assignee =
    found.assigneeId === undefined ? undefined : store.users.get(found.assigneeId);
  const team = store.teams.get(found.teamId);
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
    description: found.description,
    stateName: state?.name ?? 'No status',
    stateCategory: state?.category ?? 'backlog',
    stateColor: state?.color,
    priority: found.priority,
    assigneeName: assignee?.displayName ?? null,
    assigneeAvatar: assignee?.avatarUrl ?? null,
    cycleName:
      found.cycleId === undefined ? null : (store.cycles.get(found.cycleId)?.name ?? null),
    projectName:
      found.projectId === undefined ? null : (store.projects.get(found.projectId)?.name ?? null),
    estimateLabel:
      team !== undefined && estimatesEnabled(team) ? issueEstimateLabel(found.estimate, team) : null,
    labels,
    createdAt: found.createdAt,
    updatedAt: found.updatedAt,
  };
}
