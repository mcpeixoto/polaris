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
 *
 * The one thing it does rather than shows is **reply**. A mention is a question, and until
 * this box existed answering one meant leaving the inbox for the issue page and finding the
 * way back — which is the single move that turns an inbox into somewhere people stop
 * working. The composer posts through `postComment` like every other comment in the product,
 * so a reply from here is a comment on the issue and nothing else; there is no inbox-shaped
 * kind of reply, and inventing one would be a second conversation nobody reads.
 */

import { useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions } from '~/app/keymap';
import {
  Avatar,
  Button,
  EmptyState,
  Kbd,
  LabelChip,
  PriorityIcon,
  priorityLabel,
  PropertyTrigger,
  StateIcon,
  Textarea,
} from '~/components';
import composer from '~/features/issue/CommentEditor.module.css';
import { ProjectGlyph, TagGlyph, UnassignedGlyph } from '~/features/issue/glyphs';
import { postComment, report, updateIssue } from '~/features/issue/mutations';
import { AssigneePicker, PriorityPicker, StatusPicker } from '~/features/issue/pickers';
import { LabelPicker } from '~/features/labels/LabelPicker';
import { applyLabel, removeLabel } from '~/features/labels/mutations';
import { Markdown } from '~/features/markdown/Markdown';
import { ProjectPicker } from '~/features/projects/ProjectPicker';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useViewerId } from '~/hooks/useViewer';
import type { StateCategory, Store, UUID } from '~/store';
import { ApiError } from '~/sync/api';
import styles from './InboxDetail.module.css';

export interface InboxDetailProps {
  /** The issue to show, or nothing — in which case the pane says how much is unread. */
  issueId: UUID | null;
  unread: number;
}

export function InboxDetail({ issueId, unread }: InboxDetailProps) {
  const navigate = useNavigate();
  const engine = useEngine();
  const viewerId = useViewerId();
  const issue = useLiveQuery(
    (store) => (issueId === null ? null : readDetail(store, issueId)),
    ['issue', 'team', 'user', 'workflowState', 'label', 'issueLabel', 'project'],
    [issueId ?? ''],
  );

  const status = useMenuTrigger();
  const assignee = useMenuTrigger();
  const priority = useMenuTrigger();
  const project = useMenuTrigger();
  const labels = useMenuTrigger();

  // The registry captures an action's `run` once, at registration, so the five below call
  // through a ref that this render rewrites rather than closing over this render's `show`.
  // The same arrangement the issue screen's rail uses, and for the same reason.
  const commands = useRef<PaneCommands>({
    pickStatus: () => {},
    pickAssignee: () => {},
    pickPriority: () => {},
    pickProject: () => {},
    pickLabels: () => {},
  });
  commands.current.pickStatus = status.show;
  commands.current.pickAssignee = assignee.show;
  commands.current.pickPriority = priority.show;
  commands.current.pickProject = project.show;
  commands.current.pickLabels = labels.show;

  /*
   * The five property chords, in the inbox's own `list` context.
   *
   * `Inbox` binds J K ↓ ↑ ⏎ U E H ⌫ ⇧⌫ ⌥U ⇧E ] [ X ⇧↓ ⇧↑ ⌘A Escape ⌘F there and nothing
   * else mounts a `list` context on this route, so S, A, P, ⇧P and L are free and are the
   * same five letters they are on every other surface that shows an issue.
   *
   * There is deliberately **no estimate row and no ⇧E**: ⇧E is `inbox.markAllRead`, and a
   * property whose only affordance was a pointer would be the one such property in the
   * product. The issue page still estimates, one ⏎ away.
   *
   * Guarded on the selection rather than registered conditionally, because the pane is
   * mounted for the whole life of the screen and an empty cursor is a moment, not a
   * capability the inbox lacks — the help overlay should still list all five.
   */
  useActions(
    [
      {
        id: 'inboxDetail.status',
        title: 'Change status',
        keys: ['s'],
        when: 'list',
        group: 'Issues',
        enabled: () => issueId !== null,
        run: () => commands.current.pickStatus(),
      },
      {
        id: 'inboxDetail.assign',
        title: 'Assign to…',
        keys: ['a'],
        when: 'list',
        group: 'Issues',
        enabled: () => issueId !== null,
        run: () => commands.current.pickAssignee(),
      },
      {
        id: 'inboxDetail.priority',
        title: 'Set priority',
        keys: ['p'],
        when: 'list',
        group: 'Issues',
        enabled: () => issueId !== null,
        run: () => commands.current.pickPriority(),
      },
      {
        id: 'inboxDetail.project',
        title: 'Set project',
        keys: ['shift+p'],
        when: 'list',
        group: 'Issues',
        enabled: () => issueId !== null,
        run: () => commands.current.pickProject(),
      },
      {
        id: 'inboxDetail.labels',
        title: 'Add label',
        keys: ['l'],
        when: 'list',
        group: 'Issues',
        enabled: () => issueId !== null,
        run: () => commands.current.pickLabels(),
      },
    ],
    [],
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
          <Reply issueId={issueId} identifier={issue.identifier} />
        </div>

        <aside className={styles.rail} aria-label="Properties">
          <h3 className={styles.railHeading}>Properties</h3>
          {/* Every value is the control that changes it. The `dt` beside it already names
              the property, so the button's accessible name is the value alone — "In
              Progress", "No project" — and there is no sr-only span to add: a description
              list supplies for free the half a bare list row has to invent. */}
          <dl className={styles.properties}>
            <Property label="Status">
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
            </Property>
            <Property label="Priority">
              <PropertyTrigger
                name={priorityLabel(issue.priority)}
                action="Set priority"
                keys="p"
                open={priority.open}
                onOpen={priority.showFrom}
                ref={priority.props.ref}
              >
                <PriorityIcon priority={issue.priority} decorative />
              </PropertyTrigger>
              {priorityLabel(issue.priority)}
            </Property>
            <Property label="Assignee">
              <PropertyTrigger
                name={issue.assigneeName ?? 'No assignee'}
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
              {issue.assigneeName === null ? (
                <span className={styles.unset}>No assignee</span>
              ) : (
                issue.assigneeName
              )}
            </Property>
            {/* Project and Labels are drawn whether or not they are set. Hiding an empty row
                hid the only way to fill it, which made "file this into a project" the one
                edit that needed the issue page. */}
            <Property label="Project">
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
            </Property>
            <Property label="Labels">
              <PropertyTrigger
                name={labelSummary(issue.labels)}
                action="Add label"
                keys="l"
                open={labels.open}
                onOpen={labels.showFrom}
                ref={labels.props.ref}
              >
                <TagGlyph />
              </PropertyTrigger>
              {issue.labels.length === 0 ? (
                <span className={styles.unset}>No labels</span>
              ) : (
                <span className={styles.labels}>
                  {issue.labels.map((label) => (
                    <LabelChip key={label.id} compact name={label.name} color={label.color} />
                  ))}
                </span>
              )}
            </Property>
          </dl>
        </aside>
      </div>

      {/* A second set of pickers, deliberately: the inbox list mounts its own row-anchored
          set for the right-click path, and both act on the same issue — the context handler
          moves the cursor first, so the right-clicked row is the cursor row is this pane's
          issue. Collapsing them means rewriting the list's `handingOver` / `returnToList`
          hand-off, which is a larger change than either menu is worth. Worth doing; not
          worth doing here. */}
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
    </article>
  );
}

/** What the registered chords call, rewritten on every render. See `commands` above. */
interface PaneCommands {
  pickStatus: () => void;
  pickAssignee: () => void;
  pickPriority: () => void;
  pickProject: () => void;
  pickLabels: () => void;
}

/** The labels as one accessible name, because that is the value the trigger stands for. */
function labelSummary(labels: readonly { name: string }[]): string {
  return labels.length === 0 ? 'No labels' : labels.map((label) => label.name).join(', ');
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

/**
 * The reply box, which is the whole of what this pane can write.
 *
 * It borrows `CommentEditor`'s stylesheet rather than its component: that form edits a
 * comment that already exists and posts nothing, and the two share a shape — a growing box
 * with Cancel and a primary button under it — that the issue page already draws this way.
 * Copying the stylesheet is how the third composer in the product stays the same object as
 * the first two.
 *
 * Keyed by issue at the call site is not needed — the state below is cleared on a successful
 * post and the pane follows the cursor, so a half-written reply survives moving the cursor
 * away and back, which is the behaviour anybody who has been interrupted expects.
 */
function Reply({ issueId, identifier }: { issueId: UUID; identifier: string }) {
  const engine = useEngine();
  const viewerId = useViewerId();
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const text = body.trim();
    if (posting || text === '') return;
    setPosting(true);
    setError(null);
    try {
      await postComment(engine, {
        issueId,
        body: text,
        ...(viewerId === null ? null : { authorId: viewerId }),
      });
      setBody('');
    } catch (failure) {
      report(failure);
      setError(
        failure instanceof ApiError && failure.message !== ''
          ? failure.message
          : 'That reply could not be posted.',
      );
    } finally {
      setPosting(false);
    }
  };

  // ⌘⏎ is intercepted here rather than registered, for the reason CommentEditor states at
  // length: the chord reaches the registry from inside a text field, and the inbox's own
  // `Enter` opens the notification under the cursor — so a reply posted with the keyboard
  // would navigate away from the pane it was typed in.
  //
  // keymap-lint-allow: a trap around an open composer, intercepting ⌘⏎ before the list sees it
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      void send();
    }
  };

  return (
    <form
      className={composer.form}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void send();
      }}
    >
      <Textarea
        label={`Reply to ${identifier}`}
        hideLabel
        minRows={2}
        maxRows={12}
        placeholder="Reply…"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        // keymap-lint-allow: see onKeyDown above — a trap, not a shortcut
        onKeyDown={onKeyDown}
      />
      {error === null ? null : (
        <p className={composer.error} role="alert">
          {error}
        </p>
      )}
      <div className={composer.actions}>
        <Button type="submit" variant="primary" size="sm" disabled={posting || body.trim() === ''}>
          Reply
        </Button>
      </div>
    </form>
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
  readonly id: UUID;
  readonly teamId: UUID;
  readonly identifier: string;
  readonly title: string;
  readonly description: string;
  readonly stateId: UUID;
  readonly stateName: string;
  readonly stateCategory: StateCategory;
  readonly stateColor: string | undefined;
  readonly priority: number;
  readonly assigneeId: UUID | null;
  readonly assigneeName: string | null;
  readonly assigneeAvatar: string | null;
  readonly projectId: UUID | null;
  readonly projectName: string | null;
  /** Every label on the issue, which is what the picker ticks against. */
  readonly labelIds: readonly UUID[];
  /** The ones the rail draws: no groups, nothing archived, in name order. */
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
    id: found.id,
    teamId: found.teamId,
    identifier: store.identifierOf(found),
    title: found.title,
    description: found.description,
    stateId: found.stateId,
    stateName: state?.name ?? 'No status',
    stateCategory: state?.category ?? 'backlog',
    stateColor: state?.color,
    priority: found.priority,
    assigneeId: found.assigneeId ?? null,
    assigneeName: assignee?.displayName ?? null,
    assigneeAvatar: assignee?.avatarUrl ?? null,
    projectId: found.projectId ?? null,
    projectName:
      found.projectId === undefined ? null : (store.projects.get(found.projectId)?.name ?? null),
    labelIds: [...store.labelIdsFor(found.id)],
    labels,
  };
}
