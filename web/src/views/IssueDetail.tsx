/**
 * One issue, in full.
 *
 * Everything on this screen writes through `engine.mutate`, so every edit is on screen
 * before the request leaves — the title as you tab out of it, the status the moment the menu
 * closes, the comment as you press ⌘⏎. The only thing that waits on the network is the part
 * that genuinely is not local: the activity feed, and any comments older than the window the
 * bootstrap snapshot carries. Those load behind content that is already rendered, which is
 * why the screen has no spinner across it.
 *
 * The description is still markdown, with comment marks painted over the textarea rather
 * than stored in the text. Inline threads pin to a span; the conversation at the bottom of
 * the page is the issue thread, and the two stay separate.
 *
 * Comments thread exactly one level deep. A reply to a reply is a conversation that has
 * outgrown an issue, and unbounded nesting costs a tree walk, an indentation budget and a
 * "collapse" affordance to earn back a shape nobody asked for.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type RefObject,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { DescriptionEditor } from '~/editor/DescriptionEditor';
import { isInlineRoot } from '~/editor/marks';
import { useEngine } from '~/app/context';
import { useActions, useKeyContext, useKeymap } from '~/app/keymap';
import {
  Avatar,
  Button,
  EmptyState,
  IconButton,
  LabelChip,
  Menu,
  PriorityIcon,
  priorityLabel,
  Skeleton,
  StateIcon,
  Textarea,
  TitleField as EditableTitle,
  Tooltip,
  type MenuNode,
  type TitleHandle,
} from '~/components';
// Directly rather than through the barrel, as ApiKeys and MemberSettings do: the index
// exports the primitives a screen composes with, and this is an assembled dialogue.
import { ConfirmDialog } from '~/components/ConfirmDialog';
import { estimatesEnabled, issueEstimateLabel } from '~/features/estimate';
import { maybeExpandEmoticons } from '~/features/prefs/emoticons';
import { personName, getPrefs, subscribePrefs } from '~/features/prefs/prefs';
import {
  deleteComment,
  deleteIssues,
  postComment,
  report,
  resolveComment,
  UNSETTLED_PARENT,
  setSubscribed,
  updateIssue,
  updateIssueProperties,
} from '~/features/issue/mutations';
import { CommentEditor } from '~/features/issue/CommentEditor';
import commentStyles from '~/features/issue/CommentEditor.module.css';
// The pencil and the bin, shared with project and initiative updates so the three
// row-level affordances in the product are the same drawing rather than three that drift.
import { PencilGlyph, TrashGlyph } from '~/features/project-updates/glyphs';
import {
  BellGlyph,
  BranchGlyph,
  CalendarGlyph,
  ChevronGlyph,
  CommentGlyph,
  CopyGlyph,
  CycleGlyph,
  DotGlyph,
  DotsGlyph,
  EstimateGlyph,
  LinkGlyph,
  MilestoneGlyph,
  PaperclipGlyph,
  PencilGlyph as EditGlyph,
  PlusGlyph,
  ProjectGlyph,
  RepeatGlyph,
  StarGlyph,
  SubIssueGlyph,
  TagGlyph,
  TrashGlyph as BinGlyph,
  UnassignedGlyph,
} from '~/features/issue/glyphs';
import { applyLabel, removeLabel } from '~/features/labels/mutations';
import { LabelPicker } from '~/features/labels/LabelPicker';
import { AssigneePicker, PriorityPicker, StatusPicker } from '~/features/issue/pickers';
import { CyclePicker } from '~/features/cycles/CyclePicker';
import { ProjectPicker } from '~/features/projects/ProjectPicker';
import { DueDatePicker, DueDateValue, EstimatePicker } from '~/features/issue/properties';
import { Relations, SubIssues } from '~/features/issue/relations';
import { Links } from '~/features/attachments/Links';
import { Reactions } from '~/features/reaction/Reactions';
import { detectPlatform } from '~/keys';
import { IssueCustomers } from '~/features/customers/IssueCustomers';
import { CreateCustomerRequestModal } from '~/features/customers/CreateCustomerRequestModal';
import { browserTimezone } from '~/features/locale';
import { RecurringDialog } from '~/features/recurring/RecurringDialog';
import {
  archiveRecurringIssue,
  CADENCE_LABELS,
  createRecurringIssue,
  propertiesOfIssue,
  updateRecurringIssue,
} from '~/features/recurring/mutations';
import { MilestonePicker } from '~/features/project-milestones/MilestonePicker';
import { restoreIssue } from '~/features/trash/mutations';
import { isFavorite, toggleFavorite } from '~/features/view/mutations';
import { clearIssueSla, setIssueSla } from '~/features/slas/mutations';
import { offerUndo } from '~/features/undo/UndoToast';
import { exact, when, whenDay } from '~/features/time';
import { copyText, gitBranchNameFor } from '~/features/github/copy';
import { clearCommentDraft, readCommentDrafts, writeCommentDraft } from '~/features/drafts/local';
import { useContextMenu } from '~/hooks/useContextMenu';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useViewer, useViewerId, useViewerRole } from '~/hooks/useViewer';
import { ISSUE_DETAIL_QUERY } from '~/gql/operations';
import type { Actor, Comment, StateCategory, Store, UserRole, UUID } from '~/store';
import { ApiError, gql } from '~/sync/api';
import styles from './IssueDetail.module.css';

/** The activity feed's rows, as the API returns them. Not replicated; see `useActivity`. */
export interface HistoryEntry {
  readonly id: UUID;
  readonly issueId: UUID;
  readonly actor: Actor;
  readonly kind: string;
  readonly fromValue: unknown;
  readonly toValue: unknown;
  readonly createdAt: string;
}

/** The key the root composer's draft is filed under. Comment ids are uuids, so it cannot clash. */
const ROOT = 'root';

export function IssueDetail() {
  const { identifier = '' } = useParams<{ identifier: string }>();
  const engine = useEngine();
  const navigate = useNavigate();
  const viewerId = useViewerId();
  const viewer = useViewer();

  const commentSubmit = useSyncExternalStore(
    subscribePrefs,
    () => getPrefs().commentSubmit,
    () => 'mod-enter' as const,
  );

  const issueId = useLiveQuery(
    (store) => locate(store, identifier),
    ['issue', 'team'],
    [identifier],
  );

  // The team the identifier names, whether or not the issue itself is in the replica. An
  // archived issue is a delete as far as the replica is concerned, so a stale link to one —
  // or a Back onto an issue archived from the list — lands here, and until this was resolved
  // the page said the issue may belong to a team you are not in, which is the one thing that
  // had not happened.
  const namedTeamKey = useLiveQuery(
    (store) => teamKeyIn(store, identifier),
    ['team'],
    [identifier],
  );

  const issue = useLiveQuery(
    (store) => {
      if (issueId === null) return null;
      const found = store.issues.get(issueId);
      if (found === undefined) return null;
      const state = store.workflowStates.get(found.stateId);
      const assignee =
        found.assigneeId === undefined ? undefined : store.users.get(found.assigneeId);
      const creator = found.creatorId === undefined ? undefined : store.users.get(found.creatorId);
      const team = store.teams.get(found.teamId);
      return {
        id: found.id,
        teamId: found.teamId,
        teamName: team?.name ?? 'Unknown team',
        teamKey: team?.key ?? '',
        identifier: store.identifierOf(found),
        title: found.title,
        description: found.description,
        priority: found.priority,
        stateId: found.stateId,
        stateName: state?.name ?? 'No status',
        stateCategory: state?.category ?? ('backlog' as StateCategory),
        stateColor: state?.color,
        assigneeId: found.assigneeId ?? null,
        assigneeName: assignee === undefined ? null : personName(assignee),
        assigneeAvatar: assignee?.avatarUrl ?? null,
        creatorName: creator === undefined ? null : personName(creator),
        createdAt: found.createdAt,
        archived: found.archivedAt !== undefined,
        estimate: found.estimate ?? null,
        dueDate: found.dueDate ?? null,
        dueDateSource: found.dueDateSource,
        // The team's zone and not the reader's, so two people looking at one issue agree
        // about whether it is overdue. A team missing from the replica falls back to the
        // browser's, which is wrong in the same direction for everybody rather than wrong
        // differently for each of them.
        timezone: team?.timezone ?? browserTimezone(),
        estimatesEnabled: team !== undefined && estimatesEnabled(team),
        estimateLabel: team === undefined ? null : issueEstimateLabel(found.estimate, team),
        projectId: found.projectId ?? null,
        projectName:
          found.projectId === undefined
            ? null
            : (store.projects.get(found.projectId)?.name ?? 'Unknown project'),
        cycleId: found.cycleId ?? null,
        cycleName:
          found.cycleId === undefined
            ? null
            : (store.cycles.get(found.cycleId)?.name ?? 'Unknown cycle'),
        recurring:
          found.recurringIssueId === undefined
            ? null
            : (() => {
                const rec = store.recurringIssues.get(found.recurringIssueId);
                // The id as well as the two values on screen: both writers this row now
                // reaches — edit the cadence, stop the schedule — name the schedule, not
                // the issue that happens to point at it.
                return rec === undefined
                  ? null
                  : { id: rec.id, cadence: rec.cadence, nextDueDate: rec.nextDueDate };
              })(),
        labelIds: [...store.labelIdsFor(found.id)],
        labels: [...store.labelIdsFor(found.id)].flatMap((id) => {
          const label = store.get('label', id);
          return label === undefined
            ? []
            : [{ id: label.id, name: label.name, color: label.color }];
        }),
        milestoneId: found.projectMilestoneId ?? null,
        milestoneName:
          found.projectMilestoneId === undefined
            ? null
            : (store.get('projectMilestone', found.projectMilestoneId)?.name ??
              'Unknown milestone'),
        subscribed: viewerId !== null && store.subscriberIdsFor(found.id).has(viewerId),
        subscribers: [...store.subscriberIdsFor(found.id)].flatMap((id) => {
          const user = store.users.get(id);
          return user === undefined
            ? []
            : [{ id: user.id, name: personName(user), avatar: user.avatarUrl ?? null }];
        }),
        hasChildren: store.childIssueIdsFor(found.id).size > 0,
        /**
         * The canonical issue this one duplicates, when it has been marked as one.
         *
         * Read from this end only. `duplicate` is stored with the duplicate first, so a row
         * found through `relationIdsFrom` is "this issue duplicates that one" and a row found
         * the other way round is "that one duplicates this" — which is a fact about the other
         * issue and has no business banner-ing this one as closed.
         */
        duplicateOf: (() => {
          for (const id of store.relationIdsFrom(found.id)) {
            const relation = store.get('issueRelation', id);
            if (relation === undefined || relation.type !== 'duplicate') continue;
            const other = store.issues.get(relation.relatedIssueId);
            return other === undefined
              ? { identifier: null, title: null }
              : { identifier: store.identifierOf(other), title: other.title };
          }
          return null;
        })(),
      };
    },
    [
      'issue',
      'team',
      'user',
      'workflowState',
      'project',
      'projectMilestone',
      'cycle',
      'recurringIssue',
      'issueLabel',
      'label',
      'issueSubscription',
      'issueRelation',
    ],
    [issueId, viewerId],
  );

  // Loaded once for the screen and handed to both panels below. Two hooks asking the same
  // question would be two requests for one issue every time the route moved.
  const activity = useActivity(issueId);

  const names = useLiveQuery(
    (store) => {
      const out: Record<string, string> = {};
      for (const user of store.users.values()) out[user.id] = personName(user);
      return out;
    },
    ['user'],
  );

  const status = useMenuTrigger();
  const assignee = useMenuTrigger();
  const priority = useMenuTrigger();
  const estimate = useMenuTrigger();
  // `dialog`, because that is what `DueDatePicker` renders: a panel with a text field and a
  // form, not a list the arrow keys walk. Every other trigger here opens a `Menu`.
  const due = useMenuTrigger('dialog');
  const project = useMenuTrigger();
  const milestone = useMenuTrigger();
  const cycle = useMenuTrigger();
  const labels = useMenuTrigger();
  // The header's "…": the actions that are not worth a button of their own.
  const more = useMenuTrigger();
  const contextMenu = useContextMenu<string>();

  const { registry, context } = useKeymap();

  const favourite = useLiveQuery(
    (store) =>
      issueId !== null && viewerId !== null && isFavorite(store, viewerId, 'issue', issueId),
    ['favorite'],
    [issueId, viewerId],
  );

  // The title field's own handle: `E` focuses it, Escape abandons an edit in it. Held here
  // because both are registered actions and the registry is above this component.
  const titleRef = useRef<TitleHandle | null>(null);

  const commands = useRef<DetailCommands>({
    pickStatus: () => {},
    pickAssignee: () => {},
    pickPriority: () => {},
    pickProject: () => {},
    pickMilestone: () => {},
    pickCycle: () => {},
    pickEstimate: () => {},
    pickDue: () => {},
    pickLabels: () => {},
    assignToMe: () => {},
    toggleSubscribe: () => {},
    focusTitle: () => {},
    askDelete: () => {},
    makeRecurring: () => {},
    editRecurring: () => {},
    stopRecurring: () => {},
    submitComment: () => {},
    copyGitBranch: () => {},
    copyModelUuid: () => {},
    copyLink: () => {},
    copyIdentifier: () => {},
    toggleFavourite: () => {},
  });

  // Whether the confirmation is up. Held here rather than inside a component of its own so
  // that the command-menu entry and the button open the same one.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // One dialog for both halves of a cadence: convert asks the same two questions edit does,
  // and a second copy of it would be a second place for the two to drift apart.
  const [recurringMode, setRecurringMode] = useState<'convert' | 'edit' | null>(null);
  const [recurringBusy, setRecurringBusy] = useState(false);
  const [recurringError, setRecurringError] = useState<string | null>(null);
  const [stoppingRecurring, setStoppingRecurring] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);

  useKeyContext('detail');

  useActions(
    [
      {
        id: 'issueDetail.status',
        title: 'Change status',
        keys: ['s'],
        when: 'detail',
        group: 'Issues',
        run: () => commands.current.pickStatus(),
      },
      {
        id: 'issueDetail.assign',
        title: 'Assign to…',
        keys: ['a'],
        when: 'detail',
        group: 'Issues',
        run: () => commands.current.pickAssignee(),
      },
      {
        id: 'issueDetail.priority',
        title: 'Set priority',
        keys: ['p'],
        when: 'detail',
        group: 'Issues',
        run: () => commands.current.pickPriority(),
      },
      {
        id: 'issueDetail.project',
        title: 'Set project',
        keys: ['shift+p'],
        when: 'detail',
        group: 'Issues',
        run: () => commands.current.pickProject(),
      },
      /*
       * Registered only where the issue is in a project, on the `issueDetail.estimate`
       * precedent above: a milestone is a marker *inside* a project, so with no project
       * there is nothing for the key to open and the rail draws no row either. The key
       * follows the control it opens.
       *
       * `Shift+M` is the binding 19-clients-sync-preferences.md has promised for milestone
       * since it was written; nothing had ever bound it. It does not collide with the `m b`
       * / `m x` / `m r` relation sequences here — Shift is part of a letter's chord identity
       * (`chordId` in keys/matcher.ts), so `shift+m` and `m` are two prefixes, not one.
       */
      ...(issue !== null && issue.projectId !== null
        ? [
            {
              id: 'issueDetail.milestone',
              title: 'Set milestone',
              keys: ['shift+m'],
              when: 'detail' as const,
              group: 'Issues',
              run: () => commands.current.pickMilestone(),
            },
          ]
        : []),
      {
        id: 'issueDetail.cycle',
        title: 'Set cycle',
        keys: ['shift+c'],
        when: 'detail',
        group: 'Issues',
        run: () => commands.current.pickCycle(),
      },
      {
        id: 'issueDetail.labels',
        title: 'Add label',
        keys: ['l'],
        when: 'detail',
        group: 'Issues',
        run: () => commands.current.pickLabels(),
      },
      {
        id: 'issueDetail.assignToMe',
        title: 'Assign to me',
        keys: ['i'],
        when: 'detail',
        group: 'Issues',
        enabled: () => viewerId !== null,
        run: () => commands.current.assignToMe(),
      },
      /*
       * Registered only where it can do something, rather than registered-and-disabled.
       *
       * `enabled` and "not registered" are the same thing to the matcher — both leave the key
       * unbound — but they are not the same thing to the help overlay, which lists every
       * *registered* binding and cannot ask whether it happens to be runnable right now
       * (Escape-to-dismiss is disabled far more often than not, and a sheet that dropped it
       * would be missing the shortcut people look up most). So a permanently-disabled action
       * is a row in the keyboard reference that never works, on every issue in the team, for
       * as long as the team declines to estimate — which is the one thing that overlay exists
       * not to do. (`available` now gives the overlay a way to ask, for a gate that cannot be
       * hoisted out of the action. One that can be, as this one can, is still better hoisted:
       * the key and the control it opens then make one decision instead of two.)
       *
       * And the rail has already made this decision: the estimate row is absent for a team
       * whose scale is `none`, not greyed out. The key follows the control it opens.
       */
      ...(issue?.estimatesEnabled === true
        ? [
            {
              id: 'issueDetail.estimate',
              title: 'Set estimate',
              keys: ['shift+e'],
              when: 'detail' as const,
              group: 'Issues',
              run: () => commands.current.pickEstimate(),
            },
          ]
        : []),
      {
        id: 'issueDetail.dueDate',
        title: 'Set due date',
        // `D` as well as `Shift+D`, so the rail's five properties are five bare letters —
        // S, A, P, L, D — rather than four and an exception. The shift form stays bound
        // because it is the one in the shortcut reference and in people's fingers.
        keys: ['shift+d', 'd'],
        when: 'detail',
        group: 'Issues',
        run: () => commands.current.pickDue(),
      },
      {
        id: 'issueDetail.subscribe',
        title: 'Subscribe',
        keys: ['shift+s'],
        when: 'detail',
        group: 'Issues',
        enabled: () => viewerId !== null,
        run: () => commands.current.toggleSubscribe(),
      },
      /*
       * `E` puts the cursor in the title, which is what 02-issues.md says it does.
       *
       * It used to archive, on a bare keystroke, with no confirmation and no undo — beside
       * `s`, `a` and `p`, which are all one mis-hit away. Archiving drops the row from the
       * replica (`archiveIssues` says so in its own header: "a client cannot un-archive what
       * it no longer holds"), so the recoverable action, delete, had a confirm dialog and an
       * undo offer while the irrecoverable one had a single letter.
       *
       * The button went with the key rather than being routed through that dialog, and the
       * choice is the doc's: 02-issues.md states plainly that **there is no manual archive** —
       * archiving is something the product does on a team's schedule, not a control on this
       * screen. Wiring a confirmation onto an affordance the spec does not have would have
       * been making the wrong thing safer. Nothing else is lost: `archiveIssues` still has its
       * call site on the issue list, and the team's archives screen is still where archived
       * work is read.
       */
      {
        id: 'issueDetail.editTitle',
        title: 'Edit title',
        keys: ['e'],
        when: 'detail',
        group: 'Issues',
        run: () => commands.current.focusTitle(),
      },
      {
        /**
         * Deliberately unbound.
         *
         * Every other action on this screen is one letter away, which is right for things
         * that can be undone by pressing the same letter again. This one takes the issue off
         * everybody's screen, and a single keystroke for that — next to `s`, `a`, `p` and `e`
         * — is a mis-hit away from an issue nobody can find. It is in the command menu, where
         * reaching it takes a deliberate sentence, and behind a button that says what it does.
         */
        id: 'issueDetail.delete',
        title: 'Delete issue',
        when: 'detail',
        group: 'Issues',
        run: () => commands.current.askDelete(),
      },
      {
        /*
         * The way out of a title edit that saves nothing.
         *
         * Every exit the field had committed — blur, Enter, the route moving, the tab
         * closing — so a rename begun by accident had no way back except retyping the old
         * name from memory. Escape is unclaimed in `detail`, and guarded on there being a
         * draft so that with the field at rest it falls through to whatever else wants it.
         */
        id: 'issueDetail.revertTitle',
        title: 'Discard the title edit',
        keys: ['Escape'],
        when: 'detail',
        group: 'Issues',
        // Hidden for the reason the due-date panel's Escape is: "abandon the thing you are
        // in the middle of" is not a sentence anybody types into a command list.
        hidden: true,
        enabled: () => titleRef.current?.editing() === true,
        run: () => titleRef.current?.revert(),
      },
      /*
       * The three schedule actions, none of them bound.
       *
       * No document names a chord for any of them, and this codebase has twice declined to
       * invent one rather than spend a letter on a guess (`relations.tsx`, and
       * `makeRecurring` here since it was written). Unbound is not unreachable: the command
       * menu takes a sentence, which is the right amount of deliberation for a schedule that
       * belongs to the whole team. The help sheet lists bound actions only, so it stays
       * quiet about all three, which is honest.
       */
      {
        id: 'issueDetail.makeRecurring',
        title: 'Convert into recurring issue',
        when: 'detail',
        group: 'Issues',
        run: () => commands.current.makeRecurring(),
      },
      {
        id: 'issueDetail.editRecurring',
        title: 'Edit recurring schedule',
        when: 'detail',
        group: 'Issues',
        run: () => commands.current.editRecurring(),
      },
      {
        id: 'issueDetail.stopRecurring',
        title: 'Stop repeating',
        when: 'detail',
        group: 'Issues',
        run: () => commands.current.stopRecurring(),
      },
      {
        id: 'issueDetail.comment',
        title: 'Post comment',
        keys: commentSubmit === 'enter' ? ['mod+Enter', 'Enter'] : ['mod+Enter'],
        when: 'detail',
        group: 'Issues',
        // Hidden: it is the submit gesture for whichever composer has focus, which is not a
        // thing anybody searches a command list for.
        hidden: true,
        run: () => commands.current.submitComment(),
      },
      {
        id: 'issue.copyGitBranchName',
        title: 'Copy git branch name',
        keys: ['mod+shift+period'],
        when: 'detail',
        group: 'Issues',
        run: () => commands.current.copyGitBranch(),
      },
      {
        id: 'issue.copyModelUuid',
        title: 'Copy model UUID',
        when: 'detail',
        group: 'Issues',
        run: () => commands.current.copyModelUuid(),
      },
      {
        id: 'issueDetail.copyLink',
        title: 'Copy link',
        keys: ['mod+shift+comma'],
        when: 'detail',
        group: 'Issues',
        run: () => commands.current.copyLink(),
      },
      {
        id: 'issueDetail.copyIdentifier',
        title: 'Copy issue identifier',
        when: 'detail',
        group: 'Issues',
        run: () => commands.current.copyIdentifier(),
      },
      {
        id: 'issueDetail.favourite',
        title: 'Favourite issue',
        when: 'detail',
        group: 'Issues',
        enabled: () => viewerId !== null,
        run: () => commands.current.toggleFavourite(),
      },
      ...(viewer !== null && viewer.role !== 'guest'
        ? [
            {
              id: 'issueDetail.customerRequest',
              title: 'Add customer request',
              keys: detectPlatform() === 'mac' ? ['ctrl+r'] : ['ctrl+alt+r'],
              when: 'detail' as const,
              group: 'Customers',
              run: () => setRequestOpen(true),
            },
          ]
        : []),
    ],
    [commentSubmit, viewer, viewerId, issue?.estimatesEnabled, issue?.projectId],
  );

  if (issue === null) {
    return (
      <div className={styles.screen}>
        <EmptyState
          title="No such issue"
          description={
            namedTeamKey === null
              ? `Nothing in this workspace is called ${identifier}. It may have been deleted, or it may belong to a team you are not in.`
              : `Nothing open in ${namedTeamKey} is called ${identifier}. Archiving and deleting both take an issue out of every view, and ${namedTeamKey}'s archives is where both end up — restore it there and this link works again.`
          }
          action={
            <>
              {namedTeamKey === null ? null : (
                <Button onClick={() => void navigate(`/team/${namedTeamKey}/archives`)}>
                  Open {namedTeamKey} archives
                </Button>
              )}
              <Button variant="ghost" onClick={() => navigate(-1)}>
                Go back
              </Button>
            </>
          }
        />
      </div>
    );
  }

  commands.current.pickStatus = status.show;
  commands.current.pickAssignee = assignee.show;
  commands.current.pickPriority = priority.show;
  commands.current.pickProject = project.show;
  commands.current.pickMilestone = () => {
    if (issue.projectId !== null) milestone.show();
  };
  commands.current.pickCycle = cycle.show;
  commands.current.pickEstimate = () => {
    if (issue.estimatesEnabled) estimate.show();
  };
  commands.current.pickDue = due.show;
  commands.current.pickLabels = labels.show;
  commands.current.assignToMe = () => {
    if (viewerId === null) return;
    updateIssue(engine, issue.id, { assigneeId: viewerId }).catch(report);
  };
  commands.current.toggleSubscribe = () => {
    if (viewerId === null) return;
    setSubscribed(engine, {
      issueId: issue.id,
      userId: viewerId,
      subscribed: !issue.subscribed,
    }).catch(report);
  };
  commands.current.focusTitle = () => titleRef.current?.focus();
  commands.current.askDelete = () => setConfirmingDelete(true);
  commands.current.copyGitBranch = () => {
    const row = engine.store.get('issue', issue.id);
    if (row === undefined) return;
    const name = gitBranchNameFor(engine.store, row, viewer?.displayName ?? '');
    void copyText(name);
  };
  commands.current.copyModelUuid = () => {
    void copyText(issue.id);
  };
  commands.current.copyLink = () => {
    void copyText(`${window.location.origin}/issue/${issue.identifier}`);
  };
  commands.current.copyIdentifier = () => {
    void copyText(issue.identifier);
  };
  commands.current.toggleFavourite = () => {
    if (viewerId === null) return;
    toggleFavorite(engine, viewerId, 'issue', issue.id).catch(report);
  };
  commands.current.makeRecurring = () => {
    if (issue.recurring !== null) return;
    setRecurringError(null);
    setRecurringMode('convert');
  };
  commands.current.editRecurring = () => {
    if (issue.recurring === null) return;
    setRecurringError(null);
    setRecurringMode('edit');
  };
  commands.current.stopRecurring = () => {
    if (issue.recurring === null) return;
    setStoppingRecurring(true);
  };

  /**
   * Deletes the issue, and says how to get it back.
   *
   * The pairing is the one `deleteIssues` and `restoreIssue` are both written for and that
   * nothing in the client had: `deleteIssues` had no call site at all, so an issue could not
   * be deleted from the product, and the trash screen — with its thirty-day retention notice
   * and its Restore button — was a recovery route for something nothing could do.
   *
   * The undo offer is raised here rather than inside the mutation because the label is the
   * user's words for what just happened, and only this screen knows the identifier. Leaving
   * this page first is forced by the optimistic patch: the row has left the replica, so
   * staying would show a "no such issue" page the user caused. The toast is mounted above the
   * router precisely so it survives that navigation.
   */
  const confirmDelete = () => {
    const { id, identifier, teamKey } = issue;
    setConfirmingDelete(false);
    deleteIssues(engine, [id]).catch(report);
    offerUndo({
      label: `Deleted ${identifier}`,
      undo: () => restoreIssue(engine, id),
    });
    void navigate(`/team/${teamKey}`);
  };

  /**
   * The ⋯ menu and the right-click on the header render this one array, so they cannot drift.
   *
   * Unlike the other detail screens this is not `entityRowMenuItems`: an issue's list
   * counterpart is `issueRowMenuItems`, which is mostly property pickers — status, assignee,
   * priority, labels — and every one of those is already a control in the rail beside it.
   */
  const headerMenuItems = (): MenuNode[] =>
    moreItems(issue, viewerId, viewer?.role ?? null, {
      toggleSubscribe: () => commands.current.toggleSubscribe(),
      makeRecurring: () => commands.current.makeRecurring(),
      editRecurring: () => commands.current.editRecurring(),
      stopRecurring: () => commands.current.stopRecurring(),
      addRequest: () => setRequestOpen(true),
      copyModelUuid: () => commands.current.copyModelUuid(),
      askDelete: () => commands.current.askDelete(),
    });

  return (
    <div className={styles.screen}>
      {/* Both the identifier and the title, because either alone answers half of "which
          issue am I looking at" — the identifier is what people say to each other and the
          title is what it is about. */}
      <h1 className={styles.screenTitle}>
        {issue.identifier} {issue.title}
      </h1>
      <header
        className={styles.header}
        onContextMenu={(event) => {
          // A descendant that already answered this right-click owns it: a saved view's
          // tab sits inside this header and opens a menu of its own, and two menus at once
          // means neither can be clicked.
          if (event.defaultPrevented) return;
          event.preventDefault();
          contextMenu.openAt(event.clientX, event.clientY, issue.id);
        }}
      >
        <nav className={styles.crumbs} aria-label="Breadcrumb">
          {/* A link and not a button: it goes somewhere, so it should be announced as a
              link, open in a new tab on a middle click, and be copyable from a context
              menu. */}
          <Link className={styles.crumb} to={`/team/${issue.teamKey}`}>
            {issue.teamName}
          </Link>
          <ChevronGlyph className={styles.crumbChevron} />
          <span className={styles.crumbCurrent} aria-current="page">
            <span className={styles.identifier}>{issue.identifier}</span>
            <span className={styles.crumbTitle}>{issue.title}</span>
          </span>
        </nav>
        {viewerId === null ? null : (
          <IconButton
            icon={<StarGlyph on={favourite} />}
            aria-label={favourite ? 'Remove from favourites' : 'Add to favourites'}
            aria-pressed={favourite}
            className={favourite ? styles.starOn : undefined}
            onClick={() => commands.current.toggleFavourite()}
          />
        )}
        <div className={styles.spacer} />
        <div className={styles.headerActions}>
          <IconButton
            variant="secondary"
            icon={<LinkGlyph />}
            aria-label="Copy link"
            keys="mod+shift+comma"
            onClick={() => commands.current.copyLink()}
          />
          <IconButton
            variant="secondary"
            icon={<CopyGlyph />}
            aria-label="Copy issue identifier"
            onClick={() => commands.current.copyIdentifier()}
          />
          <IconButton
            variant="secondary"
            icon={<BranchGlyph />}
            aria-label="Copy git branch name"
            keys="mod+shift+period"
            onClick={() => commands.current.copyGitBranch()}
          />
          {/* Not `danger`: a delete here is recoverable for thirty days and offers an undo
              the moment it happens, and painting it red would say the same thing as revoking
              a credential. The confirmation is where the weight belongs. */}
          <IconButton
            variant="secondary"
            icon={<BinGlyph />}
            aria-label="Delete"
            onClick={() => commands.current.askDelete()}
          />
          <IconButton
            {...more.props}
            variant="secondary"
            icon={<DotsGlyph />}
            aria-label="More actions"
          />
        </div>
      </header>

      <Menu
        open={more.open}
        onClose={more.hide}
        trigger={more.ref}
        label="More actions"
        placement="bottom-end"
        items={headerMenuItems()}
      />

      {contextMenu.at === null ? null : <div {...contextMenu.anchorProps} />}
      <Menu
        open={contextMenu.at !== null}
        onClose={contextMenu.close}
        trigger={contextMenu.anchorRef}
        label={`Options for ${issue.identifier}`}
        items={headerMenuItems()}
      />

      <ConfirmDialog
        open={confirmingDelete}
        title={`Delete ${issue.identifier}?`}
        consequence={`${issue.identifier} leaves every list and board, for everybody. It keeps its comments and its links, and it can be restored from Trash for the next 30 days — after that it is gone for good.`}
        confirmLabel={`Delete ${issue.identifier}`}
        destructive
        onConfirm={confirmDelete}
        onClose={() => setConfirmingDelete(false)}
      />

      <RecurringDialog
        open={recurringMode !== null}
        title={
          recurringMode === 'edit'
            ? `Edit ${issue.identifier}'s schedule`
            : `Make ${issue.identifier} recurring`
        }
        description={
          recurringMode === 'edit'
            ? 'Changes the cadence and the day the next occurrence is due. Occurrences already created keep the dates they were given.'
            : 'This issue becomes the first occurrence. Later ones are minted from a snapshot of it, not from a live template.'
        }
        initialDueDate={
          recurringMode === 'edit' ? issue.recurring?.nextDueDate : (issue.dueDate ?? undefined)
        }
        initialCadence={recurringMode === 'edit' ? issue.recurring?.cadence : undefined}
        confirmLabel={recurringMode === 'edit' ? 'Save schedule' : 'Make recurring'}
        dueLabel={recurringMode === 'edit' ? 'Next due' : undefined}
        timezone={issue.timezone}
        busy={recurringBusy}
        error={recurringError}
        onClose={() => {
          if (recurringBusy) return;
          setRecurringMode(null);
          setRecurringError(null);
        }}
        onConfirm={(draft) => {
          const schedule = issue.recurring;
          if (recurringMode === 'edit') {
            if (schedule === null) return;
            setRecurringBusy(true);
            setRecurringError(null);
            updateRecurringIssue(engine, schedule.id, {
              cadence: draft.cadence,
              nextDueDate: draft.firstDueDate,
            })
              .then(() => {
                setRecurringBusy(false);
                setRecurringMode(null);
              })
              .catch((failure: unknown) => {
                setRecurringBusy(false);
                setRecurringError(
                  failure instanceof ApiError
                    ? failure.message
                    : 'This schedule could not be changed.',
                );
              });
            return;
          }
          const found = engine.store.issues.get(issue.id);
          if (found === undefined) return;
          setRecurringBusy(true);
          setRecurringError(null);
          createRecurringIssue(engine, {
            teamId: found.teamId,
            title: found.title,
            body: found.description,
            properties: propertiesOfIssue(engine.store, found),
            cadence: draft.cadence,
            firstDueDate: draft.firstDueDate,
            sourceIssueId: found.id,
          })
            .then(() => {
              setRecurringBusy(false);
              setRecurringMode(null);
            })
            .catch((failure: unknown) => {
              setRecurringBusy(false);
              setRecurringError(
                failure instanceof ApiError
                  ? failure.message
                  : 'This issue could not be made recurring.',
              );
            });
        }}
      />

      {/* The consequence names the team on purpose. A schedule is a `recurringIssue` row on
          the team — it is listed in that team's settings, and `ArchiveRecurringIssue` emits
          its change at team scope — so stopping it stops it for everybody, which is not what
          a control sitting on one issue looks like it does. */}
      <ConfirmDialog
        open={stoppingRecurring}
        title={`Stop repeating ${issue.identifier}?`}
        consequence={`${issue.teamName} stops getting this issue on its schedule, for everybody. The occurrences already created, this one included, keep their dates and stay exactly as they are.`}
        confirmLabel="Stop repeating"
        destructive
        onConfirm={() => {
          const schedule = issue.recurring;
          setStoppingRecurring(false);
          if (schedule === null) return;
          archiveRecurringIssue(engine, schedule.id).catch(report);
        }}
        onClose={() => setStoppingRecurring(false)}
      />

      {requestOpen && (
        <CreateCustomerRequestModal issueId={issue.id} onClose={() => setRequestOpen(false)} />
      )}

      <div className={styles.body}>
        <div className={styles.main}>
          {issue.duplicateOf === null ? null : (
            // Above the title, because it changes what the rest of the page means: this
            // issue is closed and the conversation is happening somewhere else. `status`
            // rather than `alert` — it is a standing fact about the issue, not something
            // that just went wrong.
            <p className={styles.duplicateBanner} role="status">
              This issue is a duplicate
              {issue.duplicateOf.identifier === null ? (
                ' of an issue you cannot see.'
              ) : (
                <>
                  {' of '}
                  <Link className={styles.link} to={`/issue/${issue.duplicateOf.identifier}`}>
                    {issue.duplicateOf.identifier} {issue.duplicateOf.title}
                  </Link>
                  {'. Carry the conversation on there.'}
                </>
              )}
            </p>
          )}

          <TitleField
            key={`title-${issue.id}`}
            issueId={issue.id}
            title={issue.title}
            handle={titleRef}
            onSave={(title) => updateIssue(engine, issue.id, { title }).catch(report)}
          />

          <div className={styles.description}>
            <DescriptionEditor
              target={{ kind: 'issue', id: issue.id }}
              description={issue.description}
              names={names}
              viewerId={viewerId}
              enterSubmits={commentSubmit === 'enter'}
              onSave={(description) => updateIssue(engine, issue.id, { description }).catch(report)}
            />
          </div>

          {/* The two things most often added to an issue, one press from the description.
              Both go through the registry rather than reaching into the panels below, so the
              button and the chord are one action and cannot drift apart. */}
          <div className={styles.quickActions}>
            <IconButton
              size="sm"
              icon={<PaperclipGlyph />}
              aria-label="Attach a link"
              keys="mod+shift+u"
              onClick={() => registry.invoke('issueDetail.addLink', { source: 'menu', context })}
            />
            <IconButton
              size="sm"
              icon={<SubIssueGlyph />}
              aria-label="Add sub-issue"
              keys="mod+shift+o"
              onClick={() =>
                registry.invoke('issueDetail.addSubIssue', { source: 'menu', context })
              }
            />
            {issue.hasChildren ? null : (
              <Button
                variant="ghost"
                size="sm"
                icon={<PlusGlyph />}
                onClick={() =>
                  registry.invoke('issueDetail.addSubIssue', { source: 'menu', context })
                }
              >
                Add sub-issues
              </Button>
            )}
          </div>

          {/* Above the history rather than below it: sub-issues and relations are part of
              what this issue *is*, and the history is a record of what has happened to it.
              Somebody scanning the page for "what is blocking this" should not have to read
              past a fortnight of status changes to find out. */}
          <div className={styles.sections}>
            <SubIssues
              issueId={issue.id}
              teamId={issue.teamId}
              onDetach={(childId) =>
                updateIssueProperties(engine, childId, { parentId: null }).catch(report)
              }
            />

            <Relations issueId={issue.id} />

            <Links issueId={issue.id} />

            <IssueCustomers issueId={issue.id} />
          </div>

          <hr className={styles.divider} />

          <Activity
            history={activity.history}
            status={activity.status}
            onRetry={activity.refresh}
            names={names}
            subscribed={issue.subscribed}
            subscribers={issue.subscribers}
            canSubscribe={viewerId !== null}
            onToggleSubscribe={() => commands.current.toggleSubscribe()}
          />

          {/* Keyed on the issue, and not for tidiness. `drafts`, `editing`, `replyingTo`,
              `focused` and `refusal` all belong to one conversation, and the saved-draft
              read is a lazy initializer that runs once — so without this an unsent comment
              stayed in the box across a route change and posted to the wrong issue. */}
          <Comments
            key={`comments-${issue.id}`}
            issueId={issue.id}
            identifier={issue.identifier}
            fetched={activity.comments}
            names={names}
            viewerId={viewerId}
            commands={commands}
            enterSubmits={commentSubmit === 'enter'}
          />
        </div>

        <aside className={styles.rail} aria-label="Properties">
          <h2 className={styles.railTitle}>Properties</h2>

          {/* The rail's labels are for the accessibility tree: each row is named by its
              glyph and its value on screen, which is how Linear draws it, and by the label
              a screen reader still needs. Hidden the way `.screenTitle` is, never removed. */}
          <div className={styles.property}>
            <span className={styles.srOnly} id={`${issue.id}-status-label`}>
              Status
            </span>
            <Button
              {...status.props}
              variant="ghost"
              fullWidth
              className={styles.propertyTrigger}
              aria-describedby={`${issue.id}-status-label`}
              icon={
                <StateIcon category={issue.stateCategory} color={issue.stateColor} decorative />
              }
            >
              {issue.stateName}
            </Button>
          </div>

          <div className={styles.property}>
            <span className={styles.srOnly} id={`${issue.id}-priority-label`}>
              Priority
            </span>
            <Button
              {...priority.props}
              variant="ghost"
              fullWidth
              className={styles.propertyTrigger}
              aria-describedby={`${issue.id}-priority-label`}
              icon={<PriorityIcon priority={issue.priority} decorative />}
            >
              {priorityLabel(issue.priority)}
            </Button>
          </div>

          <div className={styles.property}>
            <span className={styles.srOnly} id={`${issue.id}-assignee-label`}>
              Assignee
            </span>
            <Button
              {...assignee.props}
              variant="ghost"
              fullWidth
              className={styles.propertyTrigger}
              aria-describedby={`${issue.id}-assignee-label`}
              icon={
                issue.assigneeName === null ? (
                  <UnassignedGlyph width="14" height="14" />
                ) : (
                  <Avatar
                    name={issue.assigneeName}
                    src={issue.assigneeAvatar}
                    size="xs"
                    colorKey={issue.assigneeId ?? issue.assigneeName}
                    decorative
                  />
                )
              }
            >
              {issue.assigneeName ?? <span className={styles.unset}>Unassigned</span>}
            </Button>
          </div>

          {/* Absent entirely for a team whose scale is `none`, rather than shown disabled: a
              team that has decided not to estimate should not have a permanently empty
              estimate field on every issue reminding them of the decision. */}
          {issue.estimatesEnabled && (
            <div className={styles.property}>
              <span className={styles.srOnly} id={`${issue.id}-estimate-label`}>
                Estimate
              </span>
              <Button
                {...estimate.props}
                variant="ghost"
                fullWidth
                className={styles.propertyTrigger}
                aria-describedby={`${issue.id}-estimate-label`}
                icon={<EstimateGlyph width="14" height="14" />}
              >
                {issue.estimateLabel ?? <span className={styles.unset}>Set estimate</span>}
              </Button>
            </div>
          )}

          <div className={styles.property}>
            <span className={styles.srOnly} id={`${issue.id}-due-label`}>
              Due date
            </span>
            <Button
              {...due.props}
              variant="ghost"
              fullWidth
              className={styles.propertyTrigger}
              aria-describedby={`${issue.id}-due-label`}
              icon={<CalendarGlyph width="14" height="14" />}
            >
              <DueDateValue
                value={issue.dueDate}
                timezone={issue.timezone}
                source={issue.dueDateSource}
                className={issue.dueDate === null ? styles.unset : undefined}
              />
            </Button>
          </div>

          <div className={styles.property}>
            <span className={styles.srOnly} id={`${issue.id}-cycle-label`}>
              Cycle
            </span>
            <Button
              {...cycle.props}
              variant="ghost"
              fullWidth
              className={styles.propertyTrigger}
              aria-describedby={`${issue.id}-cycle-label`}
              icon={<CycleGlyph width="14" height="14" />}
            >
              {issue.cycleName ?? <span className={styles.unset}>Add to cycle</span>}
            </Button>
          </div>

          <h3 className={styles.railGroup} id={`${issue.id}-labels-label`}>
            Labels
          </h3>
          <div className={styles.property}>
            <Button
              {...labels.props}
              variant="ghost"
              fullWidth
              className={styles.propertyTrigger}
              aria-describedby={`${issue.id}-labels-label`}
              icon={issue.labels.length === 0 ? <PlusGlyph width="14" height="14" /> : undefined}
            >
              {issue.labels.length === 0 ? (
                <span className={styles.unset}>Add label</span>
              ) : (
                <span className={styles.chips}>
                  {issue.labels.map((label) => (
                    <LabelChip key={label.id} name={label.name} color={label.color} />
                  ))}
                </span>
              )}
            </Button>
          </div>

          <h3 className={styles.railGroup} id={`${issue.id}-project-label`}>
            Project
          </h3>
          <div className={styles.property}>
            <Button
              {...project.props}
              variant="ghost"
              fullWidth
              className={styles.propertyTrigger}
              aria-describedby={`${issue.id}-project-label`}
              icon={<ProjectGlyph width="14" height="14" />}
            >
              {issue.projectName ?? <span className={styles.unset}>Add to project</span>}
            </Button>
          </div>

          {/* Gated on the issue being in a project, because a milestone is a marker *inside*
              one: with no project there is nothing for the row to name, and the server
              refuses a milestone that crosses projects.

              This row used to be read-only, and the note here used to argue that showing a
              trigger would be promising a control that opens nothing. That was true of the
              row and false of the product: `projectMilestoneId` and `clearMilestone` have
              been on `UpdateIssueInput` all along, so a milestone could be set by the
              importer, by the agent tools and by nothing a person could reach. It opens a
              picker now, and the chord the shortcut reference has promised since it was
              written finally does something. */}
          {issue.projectId === null ? null : (
            <div className={styles.property}>
              <span className={styles.srOnly} id={`${issue.id}-milestone-label`}>
                Milestone
              </span>
              {/* The picker has no filter box, so the tooltip is where the chord can be
                  taught — `filterHint` is a row of a filter this list is better without. */}
              <Tooltip label="Set milestone" keys="shift+m" describe={false}>
                <Button
                  {...milestone.props}
                  variant="ghost"
                  fullWidth
                  className={styles.propertyTrigger}
                  aria-describedby={`${issue.id}-milestone-label`}
                  icon={<MilestoneGlyph width="14" height="14" />}
                >
                  {issue.milestoneName ?? <span className={styles.unset}>No milestone</span>}
                </Button>
              </Tooltip>
            </div>
          )}

          {issue.recurring === null ? null : (
            <div className={styles.property}>
              <span className={styles.srOnly} id={`${issue.id}-repeats-label`}>
                Repeats
              </span>
              {/* It opens the cadence dialog. The date goes through `whenDay`/`exact` like
                  every other date on the page — it was printing the raw ISO day the store
                  holds. `time` inside a button is fine: it is text with a machine-readable
                  day, not a second control. */}
              <Button
                variant="ghost"
                fullWidth
                className={styles.propertyTrigger}
                aria-haspopup="dialog"
                aria-describedby={`${issue.id}-repeats-label`}
                icon={<RepeatGlyph width="14" height="14" />}
                onClick={() => commands.current.editRecurring()}
              >
                <span>
                  {CADENCE_LABELS[issue.recurring.cadence]} · next{' '}
                  <time
                    dateTime={issue.recurring.nextDueDate}
                    title={exact(issue.recurring.nextDueDate)}
                  >
                    {whenDay(issue.recurring.nextDueDate, issue.timezone)}
                  </time>
                </span>
              </Button>
            </div>
          )}

          <p className={styles.provenance}>
            {issue.creatorName === null ? 'Created' : `Created by ${issue.creatorName}`}{' '}
            <time dateTime={issue.createdAt} title={exact(issue.createdAt)}>
              {when(issue.createdAt)}
            </time>
          </p>
        </aside>
      </div>

      <StatusPicker
        open={status.open}
        onClose={status.hide}
        trigger={status.ref}
        teamId={issue.teamId}
        value={issue.stateId}
        placement="bottom-end"
        onSelect={(stateId) => updateIssue(engine, issue.id, { stateId }, viewerId).catch(report)}
      />
      <AssigneePicker
        open={assignee.open}
        onClose={assignee.hide}
        trigger={assignee.ref}
        value={issue.assigneeId}
        placement="bottom-end"
        onSelect={(assigneeId) => updateIssue(engine, issue.id, { assigneeId }).catch(report)}
      />
      <PriorityPicker
        open={priority.open}
        onClose={priority.hide}
        trigger={priority.ref}
        value={issue.priority}
        placement="bottom-end"
        onSelect={(level) => updateIssue(engine, issue.id, { priority: level }).catch(report)}
      />
      <ProjectPicker
        open={project.open}
        onClose={project.hide}
        trigger={project.ref}
        teamIds={[issue.teamId]}
        value={issue.projectId}
        placement="bottom-end"
        onSelect={(projectId) => updateIssue(engine, issue.id, { projectId }).catch(report)}
      />
      <MilestonePicker
        open={milestone.open}
        onClose={milestone.hide}
        trigger={milestone.ref}
        projectId={issue.projectId}
        value={issue.milestoneId}
        placement="bottom-end"
        onSelect={(projectMilestoneId) =>
          updateIssueProperties(engine, issue.id, { projectMilestoneId }).catch(report)
        }
      />
      <CyclePicker
        open={cycle.open}
        onClose={cycle.hide}
        trigger={cycle.ref}
        teamId={issue.teamId}
        value={issue.cycleId}
        placement="bottom-end"
        onSelect={(cycleId) => updateIssue(engine, issue.id, { cycleId }).catch(report)}
      />
      <EstimatePicker
        open={estimate.open}
        onClose={estimate.hide}
        trigger={estimate.ref}
        teamId={issue.teamId}
        value={issue.estimate}
        placement="bottom-end"
        onSelect={(value) =>
          updateIssueProperties(engine, issue.id, { estimate: value }).catch(report)
        }
      />
      <DueDatePicker
        open={due.open}
        onClose={due.hide}
        trigger={due.ref}
        value={issue.dueDate}
        source={issue.dueDateSource}
        timezone={issue.timezone}
        onSelect={(value) =>
          updateIssueProperties(engine, issue.id, { dueDate: value }).catch(report)
        }
        onClearSla={() => clearIssueSla(engine, issue.id).catch(report)}
        onSetSla={(minutes) => setIssueSla(engine, issue.id, minutes).catch(report)}
      />
      <LabelPicker
        open={labels.open}
        onClose={labels.hide}
        trigger={labels.ref}
        teamId={issue.teamId}
        value={issue.labelIds}
        placement="bottom-end"
        onApply={(labelId, displaced) =>
          applyLabel(engine, issue.id, labelId, displaced).catch(report)
        }
        onRemove={(labelId) => removeLabel(engine, issue.id, labelId).catch(report)}
      />
    </div>
  );
}

/**
 * The header's overflow menu: the actions that are not worth a button each.
 *
 * Subscribe leads because it is the one people reach for; delete is last and red because
 * it is the one they must not reach for by accident. Each entry is gated the way its
 * action is — a guest gets no customer request, a recurring issue is not offered
 * "Make recurring" — so the menu never lists something that would refuse.
 */
function moreItems(
  issue: { readonly subscribed: boolean; readonly recurring: unknown },
  viewerId: UUID | null,
  role: UserRole | null,
  run: {
    toggleSubscribe(): void;
    makeRecurring(): void;
    editRecurring(): void;
    stopRecurring(): void;
    addRequest(): void;
    copyModelUuid(): void;
    askDelete(): void;
  },
): MenuNode[] {
  return [
    ...(viewerId === null
      ? []
      : [
          {
            id: 'subscribe',
            label: issue.subscribed ? 'Unsubscribe' : 'Subscribe',
            icon: <BellGlyph />,
            keys: 'shift+s',
            onSelect: run.toggleSubscribe,
          },
        ]),
    // Never both halves: an issue is on a schedule or it is not, and a menu offering to make
    // a recurring issue recurring is a menu that has not read the issue.
    ...(issue.recurring === null
      ? [
          {
            id: 'recurring',
            label: 'Make recurring',
            icon: <RepeatGlyph />,
            onSelect: run.makeRecurring,
          },
        ]
      : [
          {
            id: 'recurring-edit',
            label: 'Edit schedule',
            icon: <RepeatGlyph />,
            onSelect: run.editRecurring,
          },
          {
            id: 'recurring-stop',
            label: 'Stop repeating',
            icon: <RepeatGlyph />,
            danger: true,
            onSelect: run.stopRecurring,
          },
        ]),
    ...(role !== null && role !== 'guest'
      ? [
          {
            id: 'request',
            label: 'Add customer request',
            icon: <CommentGlyph />,
            onSelect: run.addRequest,
          },
        ]
      : []),
    { id: 'uuid', label: 'Copy model UUID', icon: <CopyGlyph />, onSelect: run.copyModelUuid },
    { kind: 'separator' },
    { id: 'delete', label: 'Delete', icon: <BinGlyph />, danger: true, onSelect: run.askDelete },
  ];
}

interface DetailCommands {
  pickStatus(): void;
  pickAssignee(): void;
  pickPriority(): void;
  pickProject(): void;
  pickMilestone(): void;
  pickCycle(): void;
  pickEstimate(): void;
  pickDue(): void;
  pickLabels(): void;
  assignToMe(): void;
  toggleSubscribe(): void;
  focusTitle(): void;
  askDelete(): void;
  makeRecurring(): void;
  editRecurring(): void;
  stopRecurring(): void;
  submitComment(): void;
  copyGitBranch(): void;
  copyModelUuid(): void;
  copyLink(): void;
  copyIdentifier(): void;
  toggleFavourite(): void;
}

// The handle belongs to the shared field now. Re-exported under this screen's name because
// the actions that reach it — `E` to focus, Escape to abandon — are registered here.
export type { TitleHandle };

/**
 * The issue's title field: the shared control with the issue's nouns filled in.
 *
 * Exported because the triage pane mounts the same field beside the issue it is triaging,
 * and because the screen's own Escape action reaches it through the handle.
 */
export function TitleField({
  issueId,
  title,
  handle,
  onSave,
}: {
  issueId: UUID;
  title: string;
  handle?: RefObject<TitleHandle | null> | undefined;
  onSave: (title: string) => void;
}) {
  return (
    <EditableTitle
      subjectId={issueId}
      value={title}
      label="Issue title"
      handle={handle}
      onSave={onSave}
    />
  );
}

/**
 * The activity feed.
 *
 * Fetched rather than replicated, and the milestone is explicit about why: history is
 * curated, permanent and append-only, which is a different thing from the change log that
 * drives sync. Shipping it in the snapshot would put every edit ever made to every issue into
 * the client's IndexedDB to render a panel most people never scroll to.
 *
 * A failed fetch used to render nothing, on the argument that the issue itself is on screen
 * and usable. That was wrong for one specific reason: nothing is exactly what an issue with
 * no history renders too, so an offline load and a brand-new issue were the same picture, and
 * the reader had no way to tell "there is nothing here" from "this did not arrive". A quiet
 * line and a Retry is the smallest thing that distinguishes them, and it is what
 * 08-ui-composition.md asks for.
 *
 * The empty case still renders nothing rather than an `EmptyState`. A history is a footnote to
 * the issue above it, and a card saying "no activity yet" is a louder claim on the page than
 * the thing it is describing.
 */
interface Subscriber {
  readonly id: UUID;
  readonly name: string;
  readonly avatar: string | null;
}

function Activity({
  history,
  status,
  onRetry,
  names,
  subscribed,
  subscribers,
  canSubscribe,
  onToggleSubscribe,
}: {
  history: readonly HistoryEntry[];
  status: 'loading' | 'ready' | 'failed';
  onRetry: () => void;
  names: Record<string, string>;
  subscribed: boolean;
  subscribers: readonly Subscriber[];
  /** False while the session does not know who is reading: nobody to subscribe. */
  canSubscribe: boolean;
  onToggleSubscribe: () => void;
}) {
  // The heading row is always drawn, feed or no feed: it carries the subscribe control and
  // the people watching, which are facts about the issue and not about its history.
  const head = (
    <div className={styles.activityHead}>
      <h2 className={styles.activityTitle}>Activity</h2>
      <div className={styles.spacer} />
      {subscribers.length === 0 ? null : (
        <ul className={styles.subscribers} aria-label="Subscribers">
          {subscribers.map((person) => (
            <li key={person.id} className={styles.subscriber}>
              <Tooltip label={person.name} describe={false}>
                <span className={styles.subscriberAvatar} aria-label={person.name} role="img">
                  <Avatar
                    name={person.name}
                    src={person.avatar}
                    size="xs"
                    colorKey={person.id}
                    decorative
                  />
                </span>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
      {/* The subscribe state had no rendering at all: `Shift+S` toggled it and the only
          feedback was silence. Pressed while watching, so the state is announced as well as
          worded. */}
      {canSubscribe ? (
        <Tooltip
          label={subscribed ? 'Stop watching this issue' : 'Watch this issue'}
          keys="shift+s"
        >
          <Button variant="ghost" size="sm" aria-pressed={subscribed} onClick={onToggleSubscribe}>
            {subscribed ? 'Unsubscribe' : 'Subscribe'}
          </Button>
        </Tooltip>
      ) : null}
    </div>
  );

  if (status === 'failed') {
    return (
      <section className={styles.activity} aria-label="Activity">
        {head}
        <p className={styles.feedFailure} role="status">
          <span>This issue’s history could not be loaded.</span>
          <Button size="sm" variant="ghost" onClick={onRetry}>
            Retry
          </Button>
        </p>
      </section>
    );
  }

  if (status === 'loading' && history.length === 0) {
    return (
      <section className={styles.activity} aria-label="Activity" aria-busy="true">
        {head}
        {/* Three rows: the feed is a footnote, and a skeleton taller than the history it
            stands in for overstates what is coming. */}
        <div className={styles.feedSkeleton}>
          <Skeleton height="var(--space-4)" width="70%" />
          <Skeleton height="var(--space-4)" width="55%" />
          <Skeleton height="var(--space-4)" width="62%" />
        </div>
      </section>
    );
  }

  return (
    <section className={styles.activity} aria-label="Activity">
      {head}
      {history.length === 0 ? null : (
        <ol className={styles.feed}>
          {history.map((entry) => (
            <li key={entry.id} className={styles.event}>
              <span className={styles.eventGlyph}>{eventGlyph(entry.kind)}</span>
              <span className={styles.eventText}>
                <span className={styles.eventActor}>{actorName(entry.actor, names)}</span>{' '}
                {describe(entry, names)}
              </span>
              <time
                className={styles.eventWhen}
                dateTime={entry.createdAt}
                title={exact(entry.createdAt)}
              >
                {when(entry.createdAt)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** The 14px mark in front of a feed row: the property that changed, or a dot. */
function eventGlyph(kind: string) {
  const size = { width: 14, height: 14 };
  switch (kind) {
    case 'created':
      return <PlusGlyph {...size} />;
    case 'title':
    case 'description':
      return <EditGlyph {...size} />;
    case 'label':
      return <TagGlyph {...size} />;
    case 'project':
      return <ProjectGlyph {...size} />;
    case 'cycle':
      return <CycleGlyph {...size} />;
    case 'parent':
      return <SubIssueGlyph {...size} />;
    case 'estimate':
      return <EstimateGlyph {...size} />;
    case 'dueDate':
      return <CalendarGlyph {...size} />;
    case 'relation':
      return <LinkGlyph {...size} />;
    case 'subscribe':
      return <BellGlyph {...size} />;
    case 'deleted':
    case 'archived':
      return <BinGlyph {...size} />;
    default:
      return <DotGlyph {...size} />;
  }
}

interface CommentsProps {
  issueId: UUID;
  identifier: string;
  /** Comments the snapshot did not carry, loaded by the screen. */
  fetched: readonly Comment[];
  names: Record<string, string>;
  viewerId: UUID | null;
  commands: { current: DetailCommands };
  enterSubmits: boolean;
}

/**
 * The conversation.
 *
 * Rendered from the replica, so a posted comment appears under the issue on the same frame
 * and survives a reload made a second later. Anything the snapshot did not carry is merged in
 * from the detail query behind it — the store wins on conflict, because it holds both the
 * server's deltas and the user's own unsent writes and the network response holds neither.
 */
export function Comments({
  issueId,
  identifier,
  fetched,
  names,
  viewerId,
  commands,
  enterSubmits,
}: CommentsProps) {
  const engine = useEngine();
  const viewerRole = useViewerRole();

  const stored = useLiveQuery(
    (store) =>
      [...store.commentIdsFor(issueId)]
        .map((id) => store.get('comment', id))
        .filter((comment): comment is Comment => comment !== undefined),
    ['comment'],
    [issueId],
  );

  // The comments the replica has been told are gone.
  //
  // `fetched` is the answer to one query, made when the screen mounted, and it is never
  // asked again — so every delete that lands afterwards has to be subtracted from it by
  // hand or the merge below hands the comment straight back. This used to be the screen's
  // own memory of the deletes *it* made, which covered the only case anybody had looked
  // at and left two that were reported as a comment coming back from the dead:
  //
  //   - somebody else deletes it. The delta retires the row in the replica and the merge
  //     restores it from `fetched`, for as long as this tab stays open. No reload, no
  //     race, no way back — the server will never mention that row again.
  //   - this tab deletes it and reloads before the server has answered. The new screen
  //     asks for the comments while the delete is still in flight, so `fetched` is
  //     answered with the row still in it; the outbox replays the delete a moment later
  //     and the delta retires a row this store never had. `removed` was empty, because
  //     the tab that did the deleting is gone.
  //
  // Both are the same shape — a read that was answered before a delete it cannot know
  // about — and the replica is the only thing that sees both, so the answer comes from
  // there. `deleteComment` refused by the server puts the row back through `put`, which
  // drops the tombstone, so a refusal is visible instead of looking like a success.
  const removed = useLiveQuery((store) => store.forgottenIds('comment'), ['comment'], []);

  const threads = useMemo(() => thread(stored, fetched, removed), [stored, fetched, removed]);

  const [editing, setEditing] = useState<UUID | null>(null);
  const [deleting, setDeleting] = useState<Comment | null>(null);

  const [drafts, setDrafts] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const draft of readCommentDrafts()) {
      if (draft.issueId !== issueId) continue;
      const key = draft.parentId ?? ROOT;
      initial[key] = draft.body;
    }
    return initial;
  });
  const [focused, setFocused] = useState<string>(ROOT);
  const [replyingTo, setReplyingTo] = useState<UUID | null>(null);
  const [refusal, setRefusal] = useState<{ key: string; message: string } | null>(null);

  /**
   * The drafts as they stand *now*, readable from a callback that has been on the network.
   *
   * `submit` clears the composer before the server has answered, which is right: the comment
   * is on the screen the same frame, so leaving the text in the box as well would show it
   * twice. It is only right as long as a refusal puts it back — and by the time a refusal
   * arrives, `drafts` in that closure is whatever it was when the click happened.
   */
  const live = useRef(drafts);
  const publish = (next: Record<string, string>) => {
    live.current = next;
    setDrafts(next);
  };

  const persist = (key: string, body: string) => {
    publish({ ...live.current, [key]: body });
    // Typing again is the answer to "try again in a moment", so the refusal stops being
    // shown rather than sitting under a box whose contents it no longer describes.
    setRefusal((current) => (current === null || current.key !== key ? current : null));
    writeCommentDraft({
      issueId,
      parentId: key === ROOT ? undefined : key,
      identifier,
      body,
    });
  };

  /**
   * Puts a comment the server would not take back into the box it was typed in.
   *
   * Every refusal used to end at `report`, which writes a line to the console: the composer
   * had already been emptied and the draft already deleted, so the only copy of the sentence
   * was in a closure that was now finished with. The commonest way to hit it needs no server
   * fault at all — reply to a comment posted a moment ago and the parent id is still the one
   * this client invented, which the API correctly refuses.
   *
   * Anything typed since is kept and the refused text goes in front of it, oldest first. The
   * ordinary case is an empty box and a straight restore; the merge exists so that a fast
   * typist starting a second comment cannot be the reason the first one is destroyed.
   */
  const restore = (key: string, typed: string, error: unknown) => {
    const since = live.current[key] ?? '';
    persist(key, since === '' ? typed : `${typed}\n\n${since}`);
    if (key !== ROOT) setReplyingTo(key as UUID);
    setRefusal({
      key,
      message:
        error instanceof ApiError && error.message !== ''
          ? error.message
          : 'That comment could not be posted.',
    });
  };

  const submit = (key: string) => {
    const typed = live.current[key] ?? '';
    const body = maybeExpandEmoticons(typed.trim());
    if (body === '') return;
    setRefusal(null);
    publish({ ...live.current, [key]: '' });
    clearCommentDraft(issueId, key === ROOT ? undefined : key);
    if (key !== ROOT) setReplyingTo(null);
    postComment(engine, {
      issueId,
      body,
      parentId: key === ROOT ? undefined : key,
      authorId: viewerId ?? undefined,
    }).catch((error: unknown) => {
      report(error);
      restore(key, typed, error);
    });
  };

  /**
   * ⌘⏎ belongs to whichever composer has focus. Read through the ref the registered action
   * holds, because that action's `run` was captured when the screen mounted.
   *
   * `focused` is only ever *set*, by a composer's `onFocus`, and there is exactly one way it
   * can end up naming a composer that is no longer rendered: cancelling a reply. Cancel now
   * puts it back on ROOT itself, and this is the second half of the same fix — anything that
   * unmounts a reply composer without going through Cancel would otherwise leave ⌘⏎ posting
   * an abandoned sentence, as a reply, from anywhere on the page.
   */
  commands.current.submitComment = () =>
    submit(focused !== ROOT && replyingTo !== focused ? ROOT : focused);

  /**
   * Follows an open reply composer onto its parent's real id.
   *
   * A comment posted here is drawn under an id this client invented, and that id stops
   * naming anything the moment the server's own row arrives — which is a moment the person
   * replying to it has no way to notice. The composer is keyed on the parent, so without
   * this it simply disappears mid-sentence, taking a half-written reply off the screen and
   * leaving it filed under a parent nothing renders.
   *
   * Re-run on every change to the comments, because that is when a stand-in retires.
   */
  useEffect(() => {
    if (replyingTo === null) return;
    const real = engine.succession(replyingTo);
    if (real === replyingTo) return;
    const body = live.current[replyingTo] ?? '';
    const next = { ...live.current };
    delete next[replyingTo];
    if (body !== '') next[real] = body;
    publish(next);
    setReplyingTo(real);
    setRefusal((current) => {
      if (current === null || current.key !== replyingTo) return current;
      // "Still being saved" was true of the parent and has just stopped being true, so it
      // goes rather than moving across. Any other refusal is about this reply and still
      // stands, so it follows the composer onto the parent's new id.
      return current.message === UNSETTLED_PARENT ? null : { ...current, key: real };
    });
    if (body === '') return;
    clearCommentDraft(issueId, replyingTo);
    writeCommentDraft({ issueId, parentId: real, identifier, body });
    // `stored` is the dependency that matters: it changes when the stand-in is retired.
  }, [engine, replyingTo, stored, issueId, identifier]);

  const composer = (key: string, label: string, autoFocus = false) => (
    <form
      className={styles.composer}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        submit(key);
      }}
    >
      <Textarea
        className={styles.composerField}
        surface="plain"
        label={label}
        hideLabel
        placeholder={label}
        minRows={key === ROOT ? 1 : 2}
        maxRows={16}
        autoFocus={autoFocus}
        value={drafts[key] ?? ''}
        error={refusal !== null && refusal.key === key ? refusal.message : undefined}
        data-submit-chord={enterSubmits ? 'enter' : undefined}
        onFocus={() => setFocused(key)}
        onChange={(event) => persist(key, event.target.value)}
      />
      <div className={styles.composerActions}>
        {/* Ghost, like every other cancel in the product: abandoning a reply is not a second
            command competing with posting it. */}
        {key === ROOT ? null : (
          <Button
            variant="ghost"
            onClick={() => {
              setReplyingTo(null);
              // Focus follows the composer out. Leaving it on the cancelled reply left ⌘⏎
              // posting text nobody could see any more.
              setFocused(ROOT);
            }}
          >
            Cancel
          </Button>
        )}
        <Tooltip label="Post comment" keys={enterSubmits ? 'Enter' : 'mod+Enter'}>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={(drafts[key] ?? '').trim() === ''}
          >
            Comment
          </Button>
        </Tooltip>
      </div>
    </form>
  );

  return (
    // No heading of its own: the conversation is the tail of the activity above it, which is
    // how Linear reads an issue. The section keeps its name for the accessibility tree.
    <section className={styles.comments} aria-label="Comments">
      {threads.length === 0 ? null : (
        <ol className={styles.threads}>
          {threads.map(({ comment, replies }) => {
            // A resolved thread keeps its opening line and folds the rest away. The
            // conversation is settled, so the answers and the reply box are noise on a page
            // somebody is reading for what is still open — and the tick that folded it is
            // the same control that unfolds it.
            const settled = comment.resolvedAt !== undefined;
            return (
              <li key={comment.id} className={styles.thread}>
                <CommentBody
                  comment={comment}
                  names={names}
                  viewerId={viewerId}
                  editing={editing === comment.id}
                  canEdit={mayEdit(comment, viewerId)}
                  canDelete={mayDelete(comment, viewerId, viewerRole)}
                  onResolve={() =>
                    resolveComment(
                      engine,
                      comment.id,
                      comment.resolvedAt === undefined,
                      viewerId ?? undefined,
                    ).catch(report)
                  }
                  onEdit={() => setEditing(comment.id)}
                  onDelete={() => setDeleting(comment)}
                  onDone={() => setEditing(null)}
                />
                {settled || replies.length === 0 ? null : (
                  <ol className={styles.replies}>
                    {replies.map((reply) => (
                      <li key={reply.id}>
                        <CommentBody
                          comment={reply}
                          names={names}
                          viewerId={viewerId}
                          editing={editing === reply.id}
                          canEdit={mayEdit(reply, viewerId)}
                          canDelete={mayDelete(reply, viewerId, viewerRole)}
                          onEdit={() => setEditing(reply.id)}
                          onDelete={() => setDeleting(reply)}
                          onDone={() => setEditing(null)}
                        />
                      </li>
                    ))}
                  </ol>
                )}
                {settled ? null : replyingTo === comment.id ? (
                  composer(comment.id, 'Write a reply', true)
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setReplyingTo(comment.id)}
                    aria-label={`Reply to ${actorName(comment.actor, names)}`}
                  >
                    Reply
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {composer(ROOT, 'Leave a comment')}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this comment?"
        consequence={deleteConsequence(deleting, threads)}
        confirmLabel="Delete comment"
        destructive
        onConfirm={() => {
          const target = deleting;
          setDeleting(null);
          if (target === null) return;
          if (editing === target.id) setEditing(null);
          deleteComment(engine, target.id).catch(report);
        }}
        onClose={() => setDeleting(null)}
      />
    </section>
  );
}

/** Editing is the author's alone: an admin may remove somebody's words, not rewrite them. */
function mayEdit(comment: Comment, viewerId: UUID | null): boolean {
  return viewerId !== null && comment.actor.type === 'user' && comment.actor.id === viewerId;
}

/**
 * Deleting is the author's, plus an admin's.
 *
 * That asymmetry is the server's (`authz.CanEditOwnContent`) and it is deliberate: a comment
 * is visible to the whole team and can be abusive, so somebody has to be able to take it
 * down — but nobody may put different words under another person's name.
 */
function mayDelete(comment: Comment, viewerId: UUID | null, role: UserRole | null): boolean {
  return mayEdit(comment, viewerId) || role === 'admin' || role === 'owner';
}

function deleteConsequence(comment: Comment | null, threads: readonly Thread[]): string {
  const replies = threads.find((t) => t.comment.id === comment?.id)?.replies.length ?? 0;
  const base = 'The comment leaves the issue for everybody, and there is no undo for it.';
  if (replies === 0) return base;
  return `${base} The ${replies === 1 ? 'reply' : `${replies} replies`} to it stay — they are somebody else's words, so they are not yours to take back.`;
}

interface CommentBodyProps {
  readonly comment: Comment;
  readonly names: Record<string, string>;
  /** Whose reactions are the viewer's own. Null until the session knows who is reading. */
  readonly viewerId: UUID | null;
  readonly editing: boolean;
  readonly canEdit: boolean;
  readonly canDelete: boolean;
  /** Absent on a reply: resolving is a decision about a thread, not about one sentence in it. */
  readonly onResolve?: (() => void) | undefined;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly onDone: () => void;
}

function CommentBody({
  comment,
  names,
  viewerId,
  editing,
  canEdit,
  canDelete,
  onResolve,
  onEdit,
  onDelete,
  onDone,
}: CommentBodyProps) {
  const author = actorName(comment.actor, names);
  const resolved = comment.resolvedAt !== undefined;
  return (
    <article
      className={[styles.comment, resolved ? styles.resolved : null].filter(Boolean).join(' ')}
    >
      <div className={styles.commentHead}>
        <Avatar name={author} size="sm" colorKey={comment.actor.id ?? author} decorative />
        <span className={styles.commentAuthor}>{author}</span>
        <time
          className={styles.eventWhen}
          dateTime={comment.createdAt}
          title={exact(comment.createdAt)}
        >
          {when(comment.createdAt)}
        </time>
        {comment.editedAt === undefined ? null : <span className={styles.eventWhen}>edited</span>}
        {/* Named by author and time, because a screen reader hearing "Edit comment" six
            times down a thread cannot tell which one it is on. */}
        {editing ? null : (
          <span className={commentStyles.rowActions}>
            {/* Resolve has been in the mutation layer since M1 — `resolveComment`, with its
                optimistic patch, and `resolvedAt`/`resolvedBy` on the row — and had no
                control anywhere in the product. 02-issues.md asks for it by name. */}
            {onResolve === undefined ? null : (
              <IconButton
                size="sm"
                icon={<TickGlyph />}
                aria-pressed={resolved}
                aria-label={
                  resolved
                    ? `Reopen the thread from ${author}, ${when(comment.createdAt)}`
                    : `Resolve the thread from ${author}, ${when(comment.createdAt)}`
                }
                tooltip={resolved ? 'Reopen thread' : 'Resolve thread'}
                onClick={onResolve}
              />
            )}
            {canEdit && (
              <IconButton
                size="sm"
                icon={<PencilGlyph />}
                aria-label={`Edit comment from ${author}, ${when(comment.createdAt)}`}
                tooltip="Edit comment"
                onClick={onEdit}
              />
            )}
            {canDelete && (
              <IconButton
                size="sm"
                icon={<TrashGlyph />}
                aria-label={`Delete comment from ${author}, ${when(comment.createdAt)}`}
                tooltip="Delete comment"
                onClick={onDelete}
              />
            )}
          </span>
        )}
      </div>
      {resolved ? (
        <p className={styles.resolvedBy}>
          Resolved by{' '}
          {comment.resolvedBy === undefined
            ? 'somebody'
            : (names[comment.resolvedBy] ?? 'somebody')}
        </p>
      ) : null}
      {/* Markdown is shown as it was written. Rendering it is the M2 editor's job, and a
          half-implementation that handled bold but not links would be worse than neither. */}
      {editing ? (
        <CommentEditor comment={comment} onDone={onDone} />
      ) : (
        <>
          <p className={styles.commentBody}>{comment.body}</p>
          {/* Reactions belong to the comment and not to the thread, so a reply carries its
              own row. The subject names which comment, because a thread of six otherwise
              announces six identical controls. */}
          <Reactions
            commentId={comment.id}
            viewerId={viewerId}
            names={names}
            subject={`the comment from ${author}, ${when(comment.createdAt)}`}
          />
        </>
      )}
    </article>
  );
}

/** The resolve tick. Drawn here rather than shared, because nothing else in the product ticks. */
function TickGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M2.5 6.5l2.5 2.5 4.5-5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface IssueActivity {
  readonly history: readonly HistoryEntry[];
  readonly comments: readonly Comment[];
  /** `loading` before the first answer, `failed` when there has not been one. */
  readonly status: 'loading' | 'ready' | 'failed';
  /** Asks again. The Retry button, and nothing else. */
  refresh: () => void;
}

/** How long a burst of edits is allowed to settle before the feed is asked again. */
const REFRESH_DEBOUNCE_MS = 400;

/**
 * Loads the parts of an issue that are not in the replica.
 *
 * Called once for the screen and the result handed down, rather than by each panel that wants
 * it: two hooks asking the same question would put two requests on the wire for one issue
 * every time the route moved.
 *
 * It re-asks when the issue's own `updatedAt` moves, which is the cheapest honest trigger
 * available: every write on this screen goes through `engine.mutate` and stamps it, so
 * changing the status from the rail refreshes the feed that is supposed to be recording the
 * change. Before this the query ran once per route entry, and the panel whose entire purpose
 * is saying what happened to an issue said nothing about anything done to it while it was on
 * screen. Debounced, because dragging a priority through four values is one thought and not
 * four requests.
 *
 * The merge is by id and keeps what is already held. A refresh lands while an optimistic
 * write is still in flight roughly every time somebody edits twice quickly, and replacing the
 * arrays wholesale would take the second edit's row back off the screen until the server
 * agreed with it.
 *
 * A failure is reported rather than swallowed. The `.catch(() => {})` this replaces made an
 * offline load pixel-identical to an issue with no history at all — the blank pane
 * 08-ui-composition.md forbids, in the one client where "empty" and "not here yet" are
 * genuinely different facts.
 */
function useActivity(issueId: UUID | null): IssueActivity {
  const [history, setHistory] = useState<readonly HistoryEntry[]>([]);
  const [comments, setComments] = useState<readonly Comment[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt((n) => n + 1), []);

  const updatedAt = useLiveQuery(
    (store) => (issueId === null ? null : (store.get('issue', issueId)?.updatedAt ?? null)),
    ['issue'],
    [issueId],
  );

  // Trails `updatedAt` by the debounce. Held as state rather than read inside the effect so
  // that the effect below has one dependency that changes once per burst.
  const [settled, setSettled] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(updatedAt), REFRESH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [updatedAt]);

  // Cleared on the way to a different issue, so the previous one's feed is never rendered
  // for a frame under this one's title.
  useEffect(() => {
    setHistory([]);
    setComments([]);
    setStatus('loading');
  }, [issueId]);

  useEffect(() => {
    if (issueId === null) return;
    let live = true;
    const controller = new AbortController();

    void gql<{ comments: Comment[]; issueHistory: HistoryEntry[] }>(
      ISSUE_DETAIL_QUERY,
      { id: issueId },
      { signal: controller.signal },
    )
      .then((data) => {
        if (!live) return;
        setHistory((held) => mergeById(held, data.issueHistory));
        setComments((held) => mergeById(held, data.comments));
        setStatus('ready');
      })
      .catch(() => {
        // Abandoned because the route moved on is not a failure anybody should be told
        // about: the screen this answer belonged to has gone.
        if (live) setStatus((current) => (current === 'ready' ? current : 'failed'));
      });

    return () => {
      live = false;
      controller.abort();
    };
  }, [issueId, settled, attempt]);

  return useMemo(
    () => ({ history, comments, status, refresh }),
    [history, comments, status, refresh],
  );
}

/**
 * Rows already held, plus rows just arrived, newest answer winning per id.
 *
 * Order is the server's, with anything it no longer mentions kept on the end — a comment
 * posted a second ago is in the replica and not yet in this answer, and dropping it would
 * make it blink out of the thread.
 */
function mergeById<T extends { readonly id: UUID }>(held: readonly T[], fresh: readonly T[]): T[] {
  const byId = new Map<UUID, T>();
  for (const row of held) byId.set(row.id, row);
  const out: T[] = [];
  for (const row of fresh) {
    byId.delete(row.id);
    out.push(row);
  }
  return [...out, ...byId.values()];
}

interface Thread {
  readonly comment: Comment;
  readonly replies: readonly Comment[];
}

/**
 * Merges the replicated comments with the fetched ones and arranges them into threads.
 *
 * The store wins on conflict. It carries the server's deltas *and* the user's own unsent
 * writes; the query response carries neither, so preferring it would make a comment posted a
 * moment ago flicker back to its pre-edit text.
 */
function thread(
  stored: readonly Comment[],
  fetched: readonly Comment[],
  removed: ReadonlySet<UUID> = new Set(),
): Thread[] {
  const byId = new Map<UUID, Comment>();
  for (const comment of fetched) byId.set(comment.id, comment);
  for (const comment of stored) byId.set(comment.id, comment);
  for (const id of removed) byId.delete(id);

  const roots: Comment[] = [];
  const replies = new Map<UUID, Comment[]>();
  const inlineIds = new Set<UUID>();
  for (const comment of byId.values()) {
    if (isInlineRoot(comment)) inlineIds.add(comment.id);
  }
  for (const comment of byId.values()) {
    if (
      inlineIds.has(comment.id) ||
      (comment.parentId !== undefined && inlineIds.has(comment.parentId))
    ) {
      continue;
    }
    // A reply whose parent is not here stands on its own rather than disappearing. That
    // happens for real once a comment can be deleted: the opening line of a thread goes and
    // the answers to it remain, and a reply filed under a root nobody renders is a row that
    // exists on the server and nowhere on the screen.
    if (comment.parentId === undefined || !byId.has(comment.parentId)) {
      roots.push(comment);
      continue;
    }
    const bucket = replies.get(comment.parentId);
    if (bucket === undefined) replies.set(comment.parentId, [comment]);
    else bucket.push(comment);
  }

  roots.sort(byCreatedAt);
  return roots.map((comment) => ({
    comment,
    replies: (replies.get(comment.id) ?? []).sort(byCreatedAt),
  }));
}

function byCreatedAt(a: Comment, b: Comment): number {
  return Date.parse(a.createdAt) - Date.parse(b.createdAt);
}

/** The issue an identifier names, found through the team it belongs to rather than by scan. */
function locate(store: Store, identifier: string): UUID | null {
  const dash = identifier.lastIndexOf('-');
  if (dash <= 0) return null;
  const key = identifier.slice(0, dash).toUpperCase();
  const number = Number.parseInt(identifier.slice(dash + 1), 10);
  if (!Number.isInteger(number)) return null;

  const team = [...store.teams.values()].find((candidate) => candidate.key.toUpperCase() === key);
  if (team === undefined) return null;

  // Bounded by the team rather than by the workspace. There is no index on issue number —
  // adding one would cost a map entry per issue to serve one lookup per navigation.
  for (const id of store.index.byTeam(team.id)) {
    const issue = store.issues.get(id);
    if (issue !== undefined && issue.number === number) return id;
  }
  return null;
}

/**
 * The key of the team an identifier names, or null when no team in the replica claims it.
 *
 * Deliberately independent of `locate`: an archived or deleted issue has left the replica
 * while its team has not, and that difference is what tells somebody holding a stale link
 * where to look.
 */
function teamKeyIn(store: Store, identifier: string): string | null {
  const dash = identifier.lastIndexOf('-');
  if (dash <= 0) return null;
  const key = identifier.slice(0, dash).toUpperCase();
  if (!Number.isInteger(Number.parseInt(identifier.slice(dash + 1), 10))) return null;
  const team = [...store.teams.values()].find((candidate) => candidate.key.toUpperCase() === key);
  return team?.key ?? null;
}

function actorName(actor: Actor, names: Record<string, string>): string {
  if (actor.type === 'system') return 'Polaris';
  if (actor.id === undefined) return 'Somebody';
  return names[actor.id] ?? 'Somebody';
}

/**
 * One activity entry as a sentence.
 *
 * The server records status and title changes as their *values* and assignee changes as
 * ids, because a status renamed later should not rewrite what the feed says happened — but a
 * person renamed later should be called by their current name. Resolving one and not the
 * other is that decision showing through.
 */
export function describe(entry: HistoryEntry, names: Record<string, string>): string {
  switch (entry.kind) {
    case 'created':
      return 'created the issue';
    case 'state':
      return `changed status from ${text(entry.fromValue)} to ${text(entry.toValue)}`;
    case 'assignee': {
      const to = entry.toValue === null || entry.toValue === undefined;
      if (to) return `unassigned ${person(entry.fromValue, names)}`;
      return `assigned it to ${person(entry.toValue, names)}`;
    }
    case 'priority':
      return `changed priority from ${level(entry.fromValue)} to ${level(entry.toValue)}`;
    case 'title':
      return `renamed it from “${text(entry.fromValue)}” to “${text(entry.toValue)}”`;
    case 'description':
      return 'edited the description';
    case 'archived':
      return 'archived the issue';
    case 'unarchived':
      return 'restored the issue';
    case 'deleted':
      return 'deleted the issue';
    case 'label': {
      const added = entry.toValue !== null && entry.toValue !== undefined;
      return added
        ? `added the label ${text(entry.toValue)}`
        : `removed the label ${text(entry.fromValue)}`;
    }
    case 'project':
      return movedBetween(entry, 'took it out of the project', 'put it in');
    case 'cycle':
      return movedBetween(entry, 'took it out of the cycle', 'moved it to');
    case 'parent':
      return movedBetween(entry, 'made it a top-level issue', 'made it a sub-issue of');
    case 'estimate': {
      const to = entry.toValue;
      if (to === null || to === undefined) return 'removed the estimate';
      return `estimated it at ${text(String(to))}`;
    }
    case 'dueDate': {
      const to = entry.toValue;
      if (to === null || to === undefined) return 'cleared the due date';
      return `set the due date to ${text(to)}`;
    }
    case 'relation':
      return movedBetween(entry, 'removed a link', 'linked it to');
    case 'subscribe':
      return entry.toValue === false ? 'stopped watching the issue' : 'started watching the issue';
    default:
      // A newer server may record a kind this build has never heard of. Naming it is more
      // useful than dropping the row, which would leave a gap in a permanent record — but
      // the identifier goes in as a sentence rather than raw, so "dueDate" reads "due date"
      // and a future kind nobody here has seen still arrives in English.
      return `changed the ${humanise(entry.kind)}`;
  }
}

/**
 * The three kinds that read as "moved from one thing to another, or off it entirely".
 *
 * They differ only in the words, so they share the shape: a `toValue` of nothing is a
 * removal and says so in its own sentence, because "changed the project to nothing" is a
 * machine describing a person's decision.
 */
function movedBetween(entry: HistoryEntry, cleared: string, moved: string): string {
  const to = entry.toValue;
  if (to === null || to === undefined) return cleared;
  return `${moved} ${text(to)}`;
}

/**
 * A camelCase field name as a person would say it.
 *
 * `dueDate` → `due date`. Only used for a kind this build does not know, so it is a fallback
 * and not a substitute for writing the sentence: the switch above is where a kind gets prose,
 * and this is what keeps the row readable until somebody adds it there.
 */
function humanise(kind: string): string {
  return kind
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : 'nothing';
}

function person(value: unknown, names: Record<string, string>): string {
  return typeof value === 'string' ? (names[value] ?? 'somebody') : 'nobody';
}

function level(value: unknown): string {
  return typeof value === 'number' ? priorityLabel(value).toLowerCase() : 'none';
}
