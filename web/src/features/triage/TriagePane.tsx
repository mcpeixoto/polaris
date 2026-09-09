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
  PropertyTrigger,
  StateIcon,
  Tooltip,
  Menu,
} from '~/components';
import { PlusGlyph, ProjectGlyph, UnassignedGlyph } from '~/features/issue/glyphs';
import { AssigneePicker, PriorityPicker, StatusPicker } from '~/features/issue/pickers';
import { report, updateIssue, updateIssues } from '~/features/issue/mutations';
import { issueRowMenuItems, type IssuePropertyKind } from '~/features/issue/rowMenu';
import { TitleField } from '~/views/IssueDetail';
import { LabelPicker } from '~/features/labels/LabelPicker';
import { labelViewPath, userViewPath } from '~/features/labels/labelView';
import { applyLabel, removeLabel } from '~/features/labels/mutations';
import { ProjectPicker } from '~/features/projects/ProjectPicker';
import { exact, when } from '~/features/time';
import { contextMenuPoint } from '~/hooks/useContextMenu';
import { useContextMenuHandoff } from '~/hooks/useContextMenuHandoff';
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

  /*
   * The property pickers the facts list opens, and the chords that open them.
   *
   * **This pane registers no actions at all.** `views/Triage` mounts `IssueList` beside it,
   * and that list registers `S`, `A`, `P`, `⇧P` and `L` unguarded in the `list` context.
   * `KeymapRegistry.register` refuses a second binding on a key an unguarded action already
   * holds — it would throw inside the effect that mounts this pane and take the whole screen
   * down — so the caps below are the *list's* chords, drawn here because they land on this
   * issue: the list reports its cursor on every commit, `Triage` stores it, and the issue
   * this pane shows is that cursor. A cap is a promise about what a key does to the thing you
   * are looking at, and that promise is kept by the list rather than by this component.
   */
  const status = useMenuTrigger();
  const assignee = useMenuTrigger();
  /**
   * The Priority *row*'s picker, and not the guard's above.
   *
   * Two instances on purpose. `priority` is the blocked-decision guard: it opens because a
   * team refuses to let work leave triage unpriced, and choosing a value finishes the
   * sentence the reviewer started — accept, decline or merge. This one only sets a priority.
   * Merging them would mean either a row edit that silently accepts the issue, or a guard
   * that stops half way and makes somebody press Accept twice.
   */
  const rowPriority = useMenuTrigger();
  const project = useMenuTrigger();
  const labels = useMenuTrigger();
  /** Where the pane's own context menu opens: a one-pixel box at the pointer. */
  const contextAnchor = useRef<HTMLDivElement>(null);
  const [contextAt, setContextAt] = useState<{ x: number; y: number } | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const contextHandoff = useContextMenuHandoff();
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
    <section
      className={styles.pane}
      aria-label={`Triage ${issue.identifier}`}
      onContextMenu={(event) => {
        event.preventDefault();
        setContextAt(contextMenuPoint(event));
        setContextOpen(true);
      }}
    >
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

        {/* The glyph is the control and the words stay what they were — a link where there
            was one. A triage reviewer navigates from this pane as much as they edit from it,
            and a dense list row has to choose between the two; this one has the width for
            both. */}
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>Status</dt>
            <dd>
              <PropertyTrigger
                name={issue.stateName}
                action="Change status"
                keys="s"
                open={status.open}
                onOpen={status.showFrom}
                ref={status.props.ref}
              >
                <StateIcon category={issue.stateCategory} color={issue.stateColor} decorative />
              </PropertyTrigger>
              {issue.stateName}
            </dd>
          </div>
          <div className={styles.fact}>
            <dt>Priority</dt>
            <dd>
              <PropertyTrigger
                name={priorityLabel(issue.priority)}
                action="Set priority"
                keys="p"
                open={rowPriority.open}
                onOpen={rowPriority.showFrom}
                ref={rowPriority.props.ref}
              >
                <PriorityIcon priority={issue.priority} decorative />
              </PropertyTrigger>
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
          {/* Assignee, Project and the label strip are drawn whether or not they are set.
              Hiding an empty row hid the only way to fill it, and "give this to somebody" is
              the commonest thing a reviewer does that is not one of the four decisions. */}
          <div className={styles.fact}>
            <dt>Assignee</dt>
            <dd>
              <PropertyTrigger
                name={issue.assigneeName ?? 'Unassigned'}
                action="Assign to…"
                keys="a"
                open={assignee.open}
                onOpen={assignee.showFrom}
                ref={assignee.props.ref}
              >
                {issue.assigneeName === null ? (
                  <UnassignedGlyph />
                ) : (
                  <Avatar
                    name={issue.assigneeName}
                    src={issue.assigneeAvatar}
                    size="xs"
                    decorative
                  />
                )}
              </PropertyTrigger>
              {issue.assigneeName === null || issue.assigneeId === null ? (
                <span className={styles.unset}>Unassigned</span>
              ) : (
                <Link className={styles.entityLink} to={userViewPath(issue.assigneeId)}>
                  {issue.assigneeName}
                </Link>
              )}
            </dd>
          </div>
          <div className={styles.fact}>
            <dt>Project</dt>
            <dd>
              <PropertyTrigger
                name={issue.projectName ?? 'No project'}
                action="Set project"
                keys="shift+p"
                open={project.open}
                onOpen={project.showFrom}
                ref={project.props.ref}
              >
                <ProjectGlyph />
              </PropertyTrigger>
              {issue.projectName === null ? (
                <span className={styles.unset}>No project</span>
              ) : (
                issue.projectName
              )}
            </dd>
          </div>
          <div className={styles.fact}>
            <dt>Filed</dt>
            <dd>
              <time dateTime={issue.createdAt} title={exact(issue.createdAt)}>
                {when(issue.createdAt)}
              </time>
            </dd>
          </div>
        </dl>

        {/* Every chip keeps its link to the label's view, and the picker is a sixth control
            at the end of the strip rather than the chips themselves becoming buttons. */}
        <div className={styles.labels}>
          {issue.labels.map((label) => (
            <Link key={label.id} className={styles.entityLink} to={labelViewPath(label.id)}>
              <LabelChip compact name={label.name} color={label.color} />
            </Link>
          ))}
          {issue.labels.length === 0 ? <span className={styles.unset}>No labels</span> : null}
          <PropertyTrigger
            name={labelSummary(issue.labels)}
            action="Add label"
            keys="l"
            open={labels.open}
            onOpen={labels.showFrom}
            ref={labels.props.ref}
          >
            <PlusGlyph />
          </PropertyTrigger>
        </div>

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

      <StatusPicker
        open={status.open}
        onClose={() => {
          status.hide();
          setContextAt(null);
        }}
        trigger={status.ref}
        teamId={issue.teamId}
        value={issue.stateId}
        onSelect={(stateId) => updateIssue(engine, issueId, { stateId }).catch(report)}
      />
      <AssigneePicker
        open={assignee.open}
        onClose={() => {
          assignee.hide();
          setContextAt(null);
        }}
        trigger={assignee.ref}
        value={issue.assigneeId}
        onSelect={(assigneeId) => updateIssue(engine, issueId, { assigneeId }).catch(report)}
      />
      {/* The row's own priority, which sets the value and stops. The queue does not move: a
          reviewer pricing an issue has not decided anything about it yet. */}
      <PriorityPicker
        open={rowPriority.open}
        onClose={() => {
          rowPriority.hide();
          setContextAt(null);
        }}
        trigger={rowPriority.ref}
        value={issue.priority}
        onSelect={(value) => updateIssue(engine, issueId, { priority: value }).catch(report)}
      />
      <ProjectPicker
        open={project.open}
        onClose={() => {
          project.hide();
          setContextAt(null);
        }}
        trigger={project.ref}
        teamIds={[issue.teamId]}
        value={issue.projectId}
        onSelect={(projectId) => updateIssue(engine, issueId, { projectId }).catch(report)}
      />
      <LabelPicker
        open={labels.open}
        onClose={() => {
          labels.hide();
          setContextAt(null);
        }}
        trigger={labels.ref}
        teamId={issue.teamId}
        value={issue.labelIds}
        onApply={(labelId, displaced) =>
          applyLabel(engine, issueId, labelId, displaced).catch(report)
        }
        onRemove={(labelId) => removeLabel(engine, issueId, labelId).catch(report)}
      />

      {contextAt === null ? null : (
        <>
          {/* A one-pixel element at the pointer. Not `hidden`: `Menu` measures its trigger to
              place itself, and a hidden element has no box. The issue list does the same.
              The point outlives the menu for a property hand-off so the picker hangs where
              the right-click landed rather than on the fact row's registered trigger. */}
          <div
            ref={contextAnchor}
            className={styles.contextAnchor}
            style={{ top: contextAt.y, left: contextAt.x }}
          />
          <Menu
            open={contextOpen}
            onClose={() => {
              setContextOpen(false);
              if (contextHandoff.consume()) return;
              setContextAt(null);
            }}
            trigger={contextAnchor}
            label={`Actions for ${issue.identifier}`}
            keysPresentation="kbd"
            density="compact"
            items={[
              ...issueRowMenuItems(
                {
                  count: 1,
                  editable: true,
                  canSetStatus: true,
                  identifier: issue.identifier,
                  estimates: false,
                  cycles: false,
                  ...(issue.assigneeName === null ? null : { assigneeName: issue.assigneeName }),
                  labels: issue.labels,
                },
                {
                  pick: (kind: IssuePropertyKind) => {
                    const trigger =
                      kind === 'status'
                        ? status
                        : kind === 'assignee'
                          ? assignee
                          : kind === 'priority'
                            ? rowPriority
                            : kind === 'project'
                              ? project
                              : kind === 'labels'
                                ? labels
                                : null;
                    if (trigger === null) return;
                    contextHandoff.begin();
                    setContextOpen(false);
                    trigger.showFrom(contextAnchor.current);
                  },
                },
                // The list's chords, and they do fire here: `Triage` mounts `IssueList`
                // beside this pane and its cursor is the issue this menu is about.
                { status: 's', assignee: 'a', priority: 'p', project: 'shift+p', labels: 'l' },
              ),
              { kind: 'separator' },
              /*
               * The four decisions, and each goes through `guarded` rather than straight to
               * the mutation — a team that refuses to let work leave triage unpriced must
               * refuse it here too, or the menu becomes the way around the rule the buttons
               * enforce. `1` / `2` / `3` / `H` are `IssueList`'s triage bindings, live on
               * this screen because `available` asks whether the list is in triage.
               */
              {
                id: 'accept',
                label: 'Accept',
                keys: '1',
                onSelect: () => {
                  setContextOpen(false);
                  setContextAt(null);
                  accept();
                },
              },
              {
                id: 'duplicate',
                label: 'Mark as duplicate',
                keys: '2',
                onSelect: () => {
                  setContextOpen(false);
                  setContextAt(null);
                  pickDuplicate();
                },
              },
              {
                id: 'decline',
                label: 'Decline',
                keys: '3',
                onSelect: () => {
                  setContextOpen(false);
                  setContextAt(null);
                  decline();
                },
              },
              {
                id: 'snooze',
                label: 'Snooze',
                keys: 'h',
                onSelect: () => {
                  setContextOpen(false);
                  setContextAt(null);
                  snooze.show();
                },
              },
            ]}
          />
        </>
      )}
    </section>
  );
}

/** The labels as one accessible name, because that is the value the trigger stands for. */
function labelSummary(labels: readonly { name: string }[]): string {
  return labels.length === 0 ? 'No labels' : labels.map((label) => label.name).join(', ');
}

interface TriageIssue {
  readonly teamId: UUID;
  readonly identifier: string;
  readonly title: string;
  readonly description: string;
  readonly stateId: UUID;
  readonly stateName: string;
  readonly stateCategory: StateCategory;
  readonly stateColor: string | undefined;
  readonly priority: number;
  readonly creatorName: string | null;
  readonly creatorAvatar: string | null;
  readonly assigneeId: UUID | null;
  readonly assigneeName: string | null;
  readonly assigneeAvatar: string | null;
  readonly projectId: UUID | null;
  readonly projectName: string | null;
  /** Every label on the issue, which is what the picker ticks against. */
  readonly labelIds: readonly UUID[];
  /** The ones the strip draws: no groups, nothing archived, in name order. */
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
    stateId: found.stateId,
    stateName: state?.name ?? 'No status',
    stateCategory: state?.category ?? 'triage',
    stateColor: state?.color,
    priority: found.priority,
    creatorName: creator?.displayName ?? null,
    creatorAvatar: creator?.avatarUrl ?? null,
    assigneeId: found.assigneeId ?? null,
    assigneeName: assignee?.displayName ?? null,
    assigneeAvatar: assignee?.avatarUrl ?? null,
    projectId: found.projectId ?? null,
    projectName:
      found.projectId === undefined ? null : (store.projects.get(found.projectId)?.name ?? null),
    labelIds: [...store.labelIdsFor(found.id)],
    labels,
    createdAt: found.createdAt,
  };
}
