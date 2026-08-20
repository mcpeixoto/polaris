import {
  CLIENT_SCHEMA,
  dropStaleDatabases,
  PolarisDB,
  type EntityRef,
  type EntityRow,
  type Meta,
  type Snapshot,
  type WriteBatch,
} from './db';
import {
  IssueIndex,
  LabelIndex,
  NotificationIndex,
  ProjectLabelIndex,
  RelationIndex,
  SetIndex,
} from './indexes';
import type { OptimisticPatch } from './outbox';
import { queryIssues, type IssueQuery, type IssueQueryResult } from './query';
import {
  ENTITY_TYPES,
  isEntityType,
  issueIdentifier,
  type Change,
  type Comment,
  type Attachment,
  type Document,
  type Cycle,
  type Customer,
  type CustomerRequest,
  type SlaRule,
  type Dashboard,
  type DashboardTile,
  type Entity,
  type EntityOf,
  type EntityType,
  type Favorite,
  type GitHubConnection,
  type GitHubUserLink,
  type Issue,
  type IssueLabel,
  type IssueRelation,
  type IssueSubscription,
  type IssueTemplate,
  type FormTemplate,
  type FormTemplateField,
  type AskForm,
  type ProjectTemplate,
  type ProjectTemplateMilestone,
  type ProjectTemplateIssue,
  type Initiative,
  type InitiativeProject,
  type ProjectUpdate,
  type ProjectDependency,
  type ProjectLabel,
  type ProjectLabelLink,
  type Label,
  type Notification,
  type Project,
  type ProjectMember,
  type ProjectMilestone,
  type ProjectStatus,
  type ProjectTeam,
  type RecurringIssue,
  type Team,
  type TeamMembership,
  type Timestamp,
  type User,
  type UUID,
  type View,
  type ViewPreference,
  type ViewSubscription,
  type WorkflowState,
  type Workspace,
} from './types';

/**
 * The in-memory replica: the only thing any view ever reads.
 *
 * The hot read path never touches the network and never touches IndexedDB. A filtered,
 * grouped list re-renders out of these maps and the indexes beside them; the socket
 * feeds them and IndexedDB backs them up, and both of those are write paths. That
 * separation is the reason a keystroke can re-render inside a frame — there is nothing
 * asynchronous between the user pressing a key and the list changing.
 *
 * Views subscribe to *query results*, not to the network and not to entities. A list
 * that subscribed to "issues" would re-render for every comment posted anywhere in the
 * workspace; subscribing to the ids its query returns means it re-renders when its
 * answer changes and at no other time.
 */

export interface StoreOptions {
  /** Omit for a store with no durable backing — the shape used by tests and previews. */
  readonly db?: PolarisDB | null | undefined;
  /**
   * Where a failed durable write goes. The default rethrows asynchronously so the error
   * reaches the window's reporter intact while the write queue survives: losing one
   * batch to disk is bad, losing the queue means every later batch is lost too.
   */
  readonly onPersistError?: ((error: unknown) => void) | undefined;
}

/**
 * A view's standing question and what to do when the answer changes.
 *
 * `deps` is the cheap gate and result equality is the precise one. Without `deps`, a
 * comment arriving re-runs every open list's selector; without the equality check, a
 * selector that returns the same ids still re-renders the list. Both are needed: one
 * bounds the work, the other bounds the renders.
 */
export interface Subscription<R> {
  readonly select: (store: Store) => R;
  readonly onChange: (result: R) => void;
  /** Entity types the answer can depend on. Omitted means "anything". */
  readonly deps?: readonly EntityType[] | undefined;
  readonly equals?: ((a: R, b: R) => boolean) | undefined;
}

interface Subscriber {
  readonly select: (store: Store) => unknown;
  readonly onChange: (result: unknown) => void;
  readonly equals: (a: unknown, b: unknown) => boolean;
  readonly deps: ReadonlySet<EntityType> | null;
  last: unknown;
}

/**
 * Structural equality for query results.
 *
 * Results are ids, arrays of ids and groups of ids — plain, acyclic, shallow data — so a
 * recursive walk is both correct and cheap: comparing five thousand ids costs five
 * thousand `Object.is` calls, which is nothing next to the render it prevents. A
 * selector returning anything richer should bring its own `equals`.
 */
export function sameResult(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!sameResult(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length) return false;
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
      if (!sameResult(left[key], right[key])) return false;
    }
    return true;
  }
  return false;
}

export class Store {
  readonly workspaceId: UUID;

  private readonly tables: Record<EntityType, Map<UUID, Entity>> = {
    workspace: new Map(),
    user: new Map(),
    githubConnection: new Map(),
    githubUserLink: new Map(),
    team: new Map(),
    teamMembership: new Map(),
    workflowState: new Map(),
    customer: new Map(),
    slaRule: new Map(),
    dashboard: new Map(),
    dashboardTile: new Map(),
    label: new Map(),
    issueTemplate: new Map(),
    formTemplate: new Map(),
    formTemplateField: new Map(),
    askForm: new Map(),
    projectTemplate: new Map(),
    projectTemplateMilestone: new Map(),
    projectTemplateIssue: new Map(),
    projectStatus: new Map(),
    project: new Map(),
    projectTeam: new Map(),
    projectMember: new Map(),
    projectMilestone: new Map(),
    initiative: new Map(),
    initiativeProject: new Map(),
    projectUpdate: new Map(),
    projectDependency: new Map(),
    projectLabel: new Map(),
    projectLabelLink: new Map(),
    cycle: new Map(),
    recurringIssue: new Map(),
    issue: new Map(),
    customerRequest: new Map(),
    issueLabel: new Map(),
    issueRelation: new Map(),
    attachment: new Map(),
    document: new Map(),
    comment: new Map(),
    issueSubscription: new Map(),
    notification: new Map(),
    view: new Map(),
    viewSubscription: new Map(),
    viewPreference: new Map(),
    favorite: new Map(),
  };

  /** The issue indexes. Public because `query.ts` reads through them on every keystroke. */
  readonly index = new IssueIndex();

  /** Public for the same reason: a filtered list resolves every row's labels per frame. */
  readonly labelIndex = new LabelIndex();
  readonly projectLabelIndex = new ProjectLabelIndex();
  readonly relationIndex = new RelationIndex();
  readonly notificationIndex = new NotificationIndex();

  private readonly commentIssue = new SetIndex<UUID>();
  private readonly attachmentIssue = new SetIndex<UUID>();
  private readonly documentTeam = new SetIndex<UUID>();
  private readonly documentProject = new SetIndex<UUID>();
  private readonly stateTeam = new SetIndex<UUID>();
  private readonly membershipTeam = new SetIndex<UUID>();
  private readonly membershipUser = new SetIndex<UUID>();
  /**
   * The team-scoped halves of the three entities that can also belong to the whole
   * workspace. A workspace-scoped label has no bucket here, which is deliberate: it is
   * offered in every team, so a picker unions this with the ones that have no `teamId`
   * rather than asking the index a question it cannot answer.
   */
  private readonly labelTeam = new SetIndex<UUID>();
  private readonly templateTeam = new SetIndex<UUID>();
  private readonly formTemplateTeam = new SetIndex<UUID>();
  private readonly formTemplateFieldOf = new SetIndex<UUID>();
  private readonly askFormTeam = new SetIndex<UUID>();
  private readonly projectTemplateTeam = new SetIndex<UUID>();
  private readonly projectTemplateMilestoneOf = new SetIndex<UUID>();
  private readonly projectTemplateIssueOf = new SetIndex<UUID>();
  private readonly viewTeam = new SetIndex<UUID>();
  private readonly viewProject = new SetIndex<UUID>();
  private readonly viewSubscriptionOf = new SetIndex<UUID>();
  /** Keyed by user and view together; see `viewSubKey`. */
  private readonly viewSubscriptionByUserView = new Map<string, UUID>();
  private readonly subscriptionIssue = new SetIndex<UUID>();
  private readonly subscriptionUser = new SetIndex<UUID>();
  /**
   * Who is actually subscribed to each issue, users rather than rows, with the
   * explicitly-unsubscribed left out. The filter grammar's `subscriber` field reads this
   * per issue on every keystroke, and resolving rows through the table to answer it would
   * be the scan the indexes exist to remove.
   */
  private readonly subscriberUsers = new SetIndex<UUID>();
  private readonly favoriteTarget = new SetIndex<UUID>();
  private readonly projectTeamOf = new SetIndex<UUID>();
  private readonly projectMemberOf = new SetIndex<UUID>();
  private readonly projectMilestoneOf = new SetIndex<UUID>();
  private readonly initiativeProjectOf = new SetIndex<UUID>();
  private readonly projectUpdateOf = new SetIndex<UUID>();
  private readonly projectDependencyBlockingOf = new SetIndex<UUID>();
  private readonly projectDependencyBlockedByOf = new SetIndex<UUID>();
  private readonly cycleTeam = new SetIndex<UUID>();
  private readonly recurringTeam = new SetIndex<UUID>();
  private readonly customerRequestCustomer = new SetIndex<UUID>();
  private readonly customerRequestIssue = new SetIndex<UUID>();
  private readonly customerRequestProject = new SetIndex<UUID>();
  private readonly dashboardTileOf = new SetIndex<UUID>();
  /** Keyed by user and view key together; see `preferenceKey`. */
  private readonly preferenceKeys = new Map<string, UUID>();

  private readonly subscribers = new Set<Subscriber>();
  private readonly db: PolarisDB | null;
  private readonly onPersistError: (error: unknown) => void;
  private persistQueue: Promise<void> = Promise.resolve();

  private currentVersion = 0;
  private bootstrappedAt: Timestamp | null = null;

  constructor(workspaceId: UUID, options: StoreOptions = {}) {
    this.workspaceId = workspaceId;
    this.db = options.db ?? null;
    this.onPersistError =
      options.onPersistError ??
      ((error) => {
        queueMicrotask(() => {
          const failure = new Error('local replica write failed');
          (failure as Error & { cause?: unknown }).cause = error;
          throw failure;
        });
      });
  }

  /**
   * Opens the replica and hydrates from disk.
   *
   * A replica whose bootstrap never finished hydrates as empty rather than as itself:
   * half a snapshot renders as a workspace with missing teams, which looks like data
   * loss and is indistinguishable from it until the next full sync.
   */
  static async open(workspaceId: UUID, options: StoreOptions = {}): Promise<Store> {
    const db = options.db ?? (await PolarisDB.open(workspaceId));
    await dropStaleDatabases(workspaceId);
    const store = new Store(workspaceId, { ...options, db });
    store.hydrate(await db.readAll());
    return store;
  }

  /** The workspace version this replica is complete up to — what a reconnect resumes from. */
  get version(): number {
    return this.currentVersion;
  }

  /** False until a snapshot has completed; the caller must bootstrap before rendering. */
  get bootstrapped(): boolean {
    return this.bootstrappedAt !== null;
  }

  get workspaces(): ReadonlyMap<UUID, Workspace> {
    return this.tables.workspace as ReadonlyMap<UUID, Workspace>;
  }

  get users(): ReadonlyMap<UUID, User> {
    return this.tables.user as ReadonlyMap<UUID, User>;
  }

  get githubConnections(): ReadonlyMap<UUID, GitHubConnection> {
    return this.tables.githubConnection as ReadonlyMap<UUID, GitHubConnection>;
  }

  get githubUserLinks(): ReadonlyMap<UUID, GitHubUserLink> {
    return this.tables.githubUserLink as ReadonlyMap<UUID, GitHubUserLink>;
  }

  get teams(): ReadonlyMap<UUID, Team> {
    return this.tables.team as ReadonlyMap<UUID, Team>;
  }

  get teamMemberships(): ReadonlyMap<UUID, TeamMembership> {
    return this.tables.teamMembership as ReadonlyMap<UUID, TeamMembership>;
  }

  get workflowStates(): ReadonlyMap<UUID, WorkflowState> {
    return this.tables.workflowState as ReadonlyMap<UUID, WorkflowState>;
  }

  get issues(): ReadonlyMap<UUID, Issue> {
    return this.tables.issue as ReadonlyMap<UUID, Issue>;
  }

  get comments(): ReadonlyMap<UUID, Comment> {
    return this.tables.comment as ReadonlyMap<UUID, Comment>;
  }

  get attachments(): ReadonlyMap<UUID, Attachment> {
    return this.tables.attachment as ReadonlyMap<UUID, Attachment>;
  }

  get documents(): ReadonlyMap<UUID, Document> {
    return this.tables.document as ReadonlyMap<UUID, Document>;
  }

  get labels(): ReadonlyMap<UUID, Label> {
    return this.tables.label as ReadonlyMap<UUID, Label>;
  }

  get issueTemplates(): ReadonlyMap<UUID, IssueTemplate> {
    return this.tables.issueTemplate as ReadonlyMap<UUID, IssueTemplate>;
  }

  get formTemplates(): ReadonlyMap<UUID, FormTemplate> {
    return this.tables.formTemplate as ReadonlyMap<UUID, FormTemplate>;
  }

  get formTemplateFields(): ReadonlyMap<UUID, FormTemplateField> {
    return this.tables.formTemplateField as ReadonlyMap<UUID, FormTemplateField>;
  }

  get askForms(): ReadonlyMap<UUID, AskForm> {
    return this.tables.askForm as ReadonlyMap<UUID, AskForm>;
  }

  get projectTemplates(): ReadonlyMap<UUID, ProjectTemplate> {
    return this.tables.projectTemplate as ReadonlyMap<UUID, ProjectTemplate>;
  }

  get projectTemplateMilestones(): ReadonlyMap<UUID, ProjectTemplateMilestone> {
    return this.tables.projectTemplateMilestone as ReadonlyMap<UUID, ProjectTemplateMilestone>;
  }

  get projectTemplateIssues(): ReadonlyMap<UUID, ProjectTemplateIssue> {
    return this.tables.projectTemplateIssue as ReadonlyMap<UUID, ProjectTemplateIssue>;
  }

  get projectStatuses(): ReadonlyMap<UUID, ProjectStatus> {
    return this.tables.projectStatus as ReadonlyMap<UUID, ProjectStatus>;
  }

  get projects(): ReadonlyMap<UUID, Project> {
    return this.tables.project as ReadonlyMap<UUID, Project>;
  }

  get projectTeams(): ReadonlyMap<UUID, ProjectTeam> {
    return this.tables.projectTeam as ReadonlyMap<UUID, ProjectTeam>;
  }

  get projectMembers(): ReadonlyMap<UUID, ProjectMember> {
    return this.tables.projectMember as ReadonlyMap<UUID, ProjectMember>;
  }

  get projectMilestones(): ReadonlyMap<UUID, ProjectMilestone> {
    return this.tables.projectMilestone as ReadonlyMap<UUID, ProjectMilestone>;
  }

  get initiatives(): ReadonlyMap<UUID, Initiative> {
    return this.tables.initiative as ReadonlyMap<UUID, Initiative>;
  }

  get initiativeProjects(): ReadonlyMap<UUID, InitiativeProject> {
    return this.tables.initiativeProject as ReadonlyMap<UUID, InitiativeProject>;
  }

  get projectUpdates(): ReadonlyMap<UUID, ProjectUpdate> {
    return this.tables.projectUpdate as ReadonlyMap<UUID, ProjectUpdate>;
  }

  get projectDependencies(): ReadonlyMap<UUID, ProjectDependency> {
    return this.tables.projectDependency as ReadonlyMap<UUID, ProjectDependency>;
  }

  get projectLabels(): ReadonlyMap<UUID, ProjectLabel> {
    return this.tables.projectLabel as ReadonlyMap<UUID, ProjectLabel>;
  }

  get projectLabelLinks(): ReadonlyMap<UUID, ProjectLabelLink> {
    return this.tables.projectLabelLink as ReadonlyMap<UUID, ProjectLabelLink>;
  }

  get cycles(): ReadonlyMap<UUID, Cycle> {
    return this.tables.cycle as ReadonlyMap<UUID, Cycle>;
  }

  get customers(): ReadonlyMap<UUID, Customer> {
    return this.tables.customer as ReadonlyMap<UUID, Customer>;
  }

  get slaRules(): ReadonlyMap<UUID, SlaRule> {
    return this.tables.slaRule as ReadonlyMap<UUID, SlaRule>;
  }

  get customerRequests(): ReadonlyMap<UUID, CustomerRequest> {
    return this.tables.customerRequest as ReadonlyMap<UUID, CustomerRequest>;
  }

  get dashboards(): ReadonlyMap<UUID, Dashboard> {
    return this.tables.dashboard as ReadonlyMap<UUID, Dashboard>;
  }

  get dashboardTiles(): ReadonlyMap<UUID, DashboardTile> {
    return this.tables.dashboardTile as ReadonlyMap<UUID, DashboardTile>;
  }

  tileIdsForDashboard(dashboardId: UUID): ReadonlySet<UUID> {
    return this.dashboardTileOf.get(dashboardId);
  }

  get recurringIssues(): ReadonlyMap<UUID, RecurringIssue> {
    return this.tables.recurringIssue as ReadonlyMap<UUID, RecurringIssue>;
  }

  get issueLabels(): ReadonlyMap<UUID, IssueLabel> {
    return this.tables.issueLabel as ReadonlyMap<UUID, IssueLabel>;
  }

  get issueRelations(): ReadonlyMap<UUID, IssueRelation> {
    return this.tables.issueRelation as ReadonlyMap<UUID, IssueRelation>;
  }

  get issueSubscriptions(): ReadonlyMap<UUID, IssueSubscription> {
    return this.tables.issueSubscription as ReadonlyMap<UUID, IssueSubscription>;
  }

  get notifications(): ReadonlyMap<UUID, Notification> {
    return this.tables.notification as ReadonlyMap<UUID, Notification>;
  }

  get views(): ReadonlyMap<UUID, View> {
    return this.tables.view as ReadonlyMap<UUID, View>;
  }

  get viewSubscriptions(): ReadonlyMap<UUID, ViewSubscription> {
    return this.tables.viewSubscription as ReadonlyMap<UUID, ViewSubscription>;
  }

  viewSubscriptionIdFor(userId: UUID, viewId: UUID): UUID | undefined {
    return this.viewSubscriptionByUserView.get(viewSubKey(userId, viewId));
  }

  get viewPreferences(): ReadonlyMap<UUID, ViewPreference> {
    return this.tables.viewPreference as ReadonlyMap<UUID, ViewPreference>;
  }

  get favorites(): ReadonlyMap<UUID, Favorite> {
    return this.tables.favorite as ReadonlyMap<UUID, Favorite>;
  }

  get<T extends EntityType>(type: T, id: UUID): EntityOf<T> | undefined {
    return this.tables[type].get(id) as EntityOf<T> | undefined;
  }

  commentIdsFor(issueId: UUID): ReadonlySet<UUID> {
    return this.commentIssue.get(issueId);
  }

  attachmentIdsFor(issueId: UUID): ReadonlySet<UUID> {
    return this.attachmentIssue.get(issueId);
  }

  documentIdsForTeam(teamId: UUID): ReadonlySet<UUID> {
    return this.documentTeam.get(teamId);
  }

  documentIdsForProject(projectId: UUID): ReadonlySet<UUID> {
    return this.documentProject.get(projectId);
  }

  workflowStateIdsFor(teamId: UUID): ReadonlySet<UUID> {
    return this.stateTeam.get(teamId);
  }

  membershipIdsForTeam(teamId: UUID): ReadonlySet<UUID> {
    return this.membershipTeam.get(teamId);
  }

  membershipIdsForUser(userId: UUID): ReadonlySet<UUID> {
    return this.membershipUser.get(userId);
  }

  /**
   * The labels on an issue.
   *
   * The hottest of the new accessors by a wide margin: a filtered list renders this for
   * every visible row, so it hands back the index's live set rather than an array built
   * per call. Callers must not mutate it.
   */
  labelIdsFor(issueId: UUID): ReadonlySet<UUID> {
    return this.labelIndex.labelIdsFor(issueId);
  }

  issueIdsWithLabel(labelId: UUID): ReadonlySet<UUID> {
    return this.labelIndex.issueIdsWith(labelId);
  }

  /** The project labels on a project. */
  projectLabelIdsFor(projectId: UUID): ReadonlySet<UUID> {
    return this.projectLabelIndex.labelIdsFor(projectId);
  }

  projectIdsWithProjectLabel(labelId: UUID): ReadonlySet<UUID> {
    return this.projectLabelIndex.projectIdsWith(labelId);
  }

  /** `projectLabelLink` rows when the application itself is needed. */
  projectLabelLinkIdsFor(projectId: UUID): ReadonlySet<UUID> {
    return this.projectLabelIndex.rowIdsForProject(projectId);
  }

  projectTeamIdsFor(projectId: UUID): ReadonlySet<UUID> {
    return this.projectTeamOf.get(projectId);
  }

  projectMemberIdsFor(projectId: UUID): ReadonlySet<UUID> {
    return this.projectMemberOf.get(projectId);
  }

  projectMilestoneIdsFor(projectId: UUID): ReadonlySet<UUID> {
    return this.projectMilestoneOf.get(projectId);
  }

  initiativeProjectIdsFor(initiativeId: UUID): ReadonlySet<UUID> {
    return this.initiativeProjectOf.get(initiativeId);
  }

  projectUpdateIdsFor(projectId: UUID): ReadonlySet<UUID> {
    return this.projectUpdateOf.get(projectId);
  }

  /** Dependencies where this project blocks others. */
  projectDependencyBlockingIdsFor(projectId: UUID): ReadonlySet<UUID> {
    return this.projectDependencyBlockingOf.get(projectId);
  }

  /** Dependencies where this project is blocked by others. */
  projectDependencyBlockedByIdsFor(projectId: UUID): ReadonlySet<UUID> {
    return this.projectDependencyBlockedByOf.get(projectId);
  }

  cycleIdsFor(teamId: UUID): ReadonlySet<UUID> {
    return this.cycleTeam.get(teamId);
  }

  recurringIssueIdsFor(teamId: UUID): ReadonlySet<UUID> {
    return this.recurringTeam.get(teamId);
  }

  customerRequestIdsForCustomer(customerId: UUID): ReadonlySet<UUID> {
    return this.customerRequestCustomer.get(customerId);
  }

  customerRequestIdsForIssue(issueId: UUID): ReadonlySet<UUID> {
    return this.customerRequestIssue.get(issueId);
  }

  customerRequestIdsForProject(projectId: UUID): ReadonlySet<UUID> {
    return this.customerRequestProject.get(projectId);
  }

  /** `issueLabel` rows, when the application itself is needed rather than the label. */
  issueLabelIdsFor(issueId: UUID): ReadonlySet<UUID> {
    return this.labelIndex.rowIdsForIssue(issueId);
  }

  /** Team-scoped labels. Workspace labels have no team and are read from `labels`. */
  labelIdsForTeam(teamId: UUID): ReadonlySet<UUID> {
    return this.labelTeam.get(teamId);
  }

  issueTemplateIdsForTeam(teamId: UUID): ReadonlySet<UUID> {
    return this.templateTeam.get(teamId);
  }

  formTemplateIdsForTeam(teamId: UUID): ReadonlySet<UUID> {
    return this.formTemplateTeam.get(teamId);
  }

  formTemplateFieldIdsFor(formTemplateId: UUID): ReadonlySet<UUID> {
    return this.formTemplateFieldOf.get(formTemplateId);
  }

  askFormIdsForTeam(teamId: UUID): ReadonlySet<UUID> {
    return this.askFormTeam.get(teamId);
  }

  projectTemplateIdsForTeam(teamId: UUID): ReadonlySet<UUID> {
    return this.projectTemplateTeam.get(teamId);
  }

  projectTemplateMilestoneIdsFor(projectTemplateId: UUID): ReadonlySet<UUID> {
    return this.projectTemplateMilestoneOf.get(projectTemplateId);
  }

  projectTemplateIssueIdsFor(projectTemplateId: UUID): ReadonlySet<UUID> {
    return this.projectTemplateIssueOf.get(projectTemplateId);
  }

  viewIdsForTeam(teamId: UUID): ReadonlySet<UUID> {
    return this.viewTeam.get(teamId);
  }

  viewIdsForProject(projectId: UUID): ReadonlySet<UUID> {
    return this.viewProject.get(projectId);
  }

  /** Sub-issues of an issue; `null` asks for the issues that have no parent. */
  childIssueIdsFor(parentId: UUID | null): ReadonlySet<UUID> {
    return this.index.byParent(parentId);
  }

  /** Relations this issue declares — it blocks, duplicates or relates to something else. */
  relationIdsFrom(issueId: UUID): ReadonlySet<UUID> {
    return this.relationIndex.rowIdsFrom(issueId);
  }

  /** Relations pointing at this issue. A `blocks` row read from here is "blocked by". */
  relationIdsTo(issueId: UUID): ReadonlySet<UUID> {
    return this.relationIndex.rowIdsTo(issueId);
  }

  subscriptionIdsForIssue(issueId: UUID): ReadonlySet<UUID> {
    return this.subscriptionIssue.get(issueId);
  }

  subscriptionIdsForUser(userId: UUID): ReadonlySet<UUID> {
    return this.subscriptionUser.get(userId);
  }

  /** The people subscribed to an issue, with anyone who explicitly unsubscribed left out. */
  subscriberIdsFor(issueId: UUID): ReadonlySet<UUID> {
    return this.subscriberUsers.get(issueId);
  }

  /** Subscribers as a map, the shape the filter compiler's context takes. */
  subscribersByIssue(): ReadonlyMap<UUID, ReadonlySet<UUID>> {
    return this.subscriberUsers.asMap();
  }

  /**
   * Unread inbox rows.
   *
   * Snoozed rows are in here, because they are unread. Whether a snooze has expired
   * depends on the clock rather than on any write, so the inbox compares `snoozedUntil`
   * itself; an index over it would go stale at the exact moment it mattered.
   */
  unreadNotificationIds(): ReadonlySet<UUID> {
    return this.notificationIndex.unread();
  }

  notificationIdsFor(issueId: UUID): ReadonlySet<UUID> {
    return this.notificationIndex.rowIdsForIssue(issueId);
  }

  favoriteIdsForTarget(targetId: UUID): ReadonlySet<UUID> {
    return this.favoriteTarget.get(targetId);
  }

  /**
   * The display options saved for one of the views that has no row of its own.
   *
   * Keyed by user as well as view key: the viewer's own rows are the only ones the server
   * sends today, and keying on the view key alone would silently serve somebody else's
   * grouping the day that stops being true.
   */
  viewPreferenceIdFor(userId: UUID, viewKey: string): UUID | undefined {
    return this.preferenceKeys.get(preferenceKey(userId, viewKey));
  }

  /**
   * The issue's human-readable id, recomputed from the team it is in.
   *
   * The wire carries `identifier`, but it is derived from a mutable team key and is only
   * correct as of the moment the row was serialised. Renaming a team's key from `ENG` to
   * `PLAT` emits one change for the team and none for its sixty thousand issues, so a
   * cached `identifier` would keep saying `ENG-4` until the next bootstrap. Recomputing
   * costs a map lookup and a concatenation.
   */
  identifierOf(issue: Issue): string {
    const team = this.tables.team.get(issue.teamId) as Team | undefined;
    return team === undefined ? issue.identifier : issueIdentifier(team.key, issue.number);
  }

  /** Runs a filter/group/sort against the indexes. See `query.ts`. */
  query(request: IssueQuery = {}): IssueQueryResult {
    return queryIssues(this, request);
  }

  /** Loads a snapshot read from IndexedDB. */
  hydrate(snapshot: Snapshot): void {
    this.reset();
    const meta = snapshot.meta;
    if (meta === null || meta.bootstrapAt === null) return;

    for (const type of ENTITY_TYPES) {
      for (const entity of snapshot[type]) this.insert(type, entity);
    }
    // Rebuilt in one pass rather than incrementally: this is the one moment when the
    // whole corpus is already in hand and no view is watching.
    this.index.rebuild(this.issues.values());
    this.currentVersion = meta.version;
    this.bootstrappedAt = meta.bootstrapAt;
  }

  /**
   * Discards the replica in preparation for a fresh snapshot.
   *
   * The outbox is untouched. A resync is a statement about what the server knows, not
   * about the user's unsent work, and dropping queued mutations because the schema
   * changed would silently lose edits the user watched succeed.
   */
  async beginBootstrap(): Promise<void> {
    this.reset();
    await this.db?.clearEntities();
  }

  /**
   * Ingests one page of the bootstrap stream.
   *
   * No subscriber is notified here. A cold bootstrap is thousands of pages over a
   * growing corpus, and re-running every open selector per page would make the snapshot
   * quadratic in its own size; `finishBootstrap` notifies once, when the replica is
   * actually a replica.
   */
  ingestBootstrapPage(rows: readonly EntityRow[]): void {
    const puts: EntityRow[] = [];
    const touched = new Set<EntityType>();
    for (const row of rows) this.put(row.type, row.entity, puts, touched);
    this.persist({ puts });
  }

  /**
   * Commits the snapshot at `version` and wakes every view.
   *
   * The meta write is the commit point, and it is awaited: until it lands, a reload
   * finds rows with no `bootstrapAt` and correctly treats them as a torn snapshot rather
   * than a complete one.
   */
  async finishBootstrap(version: number): Promise<void> {
    this.currentVersion = version;
    this.bootstrappedAt = new Date().toISOString();
    this.persist({ meta: this.metaAt(version) });
    await this.whenPersisted();
    this.notify(new Set(ENTITY_TYPES));
  }

  /**
   * Applies a delta batch: memory and indexes synchronously, disk and subscribers after.
   *
   * Subscribers are notified once for the whole batch. Fifty changes arriving in one
   * frame are one render, not fifty — and a subscriber whose answer the batch did not
   * change is not called at all, because "the store changed" is not the question a view
   * asked.
   */
  applyChanges(changes: readonly Change[]): void {
    if (changes.length === 0) return;

    const puts: EntityRow[] = [];
    const deletes: EntityRef[] = [];
    const touched = new Set<EntityType>();
    let version = this.currentVersion;

    for (const change of changes) {
      if (change.v > version) version = change.v;
      // A newer server may stream an entity type this build has never heard of.
      // Skipping it keeps the rest of the batch flowing; throwing would stall the delta
      // stream behind a row nothing can do anything with anyway.
      if (!isEntityType(change.type)) continue;

      switch (change.op) {
        case 'upsert':
          // An upsert with no payload cannot be applied, and guessing would be worse
          // than ignoring it: the next full sync carries the truth.
          if (change.payload !== undefined) this.put(change.type, change.payload, puts, touched);
          break;
        case 'delete':
        case 'revoke':
          // Deliberately the same path. `revoke` means the recipient lost access rather
          // than the entity ceasing to exist, but locally the two must be
          // indistinguishable: any residue — a cached title, an id in an index, a row
          // left in IndexedDB — is a permanent readable copy of data the user was cut
          // off from, which is the exact failure `revoke` exists to prevent.
          this.forget(change.type, change.id, deletes, touched);
          break;
      }
    }

    this.currentVersion = version;
    this.persist({ puts, deletes, meta: this.metaAt(version) });
    this.notify(touched);
  }

  /**
   * Applies a mutation's optimistic effect, before the server has seen it.
   *
   * Persisted like any other write. A reload between the keystroke and the server's
   * answer must still show the user their own edit — the outbox holds the mutation and
   * will make it true — and an unpersisted optimistic write would make the change appear
   * to un-happen on refresh.
   */
  applyOptimistic(patch: OptimisticPatch): void {
    const puts: EntityRow[] = [];
    const deletes: EntityRef[] = [];
    const touched = new Set<EntityType>();
    for (const entry of patch) {
      if (entry.after === null) this.forget(entry.type, entry.id, deletes, touched);
      else this.put(entry.type, entry.after, puts, touched);
    }
    // No meta: an optimistic write has no workspace version yet, and claiming one would
    // make the client resume from a point the server has never heard of.
    this.persist({ puts, deletes });
    this.notify(touched);
  }

  /**
   * Undoes a rejected mutation, in reverse order and only where it is still safe.
   *
   * An entity is restored only if it still looks exactly as this patch left it. If a
   * delta or a later mutation has moved it on, the server's version is already the truth
   * and writing `before` back would resurrect a value nobody asked for — the user would
   * watch a teammate's change disappear because an unrelated op of theirs was rejected.
   */
  revertOptimistic(patch: OptimisticPatch): void {
    const puts: EntityRow[] = [];
    const deletes: EntityRef[] = [];
    const touched = new Set<EntityType>();
    for (let i = patch.length - 1; i >= 0; i--) {
      const entry = patch[i];
      if (entry === undefined) continue;
      const current = this.tables[entry.type].get(entry.id) ?? null;
      if (!sameResult(current, entry.after)) continue;
      if (entry.before === null) this.forget(entry.type, entry.id, deletes, touched);
      else this.put(entry.type, entry.before, puts, touched);
    }
    this.persist({ puts, deletes });
    this.notify(touched);
  }

  /**
   * Registers a standing query. Returns the unsubscribe.
   *
   * The selector runs once here so the first notification is a real change rather than
   * the subscriber being told what it already rendered.
   */
  subscribe<R>(subscription: Subscription<R>): () => void {
    const entry: Subscriber = {
      select: subscription.select as (store: Store) => unknown,
      onChange: subscription.onChange as (result: unknown) => void,
      equals: (subscription.equals ?? sameResult) as (a: unknown, b: unknown) => boolean,
      deps: subscription.deps === undefined ? null : new Set(subscription.deps),
      last: undefined,
    };
    entry.last = entry.select(this);
    this.subscribers.add(entry);
    return () => {
      this.subscribers.delete(entry);
    };
  }

  /** Resolves when every write issued so far has reached IndexedDB. */
  whenPersisted(): Promise<void> {
    return this.persistQueue;
  }

  /** Flushes pending writes and releases the database handle. */
  async close(): Promise<void> {
    await this.whenPersisted();
    this.db?.close();
  }

  private reset(): void {
    for (const type of ENTITY_TYPES) this.tables[type].clear();
    this.index.clear();
    this.labelIndex.clear();
    this.projectLabelIndex.clear();
    this.relationIndex.clear();
    this.notificationIndex.clear();
    this.commentIssue.clear();
    this.attachmentIssue.clear();
    this.documentTeam.clear();
    this.documentProject.clear();
    this.stateTeam.clear();
    this.membershipTeam.clear();
    this.membershipUser.clear();
    this.labelTeam.clear();
    this.templateTeam.clear();
    this.formTemplateTeam.clear();
    this.formTemplateFieldOf.clear();
    this.askFormTeam.clear();
    this.projectTemplateTeam.clear();
    this.projectTemplateMilestoneOf.clear();
    this.projectTemplateIssueOf.clear();
    this.viewTeam.clear();
    this.viewProject.clear();
    this.viewSubscriptionOf.clear();
    this.viewSubscriptionByUserView.clear();
    this.subscriptionIssue.clear();
    this.subscriptionUser.clear();
    this.subscriberUsers.clear();
    this.favoriteTarget.clear();
    this.projectTeamOf.clear();
    this.projectMemberOf.clear();
    this.projectMilestoneOf.clear();
    this.initiativeProjectOf.clear();
    this.projectUpdateOf.clear();
    this.projectDependencyBlockingOf.clear();
    this.projectDependencyBlockedByOf.clear();
    this.cycleTeam.clear();
    this.preferenceKeys.clear();
    this.currentVersion = 0;
    this.bootstrappedAt = null;
  }

  private metaAt(version: number): Meta | undefined {
    // Before the snapshot completes there is no honest version to record: the rows on
    // disk are a prefix of a replica, not a replica at a version.
    if (this.bootstrappedAt === null) return undefined;
    return { version, bootstrapAt: this.bootstrappedAt, clientSchema: CLIENT_SCHEMA };
  }

  private put(type: EntityType, entity: Entity, puts: EntityRow[], touched: Set<EntityType>): void {
    const previous = this.tables[type].get(entity.id);
    this.tables[type].set(entity.id, entity);
    this.reindex(type, previous, entity);
    puts.push({ type, entity });
    touched.add(type);
  }

  /**
   * Removes an entity and everything of ours that depended on it.
   *
   * The cascade is not a convenience, it is required by the protocol. Losing access to a
   * team emits exactly one `revoke` — for the team — because a team can hold sixty
   * thousand issues and emitting sixty thousand change rows to remove one person would
   * stall every other writer in the workspace behind the version lock. The server is
   * explicit that the client deletes a team's contents when it loses the team; skipping
   * that here leaves a removed member with a full readable copy of the team's issues.
   */
  private forget(type: EntityType, id: UUID, deletes: EntityRef[], touched: Set<EntityType>): void {
    const existing = this.tables[type].get(id);
    if (existing === undefined) return;
    this.tables[type].delete(id);
    this.unindex(type, existing);
    deletes.push({ type, id });
    touched.add(type);

    switch (type) {
      case 'team':
        // Snapshotted before iterating: each `forget` mutates the very sets being walked.
        for (const issueId of [...this.index.byTeam(id)]) {
          this.forget('issue', issueId, deletes, touched);
        }
        for (const stateId of [...this.stateTeam.get(id)]) {
          this.forget('workflowState', stateId, deletes, touched);
        }
        for (const membershipId of [...this.membershipTeam.get(id)]) {
          this.forget('teamMembership', membershipId, deletes, touched);
        }
        // The team-scoped entities go with the team for the same reason its issues do:
        // they carry the team's scope, so a member who has lost the team may not read
        // them, and the server does not enumerate them in the revoke.
        for (const labelId of [...this.labelTeam.get(id)]) {
          this.forget('label', labelId, deletes, touched);
        }
        for (const templateId of [...this.templateTeam.get(id)]) {
          this.forget('issueTemplate', templateId, deletes, touched);
        }
        for (const formTemplateId of [...this.formTemplateTeam.get(id)]) {
          this.forget('formTemplate', formTemplateId, deletes, touched);
        }
        for (const askFormId of [...this.askFormTeam.get(id)]) {
          this.forget('askForm', askFormId, deletes, touched);
        }
        for (const projectTemplateId of [...this.projectTemplateTeam.get(id)]) {
          this.forget('projectTemplate', projectTemplateId, deletes, touched);
        }
        for (const viewId of [...this.viewTeam.get(id)]) {
          this.forget('view', viewId, deletes, touched);
        }
        for (const cycleId of [...this.cycleTeam.get(id)]) {
          this.forget('cycle', cycleId, deletes, touched);
        }
        for (const recId of [...this.recurringTeam.get(id)]) {
          this.forget('recurringIssue', recId, deletes, touched);
        }
        break;
      case 'project':
        for (const rowId of [...this.projectTeamOf.get(id)]) {
          this.forget('projectTeam', rowId, deletes, touched);
        }
        for (const rowId of [...this.projectMemberOf.get(id)]) {
          this.forget('projectMember', rowId, deletes, touched);
        }
        for (const rowId of [...this.projectMilestoneOf.get(id)]) {
          this.forget('projectMilestone', rowId, deletes, touched);
        }
        for (const viewId of [...this.viewProject.get(id)]) {
          this.forget('view', viewId, deletes, touched);
        }
        for (const rowId of [...this.projectLabelIndex.rowIdsForProject(id)]) {
          this.forget('projectLabelLink', rowId, deletes, touched);
        }
        for (const rowId of [...this.customerRequestProject.get(id)]) {
          this.forget('customerRequest', rowId, deletes, touched);
        }
        break;
      case 'issue':
        for (const commentId of [...this.commentIssue.get(id)]) {
          this.forget('comment', commentId, deletes, touched);
        }
        for (const attachmentId of [...this.attachmentIssue.get(id)]) {
          this.forget('attachment', attachmentId, deletes, touched);
        }
        for (const rowId of [...this.labelIndex.rowIdsForIssue(id)]) {
          this.forget('issueLabel', rowId, deletes, touched);
        }
        // Both directions: the row that says A blocks B is B's "blocked by", and leaving
        // it behind puts a blocker on a panel that can never be opened or cleared.
        for (const rowId of [...this.relationIndex.rowIdsFrom(id)]) {
          this.forget('issueRelation', rowId, deletes, touched);
        }
        for (const rowId of [...this.relationIndex.rowIdsTo(id)]) {
          this.forget('issueRelation', rowId, deletes, touched);
        }
        for (const rowId of [...this.subscriptionIssue.get(id)]) {
          this.forget('issueSubscription', rowId, deletes, touched);
        }
        for (const rowId of [...this.notificationIndex.rowIdsForIssue(id)]) {
          this.forget('notification', rowId, deletes, touched);
        }
        for (const rowId of [...this.customerRequestIssue.get(id)]) {
          this.forget('customerRequest', rowId, deletes, touched);
        }
        // Sub-issues are deliberately NOT cascaded. A child may live in a team the user
        // still belongs to — cross-team sub-issues are normal — and deleting it here
        // would remove work nobody has lost access to. It stays, parentless.
        break;
      case 'customer':
        for (const rowId of [...this.customerRequestCustomer.get(id)]) {
          this.forget('customerRequest', rowId, deletes, touched);
        }
        break;
      case 'dashboard':
        for (const rowId of [...this.dashboardTileOf.get(id)]) {
          this.forget('dashboardTile', rowId, deletes, touched);
        }
        break;
      case 'view':
        for (const rowId of [...this.viewSubscriptionOf.get(id)]) {
          this.forget('viewSubscription', rowId, deletes, touched);
        }
        break;
      case 'label':
        for (const rowId of [...this.labelIndex.rowIdsForLabel(id)]) {
          this.forget('issueLabel', rowId, deletes, touched);
        }
        break;
      case 'projectLabel':
        for (const rowId of [...this.projectLabelIndex.rowIdsForLabel(id)]) {
          this.forget('projectLabelLink', rowId, deletes, touched);
        }
        break;
      case 'projectTemplate':
        for (const milestoneId of [...this.projectTemplateMilestoneOf.get(id)]) {
          this.forget('projectTemplateMilestone', milestoneId, deletes, touched);
        }
        for (const issueId of [...this.projectTemplateIssueOf.get(id)]) {
          this.forget('projectTemplateIssue', issueId, deletes, touched);
        }
        break;
      default:
        break;
    }

    // A favourite is a pointer, and one pointing at something this replica no longer
    // holds renders as a sidebar row that cannot be opened, renamed or removed. The
    // lookup is a single map probe for the types that are never favourited.
    for (const favoriteId of [...this.favoriteTarget.get(id)]) {
      this.forget('favorite', favoriteId, deletes, touched);
    }
  }

  /**
   * Hydration path: fills the tables and the relation indexes, leaving `IssueIndex` to a
   * bulk rebuild.
   *
   * It delegates to `reindex` rather than repeating its switch. Two switches over the
   * same sixteen types drift the moment a seventeenth arrives, and the failure is silent:
   * an index maintained on the delta path but not on the hydration path is correct all
   * day and empty after a reload.
   */
  private insert(type: EntityType, entity: Entity): void {
    this.tables[type].set(entity.id, entity);
    // The issue corpus is the one exception: `hydrate` rebuilds it in a single pass once
    // every issue is in hand, so filing each one here would do that work twice.
    if (type !== 'issue') this.reindex(type, undefined, entity);
  }

  private reindex(type: EntityType, previous: Entity | undefined, next: Entity): void {
    switch (type) {
      case 'issue': {
        const issue = next as Issue;
        if (previous === undefined) this.index.add(issue);
        else this.index.update(previous as Issue, issue);
        break;
      }
      case 'comment': {
        const comment = next as Comment;
        const before = previous as Comment | undefined;
        if (before !== undefined && before.issueId !== comment.issueId) {
          this.commentIssue.remove(before.issueId, before.id);
        }
        this.commentIssue.add(comment.issueId, comment.id);
        break;
      }
      case 'attachment': {
        const attachment = next as Attachment;
        const before = previous as Attachment | undefined;
        if (before !== undefined && before.issueId !== attachment.issueId) {
          this.attachmentIssue.remove(before.issueId, before.id);
        }
        this.attachmentIssue.add(attachment.issueId, attachment.id);
        break;
      }
      case 'document': {
        const document = next as Document;
        const before = previous as Document | undefined;
        if (before !== undefined) {
          this.documentTeam.remove(before.teamId, before.id);
          if (before.projectId !== undefined) {
            this.documentProject.remove(before.projectId, before.id);
          }
        }
        this.documentTeam.add(document.teamId, document.id);
        if (document.projectId !== undefined) {
          this.documentProject.add(document.projectId, document.id);
        }
        break;
      }
      case 'workflowState': {
        const state = next as WorkflowState;
        const before = previous as WorkflowState | undefined;
        if (before !== undefined && before.teamId !== state.teamId) {
          this.stateTeam.remove(before.teamId, before.id);
        }
        this.stateTeam.add(state.teamId, state.id);
        break;
      }
      case 'teamMembership': {
        const membership = next as TeamMembership;
        const before = previous as TeamMembership | undefined;
        if (before !== undefined) {
          this.membershipTeam.remove(before.teamId, before.id);
          this.membershipUser.remove(before.userId, before.id);
        }
        this.membershipTeam.add(membership.teamId, membership.id);
        this.membershipUser.add(membership.userId, membership.id);
        break;
      }
      case 'label':
        this.fileByTeam(this.labelTeam, previous as Label | undefined, next as Label);
        break;
      case 'issueTemplate':
        this.fileByTeam(
          this.templateTeam,
          previous as IssueTemplate | undefined,
          next as IssueTemplate,
        );
        break;
      case 'formTemplate':
        this.fileByTeam(
          this.formTemplateTeam,
          previous as FormTemplate | undefined,
          next as FormTemplate,
        );
        break;
      case 'formTemplateField': {
        const row = next as FormTemplateField;
        const before = previous as FormTemplateField | undefined;
        if (before !== undefined) {
          this.formTemplateFieldOf.remove(before.formTemplateId, before.id);
        }
        this.formTemplateFieldOf.add(row.formTemplateId, row.id);
        break;
      }
      case 'askForm':
        this.fileByTeam(this.askFormTeam, previous as AskForm | undefined, next as AskForm);
        break;
      case 'projectTemplate':
        this.fileByTeam(
          this.projectTemplateTeam,
          previous as ProjectTemplate | undefined,
          next as ProjectTemplate,
        );
        break;
      case 'projectTemplateMilestone': {
        const row = next as ProjectTemplateMilestone;
        const before = previous as ProjectTemplateMilestone | undefined;
        if (before !== undefined) {
          this.projectTemplateMilestoneOf.remove(before.projectTemplateId, before.id);
        }
        this.projectTemplateMilestoneOf.add(row.projectTemplateId, row.id);
        break;
      }
      case 'projectTemplateIssue': {
        const row = next as ProjectTemplateIssue;
        const before = previous as ProjectTemplateIssue | undefined;
        if (before !== undefined) {
          this.projectTemplateIssueOf.remove(before.projectTemplateId, before.id);
        }
        this.projectTemplateIssueOf.add(row.projectTemplateId, row.id);
        break;
      }
      case 'view':
        this.fileView(previous as View | undefined, next as View);
        break;
      case 'issueLabel': {
        const row = next as IssueLabel;
        const before = previous as IssueLabel | undefined;
        if (before === undefined) this.labelIndex.add(row);
        else this.labelIndex.update(before, row);
        break;
      }
      case 'projectLabelLink': {
        const row = next as ProjectLabelLink;
        const before = previous as ProjectLabelLink | undefined;
        if (before === undefined) this.projectLabelIndex.add(row);
        else this.projectLabelIndex.update(before, row);
        break;
      }
      case 'issueRelation': {
        const row = next as IssueRelation;
        const before = previous as IssueRelation | undefined;
        if (before === undefined) this.relationIndex.add(row);
        else this.relationIndex.update(before, row);
        break;
      }
      case 'issueSubscription': {
        const row = next as IssueSubscription;
        const before = previous as IssueSubscription | undefined;
        if (before !== undefined) {
          this.subscriptionIssue.remove(before.issueId, before.id);
          this.subscriptionUser.remove(before.userId, before.id);
          this.subscriberUsers.remove(before.issueId, before.userId);
        }
        this.subscriptionIssue.add(row.issueId, row.id);
        this.subscriptionUser.add(row.userId, row.id);
        // An unsubscribe is a flag on a surviving row, so it leaves the subscriber set
        // while the row itself stays — deleting the row would let the next comment
        // re-subscribe the person who just opted out.
        if (!row.unsubscribed) this.subscriberUsers.add(row.issueId, row.userId);
        break;
      }
      case 'notification': {
        const row = next as Notification;
        const before = previous as Notification | undefined;
        if (before === undefined) this.notificationIndex.add(row);
        else this.notificationIndex.update(before, row);
        break;
      }
      case 'viewPreference': {
        const row = next as ViewPreference;
        const before = previous as ViewPreference | undefined;
        if (before !== undefined) {
          this.preferenceKeys.delete(preferenceKey(before.userId, before.viewKey));
        }
        this.preferenceKeys.set(preferenceKey(row.userId, row.viewKey), row.id);
        break;
      }
      case 'favorite': {
        const row = next as Favorite;
        const before = previous as Favorite | undefined;
        if (before !== undefined && before.targetId !== row.targetId) {
          this.favoriteTarget.remove(before.targetId, before.id);
        }
        this.favoriteTarget.add(row.targetId, row.id);
        break;
      }
      case 'projectTeam':
        this.fileByProject(
          this.projectTeamOf,
          previous as ProjectTeam | undefined,
          next as ProjectTeam,
        );
        break;
      case 'projectMember':
        this.fileByProject(
          this.projectMemberOf,
          previous as ProjectMember | undefined,
          next as ProjectMember,
        );
        break;
      case 'projectMilestone':
        this.fileByProject(
          this.projectMilestoneOf,
          previous as ProjectMilestone | undefined,
          next as ProjectMilestone,
        );
        break;
      case 'initiativeProject': {
        const link = next as InitiativeProject;
        const before = previous as InitiativeProject | undefined;
        if (before !== undefined && before.initiativeId !== link.initiativeId) {
          this.initiativeProjectOf.remove(before.initiativeId, before.id);
        }
        this.initiativeProjectOf.add(link.initiativeId, link.id);
        break;
      }
      case 'projectUpdate':
        this.fileByProject(
          this.projectUpdateOf,
          previous as ProjectUpdate | undefined,
          next as ProjectUpdate,
        );
        break;
      case 'projectDependency': {
        const dep = next as ProjectDependency;
        const before = previous as ProjectDependency | undefined;
        if (before !== undefined) {
          if (before.blockingProjectId !== dep.blockingProjectId) {
            this.projectDependencyBlockingOf.remove(before.blockingProjectId, before.id);
          }
          if (before.blockedProjectId !== dep.blockedProjectId) {
            this.projectDependencyBlockedByOf.remove(before.blockedProjectId, before.id);
          }
        }
        this.projectDependencyBlockingOf.add(dep.blockingProjectId, dep.id);
        this.projectDependencyBlockedByOf.add(dep.blockedProjectId, dep.id);
        break;
      }
      case 'cycle': {
        const cycle = next as Cycle;
        const before = previous as Cycle | undefined;
        if (before !== undefined && before.teamId !== cycle.teamId) {
          this.cycleTeam.remove(before.teamId, before.id);
        }
        this.cycleTeam.add(cycle.teamId, cycle.id);
        break;
      }
      case 'recurringIssue': {
        const row = next as RecurringIssue;
        const before = previous as RecurringIssue | undefined;
        if (before !== undefined && before.teamId !== row.teamId) {
          this.recurringTeam.remove(before.teamId, before.id);
        }
        this.recurringTeam.add(row.teamId, row.id);
        break;
      }
      case 'customerRequest': {
        const row = next as CustomerRequest;
        const before = previous as CustomerRequest | undefined;
        this.fileOptional(this.customerRequestCustomer, before?.customerId, row.customerId, row.id);
        this.fileOptional(this.customerRequestIssue, before?.issueId, row.issueId, row.id);
        this.fileOptional(this.customerRequestProject, before?.projectId, row.projectId, row.id);
        break;
      }
      case 'dashboardTile': {
        const row = next as DashboardTile;
        const before = previous as DashboardTile | undefined;
        if (before !== undefined && before.dashboardId !== row.dashboardId) {
          this.dashboardTileOf.remove(before.dashboardId, before.id);
        }
        this.dashboardTileOf.add(row.dashboardId, row.id);
        break;
      }
      case 'viewSubscription': {
        const row = next as ViewSubscription;
        const before = previous as ViewSubscription | undefined;
        if (before !== undefined) {
          this.viewSubscriptionOf.remove(before.viewId, before.id);
          this.viewSubscriptionByUserView.delete(viewSubKey(before.userId, before.viewId));
        }
        this.viewSubscriptionOf.add(row.viewId, row.id);
        this.viewSubscriptionByUserView.set(viewSubKey(row.userId, row.viewId), row.id);
        break;
      }
      default:
        break;
    }
  }

  private unindex(type: EntityType, entity: Entity): void {
    switch (type) {
      case 'issue':
        this.index.remove(entity as Issue);
        break;
      case 'comment': {
        const comment = entity as Comment;
        this.commentIssue.remove(comment.issueId, comment.id);
        break;
      }
      case 'attachment': {
        const attachment = entity as Attachment;
        this.attachmentIssue.remove(attachment.issueId, attachment.id);
        break;
      }
      case 'document': {
        const document = entity as Document;
        this.documentTeam.remove(document.teamId, document.id);
        if (document.projectId !== undefined) {
          this.documentProject.remove(document.projectId, document.id);
        }
        break;
      }
      case 'workflowState': {
        const state = entity as WorkflowState;
        this.stateTeam.remove(state.teamId, state.id);
        break;
      }
      case 'teamMembership': {
        const membership = entity as TeamMembership;
        this.membershipTeam.remove(membership.teamId, membership.id);
        this.membershipUser.remove(membership.userId, membership.id);
        break;
      }
      case 'label':
        this.unfileByTeam(this.labelTeam, entity as Label);
        break;
      case 'issueTemplate':
        this.unfileByTeam(this.templateTeam, entity as IssueTemplate);
        break;
      case 'formTemplate':
        this.unfileByTeam(this.formTemplateTeam, entity as FormTemplate);
        break;
      case 'formTemplateField': {
        const row = entity as FormTemplateField;
        this.formTemplateFieldOf.remove(row.formTemplateId, row.id);
        break;
      }
      case 'askForm':
        this.unfileByTeam(this.askFormTeam, entity as AskForm);
        break;
      case 'projectTemplate':
        this.unfileByTeam(this.projectTemplateTeam, entity as ProjectTemplate);
        break;
      case 'projectTemplateMilestone': {
        const row = entity as ProjectTemplateMilestone;
        this.projectTemplateMilestoneOf.remove(row.projectTemplateId, row.id);
        break;
      }
      case 'projectTemplateIssue': {
        const row = entity as ProjectTemplateIssue;
        this.projectTemplateIssueOf.remove(row.projectTemplateId, row.id);
        break;
      }
      case 'view':
        this.unfileView(entity as View);
        break;
      case 'issueLabel':
        this.labelIndex.remove(entity as IssueLabel);
        break;
      case 'projectLabelLink':
        this.projectLabelIndex.remove(entity as ProjectLabelLink);
        break;
      case 'issueRelation':
        this.relationIndex.remove(entity as IssueRelation);
        break;
      case 'issueSubscription': {
        const row = entity as IssueSubscription;
        this.subscriptionIssue.remove(row.issueId, row.id);
        this.subscriptionUser.remove(row.userId, row.id);
        this.subscriberUsers.remove(row.issueId, row.userId);
        break;
      }
      case 'notification':
        this.notificationIndex.remove(entity as Notification);
        break;
      case 'viewPreference': {
        const row = entity as ViewPreference;
        this.preferenceKeys.delete(preferenceKey(row.userId, row.viewKey));
        break;
      }
      case 'favorite': {
        const row = entity as Favorite;
        this.favoriteTarget.remove(row.targetId, row.id);
        break;
      }
      case 'projectTeam':
        this.unfileByProject(this.projectTeamOf, entity as ProjectTeam);
        break;
      case 'projectMember':
        this.unfileByProject(this.projectMemberOf, entity as ProjectMember);
        break;
      case 'projectMilestone':
        this.unfileByProject(this.projectMilestoneOf, entity as ProjectMilestone);
        break;
      case 'initiativeProject': {
        const link = entity as InitiativeProject;
        this.initiativeProjectOf.remove(link.initiativeId, link.id);
        break;
      }
      case 'projectUpdate':
        this.unfileByProject(this.projectUpdateOf, entity as ProjectUpdate);
        break;
      case 'projectDependency': {
        const dep = entity as ProjectDependency;
        this.projectDependencyBlockingOf.remove(dep.blockingProjectId, dep.id);
        this.projectDependencyBlockedByOf.remove(dep.blockedProjectId, dep.id);
        break;
      }
      case 'cycle': {
        const cycle = entity as Cycle;
        this.cycleTeam.remove(cycle.teamId, cycle.id);
        break;
      }
      case 'recurringIssue': {
        const row = entity as RecurringIssue;
        this.recurringTeam.remove(row.teamId, row.id);
        break;
      }
      case 'customerRequest': {
        const row = entity as CustomerRequest;
        if (row.customerId !== undefined) {
          this.customerRequestCustomer.remove(row.customerId, row.id);
        }
        if (row.issueId !== undefined) {
          this.customerRequestIssue.remove(row.issueId, row.id);
        }
        if (row.projectId !== undefined) {
          this.customerRequestProject.remove(row.projectId, row.id);
        }
        break;
      }
      case 'dashboardTile': {
        const row = entity as DashboardTile;
        this.dashboardTileOf.remove(row.dashboardId, row.id);
        break;
      }
      case 'viewSubscription': {
        const row = entity as ViewSubscription;
        this.viewSubscriptionOf.remove(row.viewId, row.id);
        this.viewSubscriptionByUserView.delete(viewSubKey(row.userId, row.viewId));
        break;
      }
      default:
        break;
    }
  }

  /** Files one of the three entities that may belong to a team or to the whole workspace. */
  private fileByTeam(
    index: SetIndex<UUID>,
    previous: TeamScoped | undefined,
    next: TeamScoped,
  ): void {
    if (
      previous !== undefined &&
      previous.teamId !== undefined &&
      previous.teamId !== next.teamId
    ) {
      index.remove(previous.teamId, previous.id);
    }
    if (next.teamId !== undefined) index.add(next.teamId, next.id);
  }

  private unfileByTeam(index: SetIndex<UUID>, entity: TeamScoped): void {
    if (entity.teamId !== undefined) index.remove(entity.teamId, entity.id);
  }

  /** Indexes a view under its project tab set or its team sidebar bucket. */
  private fileView(previous: View | undefined, next: View): void {
    if (previous !== undefined) this.unfileView(previous);
    if (next.projectId !== undefined) this.viewProject.add(next.projectId, next.id);
    else if (next.teamId !== undefined) this.viewTeam.add(next.teamId, next.id);
  }

  private unfileView(entity: View): void {
    if (entity.projectId !== undefined) this.viewProject.remove(entity.projectId, entity.id);
    else if (entity.teamId !== undefined) this.viewTeam.remove(entity.teamId, entity.id);
  }

  private fileByProject(
    index: SetIndex<UUID>,
    previous: ProjectScoped | undefined,
    next: ProjectScoped,
  ): void {
    if (previous !== undefined && previous.projectId !== next.projectId) {
      index.remove(previous.projectId, previous.id);
    }
    index.add(next.projectId, next.id);
  }

  private unfileByProject(index: SetIndex<UUID>, entity: ProjectScoped): void {
    index.remove(entity.projectId, entity.id);
  }

  private fileOptional(
    index: SetIndex<UUID>,
    previous: UUID | undefined,
    next: UUID | undefined,
    rowId: UUID,
  ): void {
    if (previous !== undefined && previous !== next) index.remove(previous, rowId);
    if (next !== undefined) index.add(next, rowId);
  }

  /**
   * Chains a durable write behind the ones before it.
   *
   * Serialised rather than parallel so that batches land in the order they were applied:
   * two overlapping transactions writing the same issue could otherwise commit backwards
   * and leave the replica holding a value the store has already moved past.
   */
  private persist(batch: WriteBatch): void {
    const db = this.db;
    if (db === null) return;
    this.persistQueue = this.persistQueue
      .then(() => db.write(batch))
      .catch((error: unknown) => {
        this.onPersistError(error);
      });
  }

  private notify(touched: ReadonlySet<EntityType>): void {
    if (this.subscribers.size === 0 || touched.size === 0) return;
    // Iterated over a copy: a subscriber is allowed to unsubscribe, or to subscribe
    // something else, in response to the change it was just handed.
    for (const entry of [...this.subscribers]) {
      if (!this.subscribers.has(entry)) continue;
      if (entry.deps !== null && !intersects(entry.deps, touched)) continue;
      const next = entry.select(this);
      if (entry.equals(entry.last, next)) continue;
      entry.last = next;
      entry.onChange(next);
    }
  }
}

/** Labels, templates and views: each belongs to a team, or to the workspace when it has none. */
interface TeamScoped {
  readonly id: UUID;
  readonly teamId?: UUID;
}

/** Teams, members and milestones of a project: each names the project it belongs to. */
interface ProjectScoped {
  readonly id: UUID;
  readonly projectId: UUID;
}

/**
 * The composite key for a view preference.
 *
 * NUL separates the two halves because it cannot appear in a view key. A printable
 * separator could: a key containing it would collide with another user's row, and the
 * symptom would be one person's grouping quietly applied to somebody else's list.
 */
function preferenceKey(userId: UUID, viewKey: string): string {
  return `${userId}\u0000${viewKey}`;
}

function viewSubKey(userId: UUID, viewId: UUID): string {
  return `${userId}\u0000${viewId}`;
}

function intersects(deps: ReadonlySet<EntityType>, touched: ReadonlySet<EntityType>): boolean {
  // Walks the smaller set; both are tiny, but this is called once per subscriber per batch.
  const [small, large] = deps.size <= touched.size ? [deps, touched] : [touched, deps];
  for (const type of small) if (large.has(type)) return true;
  return false;
}
