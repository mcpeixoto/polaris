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
 * The description is a plain markdown textarea, deliberately. The rich editor is M2, and the
 * decision recorded in the milestone is that an issue's body is markdown text rather than a
 * collaborative document — so a textarea is not a placeholder for the real thing here, it is
 * an honest editor for what the field currently holds.
 *
 * Comments thread exactly one level deep. A reply to a reply is a conversation that has
 * outgrown an issue, and unbounded nesting costs a tree walk, an indentation budget and a
 * "collapse" affordance to earn back a shape nobody asked for.
 */

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import {
  Avatar,
  Button,
  EmptyState,
  PriorityIcon,
  priorityLabel,
  StateIcon,
  Textarea,
  Tooltip,
} from '~/components';
import { estimatesEnabled, issueEstimateLabel } from '~/features/estimate';
import {
  archiveIssues,
  postComment,
  report,
  updateIssue,
  updateIssueProperties,
} from '~/features/issue/mutations';
import { AssigneePicker, PriorityPicker, StatusPicker } from '~/features/issue/pickers';
import { DueDatePicker, DueDateValue, EstimatePicker } from '~/features/issue/properties';
import { Relations, SubIssues } from '~/features/issue/relations';
import { browserTimezone } from '~/features/locale';
import { exact, when } from '~/features/time';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useViewerId } from '~/hooks/useViewer';
import { ISSUE_DETAIL_QUERY } from '~/gql/operations';
import type { Actor, Comment, StateCategory, Store, UUID } from '~/store';
import { gql } from '~/sync/api';
import styles from './IssueDetail.module.css';

/** The activity feed's rows, as the API returns them. Not replicated; see `useActivity`. */
interface HistoryEntry {
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

  const issueId = useLiveQuery(
    (store) => locate(store, identifier),
    ['issue', 'team'],
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
        assigneeName: assignee?.displayName ?? null,
        assigneeAvatar: assignee?.avatarUrl ?? null,
        creatorName: creator?.displayName ?? null,
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
      };
    },
    ['issue', 'team', 'user', 'workflowState'],
    [issueId],
  );

  // Loaded once for the screen and handed to both panels below. Two hooks asking the same
  // question would be two requests for one issue every time the route moved.
  const activity = useActivity(issueId);

  const names = useLiveQuery(
    (store) => {
      const out: Record<string, string> = {};
      for (const user of store.users.values()) out[user.id] = user.displayName;
      return out;
    },
    ['user'],
  );

  const status = useMenuTrigger();
  const assignee = useMenuTrigger();
  const priority = useMenuTrigger();
  const estimate = useMenuTrigger();
  const due = useMenuTrigger();

  const commands = useRef<DetailCommands>({
    pickStatus: () => {},
    pickAssignee: () => {},
    pickPriority: () => {},
    archive: () => {},
    submitComment: () => {},
  });

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
        id: 'issueDetail.archive',
        title: 'Archive issue',
        keys: ['e'],
        when: 'detail',
        group: 'Issues',
        run: () => commands.current.archive(),
      },
      {
        id: 'issueDetail.comment',
        title: 'Post comment',
        keys: ['mod+Enter'],
        when: 'detail',
        group: 'Issues',
        // Hidden: it is the submit gesture for whichever composer has focus, which is not a
        // thing anybody searches a command list for.
        hidden: true,
        run: () => commands.current.submitComment(),
      },
    ],
    [],
  );

  if (issue === null) {
    return (
      <div className={styles.screen}>
        <EmptyState
          title="No such issue"
          description={`Nothing in this workspace is called ${identifier}. It may have been deleted, or it may belong to a team you are not in.`}
          action={<Button onClick={() => navigate(-1)}>Go back</Button>}
        />
      </div>
    );
  }

  commands.current.pickStatus = status.show;
  commands.current.pickAssignee = assignee.show;
  commands.current.pickPriority = priority.show;
  commands.current.archive = () => {
    archiveIssues(engine, [issue.id]).catch(report);
    // Archiving drops the issue from the replica, so staying here would leave the user
    // looking at a "no such issue" page they caused. The team's list is where they were.
    void navigate(`/team/${issue.teamKey}`);
  };

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        {/* A link and not a button: it goes somewhere, so it should be announced as a link,
            open in a new tab on a middle click, and be copyable from a context menu. */}
        <Link className={styles.link} to={`/team/${issue.teamKey}`}>
          {issue.teamName}
        </Link>
        <span className={styles.identifier}>{issue.identifier}</span>
        <div className={styles.spacer} />
        <Tooltip label="Archive issue" keys="e">
          <Button onClick={() => commands.current.archive()}>Archive</Button>
        </Tooltip>
      </header>

      <div className={styles.body}>
        <div className={styles.main}>
          <TitleField
            issueId={issue.id}
            title={issue.title}
            onSave={(title) => updateIssue(engine, issue.id, { title }).catch(report)}
          />

          <DescriptionField
            issueId={issue.id}
            description={issue.description}
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

          <Activity history={activity.history} names={names} />

          <Comments
            issueId={issue.id}
            fetched={activity.comments}
            names={names}
            viewerId={viewerId}
            commands={commands}
          />
        </div>

        <aside className={styles.properties} aria-label="Properties">
          <div className={styles.property}>
            <span className={styles.propertyLabel} id={`${issue.id}-status-label`}>
              Status
            </span>
            <Button
              {...status.props}
              fullWidth
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
              fullWidth
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
              fullWidth
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
              <Button {...estimate.props} fullWidth aria-describedby={`${issue.id}-estimate-label`}>
                {issue.estimateLabel ?? 'No estimate'}
              </Button>
            </div>
          )}

          <div className={styles.property}>
            <span className={styles.propertyLabel} id={`${issue.id}-due-label`}>
              Due date
            </span>
            <Button {...due.props} fullWidth aria-describedby={`${issue.id}-due-label`}>
              <DueDateValue
                value={issue.dueDate}
                timezone={issue.timezone}
                source={issue.dueDateSource}
              />
            </Button>
          </div>

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
        onSelect={(stateId) => updateIssue(engine, issue.id, { stateId }).catch(report)}
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
      />
    </div>
  );
}

interface DetailCommands {
  pickStatus(): void;
  pickAssignee(): void;
  pickPriority(): void;
  archive(): void;
  submitComment(): void;
}

/**
 * The title, edited in place.
 *
 * The draft only exists while the field has focus. That is what lets a title changed by
 * somebody else appear here immediately when you are not editing, and lets your own typing
 * survive their change while you are — a controlled input holding a permanent draft would do
 * the first badly and a permanently uncontrolled one would do the second.
 *
 * `key` on the field resets the draft when the route moves to another issue, because a
 * component reused across two issues must not carry the first one's half-typed title into
 * the second.
 */
function TitleField({
  issueId,
  title,
  onSave,
}: {
  issueId: UUID;
  title: string;
  onSave: (title: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    const next = draft?.trim();
    setDraft(null);
    // An empty title is a mistake rather than an intention, so the field reverts to what the
    // issue actually says instead of saving a row with no name.
    if (next === undefined || next === '' || next === title) return;
    onSave(next);
  };

  return (
    <form
      key={issueId}
      className={styles.titleForm}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        // Blurring is what commits, so Enter and clicking away cannot disagree about what
        // was saved.
        event.currentTarget.querySelector('input')?.blur();
      }}
    >
      <input
        className={styles.title}
        aria-label="Issue title"
        value={draft ?? title}
        onFocus={() => setDraft(title)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        autoComplete="off"
        spellCheck
      />
    </form>
  );
}

/** The description. Same draft-while-focused bargain as the title; see there. */
function DescriptionField({
  issueId,
  description,
  onSave,
}: {
  issueId: UUID;
  description: string;
  onSave: (description: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <Textarea
      key={issueId}
      label="Description"
      hideLabel
      placeholder="Add a description…"
      minRows={3}
      maxRows={30}
      value={draft ?? description}
      className={styles.description}
      onFocus={() => setDraft(description)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = draft;
        setDraft(null);
        if (next !== null && next !== description) onSave(next);
      }}
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
 * A failed fetch renders nothing rather than an error. The issue itself is on screen and
 * usable; a red box over the part that did not arrive would suggest the page is broken when
 * only its footnote is.
 */
function Activity({
  history,
  names,
}: {
  history: readonly HistoryEntry[];
  names: Record<string, string>;
}) {
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
  /** Comments the snapshot did not carry, loaded by the screen. */
  fetched: readonly Comment[];
  names: Record<string, string>;
  viewerId: UUID | null;
  commands: { current: DetailCommands };
}

/**
 * The conversation.
 *
 * Rendered from the replica, so a posted comment appears under the issue on the same frame
 * and survives a reload made a second later. Anything the snapshot did not carry is merged in
 * from the detail query behind it — the store wins on conflict, because it holds both the
 * server's deltas and the user's own unsent writes and the network response holds neither.
 */
function Comments({ issueId, fetched, names, viewerId, commands }: CommentsProps) {
  const engine = useEngine();

  const stored = useLiveQuery(
    (store) =>
      [...store.commentIdsFor(issueId)]
        .map((id) => store.get('comment', id))
        .filter((comment): comment is Comment => comment !== undefined),
    ['comment'],
    [issueId],
  );

  const threads = useMemo(() => thread(stored, fetched), [stored, fetched]);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [focused, setFocused] = useState<string>(ROOT);
  const [replyingTo, setReplyingTo] = useState<UUID | null>(null);

  const submit = (key: string) => {
    const body = (drafts[key] ?? '').trim();
    if (body === '') return;
    setDrafts((current) => ({ ...current, [key]: '' }));
    if (key !== ROOT) setReplyingTo(null);
    postComment(engine, {
      issueId,
      body,
      parentId: key === ROOT ? undefined : key,
      authorId: viewerId ?? undefined,
    }).catch(report);
  };

  // ⌘⏎ belongs to whichever composer has focus. Read through the ref the registered action
  // holds, because that action's `run` was captured when the screen mounted.
  commands.current.submitComment = () => submit(focused);

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
        onFocus={() => setFocused(key)}
        onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))}
      />
      <div className={styles.composerActions}>
        {key === ROOT ? null : <Button onClick={() => setReplyingTo(null)}>Cancel</Button>}
        <Tooltip label="Post comment" keys="mod+Enter">
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
          {threads.map(({ comment, replies }) => (
            <li key={comment.id} className={styles.thread}>
              <CommentBody comment={comment} names={names} />
              {replies.length === 0 ? null : (
                <ol className={styles.replies}>
                  {replies.map((reply) => (
                    <li key={reply.id}>
                      <CommentBody comment={reply} names={names} />
                    </li>
                  ))}
                </ol>
              )}
              {replyingTo === comment.id ? (
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
          ))}
        </ol>
      )}

      {composer(ROOT, 'Leave a comment')}
    </section>
  );
}

function CommentBody({ comment, names }: { comment: Comment; names: Record<string, string> }) {
  const author = actorName(comment.actor, names);
  return (
    <article className={styles.comment}>
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
      </div>
      {/* Markdown is shown as it was written. Rendering it is the M2 editor's job, and a
          half-implementation that handled bold but not links would be worse than neither. */}
      <p className={styles.commentBody}>{comment.body}</p>
    </article>
  );
}

interface IssueActivity {
  readonly history: readonly HistoryEntry[];
  readonly comments: readonly Comment[];
}

const NO_ACTIVITY: IssueActivity = { history: [], comments: [] };

/**
 * Loads the parts of an issue that are not in the replica.
 *
 * Called once for the screen and the result handed down, rather than by each panel that wants
 * it: two hooks asking the same question would put two requests on the wire for one issue
 * every time the route moved.
 */
function useActivity(issueId: UUID | null): IssueActivity {
  const [activity, setActivity] = useState<IssueActivity>(NO_ACTIVITY);

  useEffect(() => {
    if (issueId === null) return;
    let live = true;
    const controller = new AbortController();
    setActivity(NO_ACTIVITY);

    void gql<{ comments: Comment[]; issueHistory: HistoryEntry[] }>(
      ISSUE_DETAIL_QUERY,
      { id: issueId },
      { signal: controller.signal },
    )
      .then((data) => {
        if (live) setActivity({ history: data.issueHistory, comments: data.comments });
      })
      .catch(() => {
        // Offline, or the request was abandoned when the route moved on. The replica already
        // holds the recent window, and a feed that is not there yet is not an error.
      });

    return () => {
      live = false;
      controller.abort();
    };
  }, [issueId]);

  return activity;
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
function thread(stored: readonly Comment[], fetched: readonly Comment[]): Thread[] {
  const byId = new Map<UUID, Comment>();
  for (const comment of fetched) byId.set(comment.id, comment);
  for (const comment of stored) byId.set(comment.id, comment);

  const roots: Comment[] = [];
  const replies = new Map<UUID, Comment[]>();
  for (const comment of byId.values()) {
    if (comment.parentId === undefined) {
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
function describe(entry: HistoryEntry, names: Record<string, string>): string {
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
    default:
      // A newer server may record a kind this build has never heard of. Naming it is more
      // useful than dropping the row, which would leave a gap in a permanent record.
      return `changed ${entry.kind}`;
  }
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
