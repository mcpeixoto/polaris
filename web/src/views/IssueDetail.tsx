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
import { useActions, useKeyContext } from '~/app/keymap';
import {
  Avatar,
  Button,
  EmptyState,
  IconButton,
  LabelChip,
  PriorityIcon,
  priorityLabel,
  Skeleton,
  StateIcon,
  Textarea,
  Tooltip,
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
import { applyLabel, removeLabel } from '~/features/labels/mutations';
import { LabelPicker } from '~/features/labels/LabelPicker';
import { AssigneePicker, PriorityPicker, StatusPicker } from '~/features/issue/pickers';
import { CyclePicker } from '~/features/cycles/CyclePicker';
import { ProjectPicker } from '~/features/projects/ProjectPicker';
import { DueDatePicker, DueDateValue, EstimatePicker } from '~/features/issue/properties';
import { Relations, SubIssues } from '~/features/issue/relations';
import { Links } from '~/features/attachments/Links';
import { detectPlatform } from '~/keys';
import { IssueCustomers } from '~/features/customers/IssueCustomers';
import { CreateCustomerRequestModal } from '~/features/customers/CreateCustomerRequestModal';
import { browserTimezone } from '~/features/locale';
import { RecurringDialog } from '~/features/recurring/RecurringDialog';
import {
  CADENCE_LABELS,
  createRecurringIssue,
  propertiesOfIssue,
} from '~/features/recurring/mutations';
import { restoreIssue } from '~/features/trash/mutations';
import { SubscribeBell } from '~/features/subscriptions/SubscribeBell';
import { clearIssueSla, setIssueSla } from '~/features/slas/mutations';
import { offerUndo } from '~/features/undo/UndoToast';
import { exact, when, whenDay } from '~/features/time';
import { copyText, gitBranchNameFor } from '~/features/github/copy';
import { clearCommentDraft, readCommentDrafts, writeCommentDraft } from '~/features/drafts/local';
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
                return rec === undefined
                  ? null
                  : { cadence: rec.cadence, nextDueDate: rec.nextDueDate };
              })(),
        labelIds: [...store.labelIdsFor(found.id)],
        labels: [...store.labelIdsFor(found.id)].flatMap((id) => {
          const label = store.get('label', id);
          return label === undefined
            ? []
            : [{ id: label.id, name: label.name, color: label.color }];
        }),
        milestoneName:
          found.projectMilestoneId === undefined
            ? null
            : (store.get('projectMilestone', found.projectMilestoneId)?.name ??
              'Unknown milestone'),
        subscribed: viewerId !== null && store.subscriberIdsFor(found.id).has(viewerId),
        subscriberNames: [...store.subscriberIdsFor(found.id)].flatMap((id) => {
          const user = store.users.get(id);
          return user === undefined ? [] : [personName(user)];
        }),
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
  const cycle = useMenuTrigger();
  const labels = useMenuTrigger();

  // The title field's own handle: `E` focuses it, Escape abandons an edit in it. Held here
  // because both are registered actions and the registry is above this component.
  const titleRef = useRef<TitleHandle | null>(null);

  const commands = useRef<DetailCommands>({
    pickStatus: () => {},
    pickAssignee: () => {},
    pickPriority: () => {},
    pickProject: () => {},
    pickCycle: () => {},
    pickEstimate: () => {},
    pickDue: () => {},
    pickLabels: () => {},
    assignToMe: () => {},
    toggleSubscribe: () => {},
    focusTitle: () => {},
    askDelete: () => {},
    makeRecurring: () => {},
    submitComment: () => {},
    copyGitBranch: () => {},
    copyModelUuid: () => {},
  });

  // Whether the confirmation is up. Held here rather than inside a component of its own so
  // that the command-menu entry and the button open the same one.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [converting, setConverting] = useState(false);
  const [convertingBusy, setConvertingBusy] = useState(false);
  const [convertingError, setConvertingError] = useState<string | null>(null);
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
      {
        id: 'issueDetail.makeRecurring',
        title: 'Convert into recurring issue',
        when: 'detail',
        group: 'Issues',
        run: () => commands.current.makeRecurring(),
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
    [commentSubmit, viewer, viewerId, issue?.estimatesEnabled],
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
  commands.current.makeRecurring = () => {
    if (issue.recurring !== null) return;
    setConvertingError(null);
    setConverting(true);
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

  return (
    <div className={styles.screen}>
      {/* Both the identifier and the title, because either alone answers half of "which
          issue am I looking at" — the identifier is what people say to each other and the
          title is what it is about. */}
      <h1 className={styles.screenTitle}>
        {issue.identifier} {issue.title}
      </h1>
      <header className={styles.header}>
        {/* A link and not a button: it goes somewhere, so it should be announced as a link,
            open in a new tab on a middle click, and be copyable from a context menu. */}
        <Link className={styles.link} to={`/team/${issue.teamKey}`}>
          {issue.teamName}
        </Link>
        <span className={styles.identifier}>{issue.identifier}</span>
        <div className={styles.spacer} />
        {/* The subscribe state had no rendering at all: `Shift+S` toggled it and the only
            feedback was silence. The same bell the project, initiative and customer screens
            carry, with the one flag an issue has. */}
        {viewerId === null ? null : (
          <SubscribeBell
            menuLabel="Issue notifications"
            flags={[
              {
                id: 'subscribed',
                label: 'Anything happens on this issue',
                on: issue.subscribed,
              },
            ]}
            onToggle={() => commands.current.toggleSubscribe()}
          />
        )}
        {/* Not `danger`: a delete here is recoverable for thirty days and offers an undo the
            moment it happens, and painting it red would say the same thing as revoking a
            credential. The confirmation is where the weight belongs. */}
        <Button onClick={() => commands.current.askDelete()}>Delete</Button>
        {issue.recurring === null ? (
          <Button onClick={() => commands.current.makeRecurring()}>Make recurring</Button>
        ) : null}
      </header>

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
        open={converting}
        title={`Make ${issue.identifier} recurring`}
        description="This issue becomes the first occurrence. Later ones are minted from a snapshot of it, not from a live template."
        initialDueDate={issue.dueDate ?? undefined}
        timezone={issue.timezone}
        busy={convertingBusy}
        error={convertingError}
        onClose={() => {
          if (convertingBusy) return;
          setConverting(false);
          setConvertingError(null);
        }}
        onConfirm={(draft) => {
          const found = engine.store.issues.get(issue.id);
          if (found === undefined) return;
          setConvertingBusy(true);
          setConvertingError(null);
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
              setConvertingBusy(false);
              setConverting(false);
            })
            .catch((failure: unknown) => {
              setConvertingBusy(false);
              setConvertingError(
                failure instanceof ApiError
                  ? failure.message
                  : 'This issue could not be made recurring.',
              );
            });
        }}
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

          <DescriptionEditor
            issueId={issue.id}
            description={issue.description}
            names={names}
            viewerId={viewerId}
            enterSubmits={commentSubmit === 'enter'}
            onSave={(description) => updateIssue(engine, issue.id, { description }).catch(report)}
          />

          {/* Above the history rather than below it: sub-issues and relations are part of
              what this issue *is*, and the history is a record of what has happened to it.
              Somebody scanning the page for "what is blocking this" should not have to read
              past a fortnight of status changes to find out. */}
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

          <Activity
            history={activity.history}
            status={activity.status}
            onRetry={activity.refresh}
            names={names}
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

        <aside className={styles.properties} aria-label="Properties">
          <div className={styles.property}>
            <span className={styles.propertyLabel} id={`${issue.id}-status-label`}>
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
            <span className={styles.propertyLabel} id={`${issue.id}-assignee-label`}>
              Assignee
            </span>
            <Button
              {...assignee.props}
              variant="ghost"
              fullWidth
              className={styles.propertyTrigger}
              aria-describedby={`${issue.id}-assignee-label`}
              icon={
                issue.assigneeName === null ? undefined : (
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
              {issue.assigneeName ?? 'No assignee'}
            </Button>
          </div>

          <div className={styles.property}>
            <span className={styles.propertyLabel} id={`${issue.id}-priority-label`}>
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

          {/* Absent entirely for a team whose scale is `none`, rather than shown disabled: a
              team that has decided not to estimate should not have a permanently empty
              estimate field on every issue reminding them of the decision. */}
          {issue.estimatesEnabled && (
            <div className={styles.property}>
              <span className={styles.propertyLabel} id={`${issue.id}-estimate-label`}>
                Estimate
              </span>
              <Button
                {...estimate.props}
                variant="ghost"
                fullWidth
                className={styles.propertyTrigger}
                aria-describedby={`${issue.id}-estimate-label`}
              >
                {issue.estimateLabel ?? 'No estimate'}
              </Button>
            </div>
          )}

          <div className={styles.property}>
            <span className={styles.propertyLabel} id={`${issue.id}-due-label`}>
              Due date
            </span>
            <Button
              {...due.props}
              variant="ghost"
              fullWidth
              className={styles.propertyTrigger}
              aria-describedby={`${issue.id}-due-label`}
            >
              <DueDateValue
                value={issue.dueDate}
                timezone={issue.timezone}
                source={issue.dueDateSource}
              />
            </Button>
          </div>

          <div className={styles.property}>
            <span className={styles.propertyLabel} id={`${issue.id}-project-label`}>
              Project
            </span>
            <Button
              {...project.props}
              variant="ghost"
              fullWidth
              className={styles.propertyTrigger}
              aria-describedby={`${issue.id}-project-label`}
            >
              {issue.projectName ?? 'No project'}
            </Button>
          </div>

          <div className={styles.property}>
            <span className={styles.propertyLabel} id={`${issue.id}-cycle-label`}>
              Cycle
            </span>
            <Button
              {...cycle.props}
              variant="ghost"
              fullWidth
              className={styles.propertyTrigger}
              aria-describedby={`${issue.id}-cycle-label`}
            >
              {issue.cycleName ?? 'No cycle'}
            </Button>
          </div>

          <div className={styles.property}>
            <span className={styles.propertyLabel} id={`${issue.id}-labels-label`}>
              Labels
            </span>
            <Button
              {...labels.props}
              variant="ghost"
              fullWidth
              className={styles.propertyTrigger}
              aria-describedby={`${issue.id}-labels-label`}
            >
              {issue.labels.length === 0
                ? 'No labels'
                : issue.labels.map((label) => (
                    <LabelChip key={label.id} name={label.name} color={label.color} />
                  ))}
            </Button>
          </div>

          {/* Gated on the issue being in a project, because a milestone is a marker *inside*
              one: with no project there is nothing for the row to name. Read-only, like
              Repeats below it, and wearing the value class rather than the trigger class so
              the rail does not offer an affordance that opens nothing. */}
          {issue.projectId === null ? null : (
            <div className={styles.property}>
              <span className={styles.propertyLabel}>Milestone</span>
              <span className={styles.propertyValue}>{issue.milestoneName ?? 'No milestone'}</span>
            </div>
          )}

          <div className={styles.property}>
            <span className={styles.propertyLabel}>Subscribers</span>
            <span className={styles.propertyValue}>
              {issue.subscriberNames.length === 0 ? 'Nobody' : issue.subscriberNames.join(', ')}
            </span>
          </div>

          {issue.recurring === null ? null : (
            <div className={styles.property}>
              <span className={styles.propertyLabel}>Repeats</span>
              {/* Not `propertyTrigger`: this opens nothing, and trigger styling on a
                  non-interactive element is the row promising a control it does not have.
                  The date goes through `whenDay`/`exact` like every other date on the page —
                  it was printing the raw ISO day the store holds. */}
              <span className={styles.propertyValue}>
                {CADENCE_LABELS[issue.recurring.cadence]} · next{' '}
                <time
                  dateTime={issue.recurring.nextDueDate}
                  title={exact(issue.recurring.nextDueDate)}
                >
                  {whenDay(issue.recurring.nextDueDate, issue.timezone)}
                </time>
              </span>
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

interface DetailCommands {
  pickStatus(): void;
  pickAssignee(): void;
  pickPriority(): void;
  pickProject(): void;
  pickCycle(): void;
  pickEstimate(): void;
  pickDue(): void;
  pickLabels(): void;
  assignToMe(): void;
  toggleSubscribe(): void;
  focusTitle(): void;
  askDelete(): void;
  makeRecurring(): void;
  submitComment(): void;
  copyGitBranch(): void;
  copyModelUuid(): void;
}

/**
 * What the screen can ask of the title field.
 *
 * A handle rather than props, for the reason `DetailCommands` is one: both callers are
 * registered keyboard actions whose `run` was captured when the screen mounted. Escape is
 * registered by the screen rather than by this component because `useActions` needs the
 * provider above it, and the field is rendered on its own in tests.
 */
export interface TitleHandle {
  focus(): void;
  /** Whether an uncommitted draft exists. What makes Escape live, and nothing else. */
  editing(): boolean;
  /** Drops the draft and leaves the field, saving nothing. */
  revert(): void;
}

/**
 * The title, edited in place.
 *
 * The draft only exists while the field has focus. That is what lets a title changed by
 * somebody else appear here immediately when you are not editing, and lets your own typing
 * survive their change while you are — a controlled input holding a permanent draft would do
 * the first badly and a permanently uncontrolled one would do the second.
 *
 * `key` belongs at the *call site*, and this is the whole of the reset. A `key` on the form
 * inside remounts the DOM element and leaves this component's state exactly where it was, so
 * for as long as it was written that way a half-typed title followed the route onto the next
 * issue and the next commit renamed that one.
 *
 * A textarea and not an input. An issue title is a sentence, the reading column is 72
 * characters wide, and a long one scrolled sideways out of sight in a single-line box while
 * the stylesheet's own comment called this "an editable textarea". Enter still commits, so
 * the wrapping is the only thing that changed.
 *
 * The draft is mirrored into a ref because `commit` runs from a blur that can be dispatched
 * between a `setDraft` and the render that follows it — which is exactly what `revert` does.
 * Reading the state there would let Escape save the edit it was pressed to abandon.
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
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);

  const write = (next: string | null) => {
    draftRef.current = next;
    setDraft(next);
  };

  /**
   * The edit in flight, for the exits that are not a blur.
   *
   * Committing on blur is the model and it holds for every way of leaving the field that
   * moves focus first — tabbing out, clicking anywhere else on the page, opening the command
   * menu. It does not hold for the ways that take the whole screen away without focusing
   * anything: the back button, a reload, a closed tab. React drops the input, no blur is
   * ever dispatched, and a renamed issue silently still has its old name. This is the same
   * hole the description had, and the same shape of fix.
   *
   * The save callback is captured at the keystroke rather than read at flush time, so a
   * flush that happens to run during a route change writes this issue's title and not the
   * next one's.
   */
  const flight = useRef<{ text: string; base: string; save: (next: string) => void } | null>(null);

  useEffect(() => {
    const flush = () => {
      const edit = flight.current;
      flight.current = null;
      if (edit === null) return;
      const next = edit.text.trim();
      if (next === '' || next === edit.base) return;
      edit.save(next);
    };
    // `hidden` fires on tab switch and, in every browser that matters, on the way out of the
    // page — while the document is still alive enough to enqueue the write.
    const onHidden = () => {
      if (globalThis.document.visibilityState === 'hidden') flush();
    };
    globalThis.document.addEventListener('visibilitychange', onHidden);
    return () => {
      globalThis.document.removeEventListener('visibilitychange', onHidden);
      flush();
    };
    // Keyed on the issue, so moving between two issues flushes the first one's edit at the
    // moment it stops being on screen rather than carrying it along to whenever the screen
    // is finally left.
  }, [issueId]);

  const commit = () => {
    const next = draftRef.current?.trim();
    write(null);
    flight.current = null;
    // An empty title is a mistake rather than an intention, so the field reverts to what the
    // issue actually says instead of saving a row with no name.
    if (next === undefined || next === '' || next === title) return;
    onSave(next);
  };

  useEffect(() => {
    if (handle === undefined) return;
    handle.current = {
      focus: () => fieldRef.current?.focus(),
      editing: () => draftRef.current !== null,
      revert: () => {
        // Cleared before the blur, because the blur is what calls `commit` and `commit`
        // reads the ref. Doing it the other way round saves the edit Escape abandoned.
        write(null);
        flight.current = null;
        fieldRef.current?.blur();
      },
    };
    return () => {
      handle.current = null;
    };
  }, [handle]);

  return (
    <form
      className={styles.titleForm}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        // Blurring is what commits, so Enter and clicking away cannot disagree about what
        // was saved.
        fieldRef.current?.blur();
      }}
    >
      <Textarea
        ref={fieldRef}
        className={styles.title}
        label="Issue title"
        hideLabel
        minRows={1}
        value={draft ?? title}
        onFocus={() => write(title)}
        onChange={(event) => {
          write(event.target.value);
          flight.current = { text: event.target.value, base: title, save: onSave };
        }}
        onBlur={commit}
        onKeyDown={
          /* keymap-lint-allow: supplies the submit a single-line input gave for free — a
             textarea takes Enter as a newline, and an issue title is one line. */ (event) => {
            if (event.key !== 'Enter' || event.shiftKey) return;
            event.preventDefault();
            event.currentTarget.blur();
          }
        }
        autoComplete="off"
        spellCheck
      />
    </form>
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
function Activity({
  history,
  status,
  onRetry,
  names,
}: {
  history: readonly HistoryEntry[];
  status: 'loading' | 'ready' | 'failed';
  onRetry: () => void;
  names: Record<string, string>;
}) {
  if (status === 'failed') {
    return (
      <section className={styles.activity} aria-label="Activity">
        <h2 className={styles.sectionTitle}>Activity</h2>
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
        <h2 className={styles.sectionTitle}>Activity</h2>
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

  if (history.length === 0) return null;

  return (
    <section className={styles.activity} aria-label="Activity">
      <h2 className={styles.sectionTitle}>Activity</h2>
      <ol className={styles.feed}>
        {history.map((entry) => (
          <li key={entry.id} className={styles.event}>
            <span className={styles.eventText}>
              {actorName(entry.actor, names)} {describe(entry, names)}
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
    </section>
  );
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
        label={label}
        hideLabel
        placeholder={label}
        minRows={2}
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
          <Button type="submit" variant="primary" disabled={(drafts[key] ?? '').trim() === ''}>
            Comment
          </Button>
        </Tooltip>
      </div>
    </form>
  );

  return (
    <section className={styles.comments} aria-label="Comments">
      <h2 className={styles.sectionTitle}>Comments</h2>

      {threads.length === 0 ? (
        <p className={styles.quiet}>Nobody has said anything yet.</p>
      ) : (
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
        <p className={styles.commentBody}>{comment.body}</p>
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
