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

import { useCallback, useRef } from 'react';
import { useNavigate } from 'react-router';

import {
  Avatar,
  EmptyState,
  LabelChip,
  Menu,
  PriorityIcon,
  priorityLabel,
  StateIcon,
} from '~/components';
import { useEngine } from '~/app/context';
import { useActions } from '~/app/keymap';
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
import { applyLabel, removeLabel } from '~/features/labels/mutations';
import { LabelPicker } from '~/features/labels/LabelPicker';
import { CyclePicker } from '~/features/cycles/CyclePicker';
import { ProjectPicker } from '~/features/projects/ProjectPicker';
import { AssigneePicker, PriorityPicker, StatusPicker } from '~/features/issue/pickers';
import { DueDatePicker, DueDateValue, EstimatePicker } from '~/features/issue/properties';
import {
  report,
  updateIssue,
  updateIssueProperties,
  setSubscribed,
} from '~/features/issue/mutations';
import { copyRich, titleAsLink } from '~/features/issue/copy';
import { useOptionalCreateIssue } from '~/features/issue/create-context';
import { issueRowMenuItems, type IssuePropertyKind } from '~/features/issue/rowMenu';
import {
  applyIssueMenuValue,
  copySeedOf,
  createRelatedIssue,
  markIssueRelation,
  toggleIssueLabel,
} from '~/features/issue/rowMenuActions';
import { useIssueRowMenuOptions } from '~/features/issue/rowMenuOptions';
import { isFavorite, toggleFavorite } from '~/features/view/mutations';
import { exact, when } from '~/features/time';
import { useContextMenu } from '~/hooks/useContextMenu';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { usePresence } from '~/hooks/usePresence';
import { useViewerId } from '~/hooks/useViewer';
import { copyText } from '~/features/github/copy';
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

/**
 * The chords drawn beside Peek's rows.
 *
 * They are true: Peek is only ever mounted by the issue list, `useKeyContext('list')` is
 * above it, and the list's `targets` falls back to the row under the cursor — which is the
 * issue Peek is showing. Pressing `S` therefore changes the status of this issue.
 *
 * The caveat worth writing down is *where*: `S` runs the **list's** action, so it opens the
 * list's status picker anchored to its bulk toolbar rather than the picker on the row below.
 * Same write, same issue, different menu on screen.
 */
const CHORDS = {
  status: 's',
  priority: 'p',
  assignee: 'a',
  estimate: 'shift+e',
  due: 'shift+d',
  cycle: 'shift+c',
  project: 'shift+p',
  labels: 'l',
} as const;

export function Peek({ open, issueId, onClose }: PeekProps) {
  const panelRef = useRef<HTMLElement>(null);
  const engine = useEngine();
  const viewerId = useViewerId();
  const navigate = useNavigate();
  const { present, exitProps } = usePresence(open, panelRef);

  const issue = useLiveQuery(
    (store) => (!present || issueId === null ? null : readPeek(store, issueId)),
    [
      'issue',
      'team',
      'user',
      'workflowState',
      'label',
      'issueLabel',
      'cycle',
      'project',
      'favorite',
    ],
    [present, issueId ?? ''],
  );

  /*
   * Peek's own pickers, and they write to the peeked issue alone — never to the list's
   * selection.
   *
   * That is not an oversight about bulk editing, it is the panel being honest about what it
   * shows. Peek draws one issue; a status chosen here with six rows selected would write six
   * issues while showing the reader one, and nothing on screen would say so. The list's own
   * toolbar is where a bulk write belongs, and it says how many it is about.
   */
  const status = useMenuTrigger();
  const priority = useMenuTrigger();
  const assignee = useMenuTrigger();
  const estimate = useMenuTrigger();
  const due = useMenuTrigger('dialog');
  const cycle = useMenuTrigger();
  const project = useMenuTrigger();
  const labels = useMenuTrigger();

  /**
   * The rows themselves, so the context menu can open a picker on the row it edits.
   *
   * Anchoring at the pointer instead would mean keeping a one-pixel box alive across the
   * hand-off from one menu to the next — the failure the issue list's own context menu had.
   * A row that is always mounted is the simpler answer, and it puts the picker where the
   * value it changes is drawn.
   */
  const factRefs = useRef<Partial<Record<IssuePropertyKind, HTMLButtonElement | null>>>({});

  const context = useContextMenu<UUID>();
  const createIssue = useOptionalCreateIssue();
  /*
   * The cascades, about the one issue this panel shows — never about the list's selection.
   * Peek draws one issue, and a status chosen here with six rows selected would write six
   * while showing the reader one.
   */
  const { options: rowMenuOptions, reset: resetRowMenu } = useIssueRowMenuOptions({
    issueId,
    enabled: context.at !== null,
  });

  const write = useCallback(
    (fields: Parameters<typeof updateIssue>[2]) => {
      if (issueId === null) return;
      updateIssue(engine, issueId, fields, viewerId).catch(report);
    },
    [engine, issueId, viewerId],
  );

  const pickFromMenu = useCallback(
    (kind: IssuePropertyKind) => {
      const anchor = factRefs.current[kind] ?? null;
      const trigger = (
        {
          status,
          priority,
          assignee,
          project,
          labels,
          estimate,
          due,
          cycle,
        } as Partial<Record<IssuePropertyKind, typeof status>>
      )[kind];
      if (trigger === undefined) return;
      trigger.showFrom(anchor);
    },
    [status, priority, assignee, project, labels, estimate, due, cycle],
  );

  /*
   * `.` opens this panel's own menu, the way it opens the list's.
   *
   * Registered in `list` rather than a context of Peek's own, for the reason written at the
   * top of `CHORDS`: Peek deliberately pushes no context, so its rows can keep drawing the
   * list's chords. That puts two `.` bindings in one context, which `assertNoConflict`
   * allows only while both are guarded — and the guards here are mutually exclusive rather
   * than merely present, because `handle` takes the first candidate that matches and an
   * overlap would silently hand the chord to whichever registered first. With the panel
   * open it belongs to the panel: that is the surface the reader is looking at, and it is
   * the same split Escape already makes between the list's clear-selection and this
   * panel's close.
   *
   * Anchored on the panel, which is what a right-click anywhere in it uses too.
   */
  useActions([
    {
      id: 'peek.actions',
      title: 'Show actions for the peeked issue',
      keys: ['.'],
      when: 'list',
      group: 'Issues',
      enabled: () => open && issueId !== null,
      run: () => {
        const element = panelRef.current;
        if (element === null || issueId === null) return;
        context.openOn(element, issueId);
      },
    },
  ]);

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
      onContextMenu={(event) => {
        context.openFromEvent(event, issueId);
      }}
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
        <Fact
          label="Status"
          action="Change status"
          keys={CHORDS.status}
          open={status.open}
          onOpen={(element) => status.showFrom(element)}
          triggerRef={(element) => {
            factRefs.current.status = element;
          }}
        >
          <StateIcon category={issue.stateCategory} color={issue.stateColor} decorative />
          {issue.stateName}
        </Fact>
        <Fact
          label="Priority"
          action="Set priority"
          keys={CHORDS.priority}
          open={priority.open}
          onOpen={(element) => priority.showFrom(element)}
          triggerRef={(element) => {
            factRefs.current.priority = element;
          }}
        >
          <PriorityIcon priority={issue.priority} decorative />
          {priorityLabel(issue.priority)}
        </Fact>
        {/* The avatar linked to the person's issues and now opens the picker instead. That
            navigation is not gone: it is the first item in this panel's context menu, which
            is where the list's label chips sent theirs for the same reason. */}
        <Fact
          label="Assignee"
          action="Assign to…"
          keys={CHORDS.assignee}
          open={assignee.open}
          onOpen={(element) => assignee.showFrom(element)}
          triggerRef={(element) => {
            factRefs.current.assignee = element;
          }}
        >
          {issue.assigneeName === null || issue.assigneeId === null ? (
            <>
              <UnassignedGlyph {...glyph} className={styles.glyph} />
              <span className={styles.unset}>Unassigned</span>
            </>
          ) : (
            <>
              <Avatar name={issue.assigneeName} src={issue.assigneeAvatar} size="xs" decorative />
              {issue.assigneeName}
            </>
          )}
        </Fact>
        {!issue.estimates ? null : (
          <Fact
            label="Estimate"
            action="Set estimate"
            keys={CHORDS.estimate}
            open={estimate.open}
            onOpen={(element) => estimate.showFrom(element)}
          >
            <EstimateGlyph {...glyph} className={styles.glyph} />
            {issue.estimateLabel}
          </Fact>
        )}
        <Fact
          label="Due date"
          action="Set due date"
          keys={CHORDS.due}
          popup="dialog"
          open={due.open}
          onOpen={(element) => due.showFrom(element)}
        >
          <CalendarGlyph {...glyph} className={styles.glyph} />
          <DueDateValue
            value={issue.dueDate}
            timezone={issue.timezone}
            source={issue.dueDateSource}
            className={issue.dueDate === null ? styles.unset : undefined}
          />
        </Fact>
        <Fact
          label="Cycle"
          action="Set cycle"
          keys={CHORDS.cycle}
          open={cycle.open}
          onOpen={(element) => cycle.showFrom(element)}
        >
          <CycleGlyph {...glyph} className={styles.glyph} />
          {issue.cycleName ?? <span className={styles.unset}>No cycle</span>}
        </Fact>
        <Fact
          label="Project"
          action="Set project"
          keys={CHORDS.project}
          open={project.open}
          onOpen={(element) => project.showFrom(element)}
          triggerRef={(element) => {
            factRefs.current.project = element;
          }}
        >
          <ProjectGlyph {...glyph} className={styles.glyph} />
          {issue.projectName ?? <span className={styles.unset}>No project</span>}
        </Fact>
        {/* The parent stays a fact rather than a control: re-parenting moves an issue into
            another issue's checklist, which is not a property this rail can offer a list of. */}
        {issue.parent === null ? null : (
          <Fact label="Parent">
            <SubIssueGlyph {...glyph} className={styles.glyph} />
            <span className={styles.parentId}>{issue.parent.identifier}</span>
            <span className={styles.parentTitle}>{issue.parent.title}</span>
          </Fact>
        )}
        <Fact
          label="Labels"
          wrap
          action="Add label"
          keys={CHORDS.labels}
          open={labels.open}
          onOpen={(element) => labels.showFrom(element)}
          triggerRef={(element) => {
            factRefs.current.labels = element;
          }}
        >
          {issue.labels.length === 0 ? (
            <>
              <TagGlyph {...glyph} className={styles.glyph} />
              <span className={styles.unset}>No labels</span>
            </>
          ) : (
            issue.labels.map((label) => (
              <LabelChip key={label.id} compact name={label.name} color={label.color} />
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

      <StatusPicker
        open={status.open}
        onClose={status.hide}
        trigger={status.ref}
        teamId={issue.teamId}
        value={issue.stateId}
        onSelect={(stateId) => write({ stateId })}
      />
      <PriorityPicker
        open={priority.open}
        onClose={priority.hide}
        trigger={priority.ref}
        value={issue.priority}
        onSelect={(value) => write({ priority: value })}
      />
      <AssigneePicker
        open={assignee.open}
        onClose={assignee.hide}
        trigger={assignee.ref}
        value={issue.assigneeId}
        onSelect={(assigneeId) => write({ assigneeId })}
      />
      <ProjectPicker
        open={project.open}
        onClose={project.hide}
        trigger={project.ref}
        teamIds={[issue.teamId]}
        value={issue.projectId ?? null}
        onSelect={(projectId) => write({ projectId })}
      />
      <CyclePicker
        open={cycle.open}
        onClose={cycle.hide}
        trigger={cycle.ref}
        teamId={issue.teamId}
        value={issue.cycleId ?? null}
        onSelect={(cycleId) => write({ cycleId })}
      />
      <LabelPicker
        open={labels.open}
        onClose={labels.hide}
        trigger={labels.ref}
        teamId={issue.teamId}
        value={issue.labelIds}
        onApply={(labelId, displaced) => {
          applyLabel(engine, issueId, labelId, displaced).catch(report);
        }}
        onRemove={(labelId) => {
          removeLabel(engine, issueId, labelId).catch(report);
        }}
      />
      {!issue.estimates ? null : (
        <EstimatePicker
          open={estimate.open}
          onClose={estimate.hide}
          trigger={estimate.ref}
          teamId={issue.teamId}
          value={issue.estimate}
          onSelect={(value) => {
            updateIssueProperties(engine, issueId, { estimate: value }).catch(report);
          }}
        />
      )}
      <DueDatePicker
        open={due.open}
        onClose={due.hide}
        trigger={due.ref}
        value={issue.dueDate}
        source={issue.dueDateSource}
        timezone={issue.timezone}
        onSelect={(value) => {
          updateIssueProperties(engine, issueId, { dueDate: value }).catch(report);
        }}
      />

      {context.at === null ? null : (
        <>
          {/* A one-pixel box at the pointer; `Menu` measures its trigger to place itself. */}
          <div {...context.anchorProps} />
          <Menu
            open
            onClose={() => {
              context.close();
              resetRowMenu();
            }}
            trigger={context.anchorRef}
            label="Issue actions"
            keysPresentation="kbd"
            density="compact"
            /*
             * The navigation the assignee link and the label chips gave up when they became
             * pickers. Without it there is no pointer route from this panel to a person's
             * issues or to a label's view at all — which is the whole reason the user asked
             * for a context menu here rather than accepting the loss.
             */
            items={issueRowMenuItems(
              {
                count: 1,
                editable: true,
                canSetStatus: true,
                identifier: issue.identifier,
                estimates: issue.estimates,
                cycles: true,
                subscribed:
                  viewerId !== null && engine.store.subscriberIdsFor(issueId).has(viewerId),
                favorited:
                  viewerId !== null && isFavorite(engine.store, viewerId, 'issue', issueId),
                ...(issue.assigneeName === null ? {} : { assigneeName: issue.assigneeName }),
                labels: issue.labels,
              },
              {
                pick: pickFromMenu,
                open: () => void navigate(`/issue/${issue.identifier}`),
                copyLink: () =>
                  void copyText(`${window.location.origin}/issue/${issue.identifier}`),
                copyIdentifier: () => void copyText(issue.identifier),
                copyTitle: () => void copyText(issue.title),
                copyTitleAsLink: () =>
                  void copyRich(
                    titleAsLink(
                      issue.identifier,
                      issue.title,
                      `${window.location.origin}/issue/${issue.identifier}`,
                    ),
                  ),
                set: (kind, value) => {
                  applyIssueMenuValue(engine, [issueId], kind, value, viewerId);
                },
                toggleLabel: (labelId, applied, displaces) => {
                  toggleIssueLabel(
                    engine,
                    [issueId],
                    labelId as UUID,
                    applied,
                    displaces as readonly UUID[],
                  );
                },
                markAs: (kind, otherId) => {
                  markIssueRelation(engine, issueId, kind, otherId as UUID, viewerId);
                },
                // Only inside the shell, which owns the composer these two open.
                ...(createIssue === null
                  ? {}
                  : {
                      createRelated: (kind) => {
                        createRelatedIssue(createIssue, engine, issueId, kind, viewerId);
                      },
                      makeCopy: () => {
                        const seed = copySeedOf(engine.store, issueId);
                        if (seed !== null) createIssue.open(seed);
                      },
                    }),
                ...(issue.assigneeId === null
                  ? {}
                  : {
                      goToAssignee: () => {
                        void navigate(userViewPath(issue.assigneeId as UUID));
                      },
                    }),
                goToLabel: (labelId) => {
                  void navigate(labelViewPath(labelId as UUID));
                },
                toggleSubscribe: () => {
                  if (viewerId === null) return;
                  const subscribed = engine.store.subscriberIdsFor(issueId).has(viewerId);
                  setSubscribed(engine, {
                    issueId,
                    userId: viewerId,
                    subscribed: !subscribed,
                  }).catch(report);
                },
                toggleFavorite: () => {
                  if (viewerId === null) return;
                  toggleFavorite(engine, viewerId, 'issue', issueId).catch(report);
                },
              },
              CHORDS,
              rowMenuOptions,
            )}
          />
        </>
      )}
    </aside>
  );
}

/**
 * What Peek draws — and, since the rail became editable, the ids behind it.
 *
 * A picker needs the id to tick the value that is already set: a status called "Todo" is not
 * something `StatusPicker` can find a row for, and an assignee's display name is not unique.
 * So every property carries both halves now, the string for the panel and the id for the menu.
 */
interface PeekIssue {
  readonly identifier: string;
  readonly title: string;
  readonly description: string;
  readonly teamId: UUID;
  /** Whether this team estimates at all, which is what decides the row exists. */
  readonly estimates: boolean;
  readonly stateId: UUID;
  readonly stateName: string;
  readonly stateCategory: StateCategory;
  readonly stateColor: string | undefined;
  readonly priority: number;
  readonly assigneeId: UUID | null;
  readonly assigneeName: string | null;
  readonly assigneeAvatar: string | null;
  readonly cycleId: UUID | null;
  readonly cycleName: string | null;
  readonly projectId: UUID | null;
  readonly projectName: string | null;
  readonly parent: { identifier: string; title: string } | null;
  /** The raw points, for the picker; `estimateLabel` is the same value in the team's scale. */
  readonly estimate: number | null;
  readonly estimateLabel: string | null;
  readonly dueDate: DateOnly | null;
  readonly dueDateSource: DueDateSource;
  readonly timezone: string;
  readonly labels: readonly { id: UUID; name: string; color: string }[];
  readonly labelIds: readonly UUID[];
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

  const estimates = team !== undefined && estimatesEnabled(team);

  return {
    identifier: store.identifierOf(found),
    title: found.title,
    description: glanceDescription(found.description),
    teamId: found.teamId,
    estimates,
    stateId: found.stateId,
    stateName: state?.name ?? 'No status',
    stateCategory: state?.category ?? 'backlog',
    stateColor: state?.color,
    priority: found.priority,
    assigneeId: found.assigneeId ?? null,
    assigneeName: assignee?.displayName ?? null,
    assigneeAvatar: assignee?.avatarUrl ?? null,
    cycleId: found.cycleId ?? null,
    cycleName: found.cycleId === undefined ? null : (store.cycles.get(found.cycleId)?.name ?? null),
    projectId: found.projectId ?? null,
    projectName:
      found.projectId === undefined ? null : (store.projects.get(found.projectId)?.name ?? null),
    parent:
      parent === undefined ? null : { identifier: store.identifierOf(parent), title: parent.title },
    estimate: found.estimate ?? null,
    estimateLabel:
      estimates && team !== undefined ? issueEstimateLabel(found.estimate, team) : null,
    dueDate: found.dueDate ?? null,
    dueDateSource: found.dueDateSource,
    timezone: team?.timezone ?? 'UTC',
    labels,
    labelIds: labels.map((label) => label.id),
    createdAt: found.createdAt,
    updatedAt: found.updatedAt,
  };
}
