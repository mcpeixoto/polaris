/**
 * The right-hand half of triage: the issue under the queue's cursor, and the four decisions
 * that can be made about it.
 *
 * Triage is the one screen in this product where reading and deciding are the same motion,
 * which is why the issue is beside the queue rather than behind an Enter. A reviewer working
 * a queue of forty needs the description, the reporter and the labels in front of them at the
 * moment they press Accept; a list that only shows titles makes them open every row, decide,
 * and come back to a cursor that has moved.
 *
 * It reads the issue itself rather than borrowing the issue page or Peek. Peek is a glance
 * that truncates its description and lives inside the list's own layout, and the issue page
 * owns the route, the editor and the activity feed — neither is the thing a decision is made
 * from, and wrapping either one here would make triage the screen that breaks when they
 * change.
 *
 * Every decision advances. The next id is captured from the queue *before* the write, because
 * the write is optimistic: accept, decline and merge all move the issue out of the triage
 * category and the row is gone from the list in the same frame. Asked afterwards, "the next
 * issue" is whatever is now first, which is how a reviewer ends up back at the top of the
 * queue after every decision.
 */

import { useRef, useState } from 'react';
import { Link } from 'react-router';

import { useEngine } from '~/app/context';
import {
  Avatar,
  Button,
  EmptyState,
  LabelChip,
  PriorityIcon,
  priorityLabel,
  StateIcon,
  Tooltip,
  Menu,
} from '~/components';
import { PriorityPicker } from '~/features/issue/pickers';
import { report, updateIssue, updateIssues } from '~/features/issue/mutations';
import { TitleField } from '~/views/IssueDetail';
import { labelViewPath, userViewPath } from '~/features/labels/labelView';
import { exact, when } from '~/features/time';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import type { StateCategory, Store, UUID } from '~/store';

import { DuplicatePicker } from './DuplicatePicker';
import { nextInQueue } from './focus';
import {
  acceptTriageIssue,
  declineTriageIssue,
  markIssueDuplicate,
  requiresPriorityToLeave,
  snoozeIssue,
} from './mutations';
import { snoozeItems } from './snooze';
import styles from './TriagePane.module.css';

export interface TriagePaneProps {
  /** The row the queue's cursor is on, or null when the queue is empty. */
  readonly issueId: UUID | null;
  /** The queue in the order it is drawn, so a decision knows what follows it. */
  readonly queueIds: readonly UUID[];
  /** Where to put the cursor once a decision has been taken. */
  readonly onAdvance: (next: UUID | null) => void;
}

export function TriagePane({ issueId, queueIds, onAdvance }: TriagePaneProps) {
  const engine = useEngine();
  const acceptRef = useRef<HTMLButtonElement>(null);
  const duplicate = useMenuTrigger();
  const snooze = useMenuTrigger();
  const priority = useMenuTrigger();
  /**
   * Which decision is waiting on a priority.
   *
   * A team may refuse to let work leave triage unpriced, and the server enforces it. Rather
   * than flashing a revert, the button opens the priority picker and remembers what it was
   * about to do — so setting the priority finishes the sentence the reviewer started instead
   * of making them press Accept twice.
   */
  const [blocked, setBlocked] = useState<'accept' | 'decline' | 'duplicate' | null>(null);

  const issue = useLiveQuery(
    (store) => (issueId === null ? null : readTriageIssue(store, issueId)),
    ['issue', 'team', 'user', 'workflowState', 'label', 'issueLabel', 'project'],
    [issueId ?? ''],
  );

  if (issueId === null || issue === null) {
    return (
      <section className={styles.pane} aria-label="Triage issue">
        <EmptyState
          title={issueId === null ? 'Nothing to review' : 'This issue is not here yet'}
          description={
            issueId === null
              ? 'The queue is empty. Anything filed into triage lands here for a decision.'
              : 'It may still be arriving, or it belongs to a team you are not in.'
          }
        />
      </section>
    );
  }

  /** The decision, and the row it hands over to. Both halves before either write. */
  const decide = (run: (id: UUID) => Promise<void>) => {
    const next = nextInQueue(queueIds, issueId);
    run(issueId).catch(report);
    onAdvance(next);
  };

  const guarded = (kind: 'accept' | 'decline' | 'duplicate', run: () => void) => {
    if (requiresPriorityToLeave(engine, [issueId])) {
      setBlocked(kind);
      priority.show();
      return;
    }
    run();
  };

  const accept = () => guarded('accept', () => decide((id) => acceptTriageIssue(engine, id)));
  const decline = () => guarded('decline', () => decide((id) => declineTriageIssue(engine, id)));
  const pickDuplicate = () => guarded('duplicate', () => duplicate.show());

  return (
    <section className={styles.pane} aria-label={`Triage ${issue.identifier}`}>
      <div className={styles.body}>
        <header className={styles.header}>
          <Link className={styles.identifier} to={`/issue/${issue.identifier}`}>
            {issue.identifier}
          </Link>
          {/* The same editable title the issue screen draws: triage is where a title first
              gets read by a person, and a typo caught here should not need a round trip to
              the full issue. */}
          <TitleField
            key={issueId}
            issueId={issueId}
            title={issue.title}
            onSave={(title) => updateIssue(engine, issueId, { title }).catch(report)}
          />
        </header>

        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>Status</dt>
            <dd>
              <StateIcon category={issue.stateCategory} color={issue.stateColor} decorative />
              {issue.stateName}
            </dd>
          </div>
          <div className={styles.fact}>
            <dt>Priority</dt>
            <dd>
              <PriorityIcon priority={issue.priority} decorative />
              {priorityLabel(issue.priority)}
            </dd>
          </div>
          <div className={styles.fact}>
            <dt>Filed by</dt>
            <dd>
              {issue.creatorName === null ? (
                'Somebody outside the team'
              ) : (
                <>
                  <Avatar name={issue.creatorName} src={issue.creatorAvatar} size="xs" decorative />
                  {issue.creatorName}
                </>
              )}
            </dd>
          </div>
          {issue.assigneeName === null || issue.assigneeId === null ? null : (
            <div className={styles.fact}>
              <dt>Assignee</dt>
              <dd>
                <Link className={styles.entityLink} to={userViewPath(issue.assigneeId)}>
                  <Avatar
                    name={issue.assigneeName}
                    src={issue.assigneeAvatar}
                    size="xs"
                    decorative
                  />
                  {issue.assigneeName}
                </Link>
              </dd>
            </div>
          )}
          {issue.projectName === null ? null : (
            <div className={styles.fact}>
              <dt>Project</dt>
              <dd>{issue.projectName}</dd>
            </div>
          )}
          <div className={styles.fact}>
            <dt>Filed</dt>
            <dd>
              <time dateTime={issue.createdAt} title={exact(issue.createdAt)}>
                {when(issue.createdAt)}
              </time>
            </dd>
          </div>
        </dl>

        {issue.labels.length === 0 ? null : (
          <div className={styles.labels}>
            {issue.labels.map((label) => (
              <Link key={label.id} className={styles.entityLink} to={labelViewPath(label.id)}>
                <LabelChip compact name={label.name} color={label.color} />
              </Link>
            ))}
          </div>
        )}

        {/* The whole description, untruncated. Triage is where somebody reads a bug report
            written by a person who is not in the team and decides whether it is real — a
            preview that cuts it off at a paragraph makes the decision from half the evidence. */}
        <p className={styles.description}>
          {issue.description === '' ? 'No description' : issue.description}
        </p>
      </div>

      <div className={styles.actions}>
        <Tooltip label="Accept into the team's default status" keys="1">
          <Button ref={acceptRef} variant="primary" onClick={accept}>
            Accept
          </Button>
        </Tooltip>
        <Tooltip label="Mark as a duplicate of another issue" keys="2">
          {/* Not `duplicate.props`: the button has to run the priority guard before it
              opens anything, and the spread's own onClick would open the picker behind it. */}
          <Button
            ref={duplicate.ref}
            aria-haspopup="menu"
            aria-expanded={duplicate.open}
            onClick={pickDuplicate}
          >
            Mark duplicate
          </Button>
        </Tooltip>
        <Tooltip label="Decline and cancel the issue" keys="3">
          <Button onClick={decline}>Decline</Button>
        </Tooltip>
        <Tooltip label="Snooze until later" keys="h">
          <Button {...snooze.props}>Snooze</Button>
        </Tooltip>
      </div>

      <DuplicatePicker
        open={duplicate.open}
        onClose={duplicate.hide}
        trigger={duplicate.ref}
        placement="top-start"
        teamId={issue.teamId}
        exclude={new Set([issueId])}
        onSelect={(canonicalId) => {
          duplicate.hide();
          decide((id) => markIssueDuplicate(engine, id, canonicalId));
        }}
      />
      <Menu
        open={snooze.open}
        onClose={snooze.hide}
        trigger={snooze.ref}
        placement="top-start"
        label="Snooze until"
        items={snoozeItems((until) => {
          snooze.hide();
          decide((id) => snoozeIssue(engine, id, until));
        })}
      />
      {/* Anchored to Accept — the button whose sentence the priority is finishing — so that
          closing the picker hands focus back to a control the reviewer can see, rather than to
          a hidden element and from there to the body. */}
      <PriorityPicker
        open={priority.open}
        onClose={() => {
          priority.hide();
          setBlocked(null);
        }}
        trigger={acceptRef}
        placement="top-start"
        value={issue.priority}
        onSelect={(value) => {
          priority.hide();
          const kind = blocked;
          setBlocked(null);
          updateIssues(engine, [issueId], { priority: value })
            .then(() => {
              if (kind === 'accept') decide((id) => acceptTriageIssue(engine, id));
              else if (kind === 'decline') decide((id) => declineTriageIssue(engine, id));
              else if (kind === 'duplicate') duplicate.show();
            })
            .catch(report);
        }}
      />
    </section>
  );
}

interface TriageIssue {
  readonly teamId: UUID;
  readonly identifier: string;
  readonly title: string;
  readonly description: string;
  readonly stateName: string;
  readonly stateCategory: StateCategory;
  readonly stateColor: string | undefined;
  readonly priority: number;
  readonly creatorName: string | null;
  readonly creatorAvatar: string | null;
  readonly assigneeId: UUID | null;
  readonly assigneeName: string | null;
  readonly assigneeAvatar: string | null;
  readonly projectName: string | null;
  readonly labels: readonly { id: UUID; name: string; color: string }[];
  readonly createdAt: string;
}

function readTriageIssue(store: Store, id: UUID): TriageIssue | null {
  const found = store.issues.get(id);
  if (found === undefined) return null;
  const state = store.workflowStates.get(found.stateId);
  const creator = found.creatorId === undefined ? undefined : store.users.get(found.creatorId);
  const assignee = found.assigneeId === undefined ? undefined : store.users.get(found.assigneeId);
  const labels: { id: UUID; name: string; color: string }[] = [];
  for (const labelId of store.labelIdsFor(found.id)) {
    const label = store.labels.get(labelId);
    if (label === undefined || label.archivedAt !== undefined || label.isGroup) continue;
    labels.push({ id: label.id, name: label.name, color: label.color });
  }
  labels.sort((a, b) => a.name.localeCompare(b.name));

  return {
    teamId: found.teamId,
    identifier: store.identifierOf(found),
    title: found.title,
    description: found.description.trim(),
    stateName: state?.name ?? 'No status',
    stateCategory: state?.category ?? 'triage',
    stateColor: state?.color,
    priority: found.priority,
    creatorName: creator?.displayName ?? null,
    creatorAvatar: creator?.avatarUrl ?? null,
    assigneeId: found.assigneeId ?? null,
    assigneeName: assignee?.displayName ?? null,
    assigneeAvatar: assignee?.avatarUrl ?? null,
    projectName:
      found.projectId === undefined ? null : (store.projects.get(found.projectId)?.name ?? null),
    labels,
    createdAt: found.createdAt,
  };
}
