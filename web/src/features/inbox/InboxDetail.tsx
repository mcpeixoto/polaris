/**
 * The right-hand pane of the inbox: the issue the cursor row is about.
 *
 * A preview, not the issue page. The full page has the activity feed, the comment box and
 * every relation; this has the title, the description and the properties — enough to decide
 * whether the notification needs anything, which is the question an inbox is being read to
 * answer. "Open issue" is the commitment, and it is the same command Enter runs on the row.
 *
 * Reads the replica by id, like Peek does, so a title edited in another tab is current here
 * too. The selector returns `null` on sight when nothing is selected, so an idle pane does
 * no reading.
 */

import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';

import {
  Avatar,
  Button,
  EmptyState,
  Kbd,
  LabelChip,
  PriorityIcon,
  priorityLabel,
  StateIcon,
} from '~/components';
import { Markdown } from '~/features/markdown/Markdown';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { StateCategory, Store, UUID } from '~/store';
import styles from './InboxDetail.module.css';

export interface InboxDetailProps {
  /** The issue to show, or nothing — in which case the pane says how much is unread. */
  issueId: UUID | null;
  unread: number;
}

export function InboxDetail({ issueId, unread }: InboxDetailProps) {
  const navigate = useNavigate();
  const issue = useLiveQuery(
    (store) => (issueId === null ? null : readDetail(store, issueId)),
    ['issue', 'team', 'user', 'workflowState', 'label', 'issueLabel', 'project'],
    [issueId ?? ''],
  );

  if (issueId === null) return <EmptyPane unread={unread} />;

  if (issue === null) {
    return (
      <div className={styles.pane}>
        <EmptyState
          title="This issue is not here yet"
          description="It may still be arriving, or it belongs to a team you are not in."
        />
      </div>
    );
  }

  const href = `/issue/${issue.identifier}`;

  return (
    <article className={styles.pane} aria-label={issue.identifier}>
      <header className={styles.header}>
        <span className={styles.crumbIdentifier}>{issue.identifier}</span>
        <span className={styles.crumbTitle}>{issue.title}</span>
        <Button size="sm" variant="secondary" onClick={() => void navigate(href)}>
          Open issue
          <Kbd keys="Enter" surface="raised" />
        </Button>
      </header>

      <div className={styles.body}>
        <div className={styles.content}>
          <h2 className={styles.title}>{issue.title}</h2>
          {issue.description.trim() === '' ? (
            <p className={styles.noDescription}>No description</p>
          ) : (
            <Markdown source={issue.description} className={styles.description} />
          )}
        </div>

        <aside className={styles.rail} aria-label="Properties">
          <h3 className={styles.railHeading}>Properties</h3>
          <dl className={styles.properties}>
            <Property label="Status">
              <StateIcon category={issue.stateCategory} color={issue.stateColor} decorative />
              {issue.stateName}
            </Property>
            <Property label="Priority">
              <PriorityIcon priority={issue.priority} decorative />
              {priorityLabel(issue.priority)}
            </Property>
            <Property label="Assignee">
              {issue.assigneeName === null ? (
                <span className={styles.unset}>No assignee</span>
              ) : (
                <>
                  <Avatar
                    name={issue.assigneeName}
                    src={issue.assigneeAvatar}
                    size="xs"
                    decorative
                  />
                  {issue.assigneeName}
                </>
              )}
            </Property>
            {issue.projectName === null ? null : (
              <Property label="Project">{issue.projectName}</Property>
            )}
            {issue.labels.length === 0 ? null : (
              <Property label="Labels">
                <span className={styles.labels}>
                  {issue.labels.map((label) => (
                    <LabelChip key={label.id} compact name={label.name} color={label.color} />
                  ))}
                </span>
              </Property>
            )}
          </dl>
        </aside>
      </div>
    </article>
  );
}

/**
 * Nothing selected: the count, and how to select something.
 *
 * Not `EmptyState`, which holds itself invisible for --duration-normal against a list that
 * is still arriving. Nothing here is arriving — the count is read synchronously from the
 * replica — and the pane is the largest thing on the screen, so a fifth of a second of blank
 * panel on every visit would be the most visible pause in the product.
 */
function EmptyPane({ unread }: { unread: number }) {
  return (
    <div className={styles.empty}>
      <svg
        className={styles.illustration}
        viewBox="0 0 48 48"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M8 27V14.5A3.5 3.5 0 0 1 11.5 11h25a3.5 3.5 0 0 1 3.5 3.5V27" />
        <path d="M8 27h9l3 5h8l3-5h9v7.5a3.5 3.5 0 0 1-3.5 3.5h-25A3.5 3.5 0 0 1 8 34.5z" />
        <path d="M18 19h12M20 24h8" />
      </svg>
      <p className={styles.emptyCount}>
        {unread === 0
          ? 'No unread notifications'
          : `${unread} unread notification${unread === 1 ? '' : 's'}`}
      </p>
      <p className={styles.emptyHint}>
        Move through the list with <Kbd keys="j" /> and <Kbd keys="k" /> to preview an issue here.
      </p>
    </div>
  );
}

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.property}>
      <dt className={styles.propertyLabel}>{label}</dt>
      <dd className={styles.propertyValue}>{children}</dd>
    </div>
  );
}

interface DetailIssue {
  readonly identifier: string;
  readonly title: string;
  readonly description: string;
  readonly stateName: string;
  readonly stateCategory: StateCategory;
  readonly stateColor: string | undefined;
  readonly priority: number;
  readonly assigneeName: string | null;
  readonly assigneeAvatar: string | null;
  readonly projectName: string | null;
  readonly labels: readonly { id: UUID; name: string; color: string }[];
}

function readDetail(store: Store, id: UUID): DetailIssue | null {
  const found = store.issues.get(id);
  if (found === undefined) return null;
  const state = store.workflowStates.get(found.stateId);
  const assignee = found.assigneeId === undefined ? undefined : store.users.get(found.assigneeId);
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
    projectName:
      found.projectId === undefined ? null : (store.projects.get(found.projectId)?.name ?? null),
    labels,
  };
}
