/* eslint-disable */
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  JSON: { input: unknown; output: unknown; }
  /**
   * Polaris GraphQL API — the single backend interface.
   *
   * This schema is the contract. The web app, the desktop app, the published SDK, every
   * integration and every agent speak it, and there is no second, private API behind it. That
   * constraint is deliberate and load-bearing: the moment the product's own client can reach
   * something the public API cannot, the two drift and every integration inherits a permanent
   * second-class experience.
   *
   * The practical consequence: adding a field is a schema change, not a resolver change. That
   * friction is the mechanism, not an accident of the tooling.
   */
  Time: { input: string; output: string; }
  UUID: { input: string; output: string; }
};

export type Actor = {
  id?: Maybe<Scalars['UUID']['output']>;
  type: ActorType;
};

/** Who caused a change. All four exist from the first release because the activity feed, webhooks, the audit log and filters all expose them. */
export type ActorType =
  | 'APP_USER'
  | 'INTEGRATION'
  | 'SYSTEM'
  | 'USER';

/**
 * A personal API key. Acts as its owner — never more.
 *
 * A key that could do more than the person who made it is a privilege-escalation path, and
 * one that outlives their account is an access path nobody reviews. Scopes narrow; they
 * never widen.
 */
export type ApiKey = {
  createdAt: Scalars['Time']['output'];
  expiresAt?: Maybe<Scalars['Time']['output']>;
  id: Scalars['UUID']['output'];
  lastUsedAt?: Maybe<Scalars['Time']['output']>;
  name: Scalars['String']['output'];
  /** The leading characters, so a listing can identify a key without being a credential itself. */
  prefix: Scalars['String']['output'];
  revokedAt?: Maybe<Scalars['Time']['output']>;
  scopes: Array<Scalars['String']['output']>;
  updatedAt: Scalars['Time']['output'];
  userId: Scalars['UUID']['output'];
  workspaceId: Scalars['UUID']['output'];
};

/** The one and only time the token exists outside the caller's own storage. */
export type ApiKeyCreated = {
  apiKey: ApiKey;
  /** Shown once. Not recoverable — only its SHA-256 is stored. */
  token: Scalars['String']['output'];
};

export type ApiKeyPayload = MutationResult & {
  created: ApiKeyCreated;
  version: Scalars['Int']['output'];
};

/**
 * A bulk update returns the issues it changed and the single version the whole batch landed
 * at, because it emits one version block rather than one per issue.
 */
export type BulkIssuePayload = MutationResult & {
  issues: Array<Issue>;
  /** Ids the caller asked for but that were skipped, with why — a partial success the caller can act on rather than a silent one. */
  skipped: Array<BulkSkip>;
  version: Scalars['Int']['output'];
};

export type BulkSkip = {
  id: Scalars['UUID']['output'];
  reason: Scalars['String']['output'];
};

/**
 * A bulk edit applies one change to many issues in one transaction and one version block.
 *
 * Separate from updateIssue rather than a variadic version of it, because the two differ in
 * what they may do: bulk edit sets one property across a selection and never reorders, which
 * is what lets it be one statement and one notification per subscriber instead of N.
 */
export type BulkUpdateIssuesInput = {
  addLabelIds?: InputMaybe<Array<Scalars['UUID']['input']>>;
  assigneeId?: InputMaybe<Scalars['UUID']['input']>;
  clearAssignee?: InputMaybe<Scalars['Boolean']['input']>;
  clearDueDate?: InputMaybe<Scalars['Boolean']['input']>;
  clearEstimate?: InputMaybe<Scalars['Boolean']['input']>;
  dueDate?: InputMaybe<Scalars['String']['input']>;
  estimate?: InputMaybe<Scalars['Int']['input']>;
  ids: Array<Scalars['UUID']['input']>;
  priority?: InputMaybe<Scalars['Int']['input']>;
  removeLabelIds?: InputMaybe<Array<Scalars['UUID']['input']>>;
  stateId?: InputMaybe<Scalars['UUID']['input']>;
};

export type Comment = {
  actor: Actor;
  body: Scalars['String']['output'];
  createdAt: Scalars['Time']['output'];
  editedAt?: Maybe<Scalars['Time']['output']>;
  id: Scalars['UUID']['output'];
  /**
   * The issue this comment is on.
   *
   * Non-null, and it can be: a comment is only ever returned to somebody who can already read
   * its issue — every listing joins through it — so a resolvable comment with an unresolvable
   * issue is a broken invariant rather than a permission answer. It exists because a search
   * result is a comment with no way home: without this a client has to fetch the issue by id
   * to render "in ENG-142", which is a second round trip per hit.
   */
  issue: Issue;
  issueId: Scalars['UUID']['output'];
  parentId?: Maybe<Scalars['UUID']['output']>;
  resolvedAt?: Maybe<Scalars['Time']['output']>;
  resolvedBy?: Maybe<Scalars['UUID']['output']>;
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type CommentPayload = MutationResult & {
  comment: Comment;
  version: Scalars['Int']['output'];
};

export type CreateApiKeyInput = {
  expiresAt?: InputMaybe<Scalars['Time']['input']>;
  name: Scalars['String']['input'];
  /** Empty means everything the owner can do. Narrowing only. */
  scopes?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type CreateCommentInput = {
  body: Scalars['String']['input'];
  issueId: Scalars['UUID']['input'];
  parentId?: InputMaybe<Scalars['UUID']['input']>;
};

export type CreateIssueInput = {
  /** Place the new issue directly below this one. Omit to append. */
  afterIssueId?: InputMaybe<Scalars['UUID']['input']>;
  assigneeId?: InputMaybe<Scalars['UUID']['input']>;
  cycleId?: InputMaybe<Scalars['UUID']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  /** A calendar day, `2006-01-02`. */
  dueDate?: InputMaybe<Scalars['String']['input']>;
  estimate?: InputMaybe<Scalars['Int']['input']>;
  /** File into the team's triage status. The inbox's C, and an outsider filing into a team they can see. */
  fromTriage?: InputMaybe<Scalars['Boolean']['input']>;
  /**
   * The issue's id, minted by the client.
   *
   * Optional, and supplying it is what makes an offline create honest. The server allocates
   * the *number* — that needs a row-locked counter and no client can predict it — but the id
   * does not have to be server-chosen, and when it is, an optimistic create has to show a
   * stand-in row and swap it for the real one when the response arrives. Offline the
   * response comes minutes later, as a delta, while the stand-in is still on screen: two
   * rows for one issue. With a client-minted id the stand-in *is* the issue and the swap
   * disappears.
   *
   * Validated as a v7 uuid and rejected if already used. A client can therefore choose its
   * own ids, which matters less than it sounds: it can already choose the content.
   */
  id?: InputMaybe<Scalars['UUID']['input']>;
  labelIds?: InputMaybe<Array<Scalars['UUID']['input']>>;
  parentId?: InputMaybe<Scalars['UUID']['input']>;
  priority?: InputMaybe<Scalars['Int']['input']>;
  projectId?: InputMaybe<Scalars['UUID']['input']>;
  projectMilestoneId?: InputMaybe<Scalars['UUID']['input']>;
  stateId?: InputMaybe<Scalars['UUID']['input']>;
  teamId: Scalars['UUID']['input'];
  templateId?: InputMaybe<Scalars['UUID']['input']>;
  title: Scalars['String']['input'];
};

export type CreateIssueTemplateInput = {
  body?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  properties?: InputMaybe<Scalars['JSON']['input']>;
  teamId?: InputMaybe<Scalars['UUID']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
};

export type CreateLabelInput = {
  afterLabelId?: InputMaybe<Scalars['UUID']['input']>;
  color?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  /** A group is a container and cannot itself be applied to an issue. */
  isGroup?: InputMaybe<Scalars['Boolean']['input']>;
  name: Scalars['String']['input'];
  /** The group to put it in. A group's scope must match the label's. */
  parentId?: InputMaybe<Scalars['UUID']['input']>;
  /** Null makes it a workspace label, visible to every team. */
  teamId?: InputMaybe<Scalars['UUID']['input']>;
};

export type CreateProjectInput = {
  color?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  icon?: InputMaybe<Scalars['String']['input']>;
  leadId?: InputMaybe<Scalars['UUID']['input']>;
  memberIds?: InputMaybe<Array<Scalars['UUID']['input']>>;
  name: Scalars['String']['input'];
  priority?: InputMaybe<Scalars['Int']['input']>;
  startDate?: InputMaybe<Scalars['String']['input']>;
  startDateGranularity?: InputMaybe<TimeframeGranularity>;
  statusId?: InputMaybe<Scalars['UUID']['input']>;
  summary?: InputMaybe<Scalars['String']['input']>;
  targetDate?: InputMaybe<Scalars['String']['input']>;
  targetDateGranularity?: InputMaybe<TimeframeGranularity>;
  /** At least one. A project with no team is invisible to everyone. */
  teamIds: Array<Scalars['UUID']['input']>;
};

export type CreateProjectMilestoneInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  projectId: Scalars['UUID']['input'];
  targetDate?: InputMaybe<Scalars['String']['input']>;
};

export type CreateProjectStatusInput = {
  category: ProjectStatusCategory;
  color?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  isDefault?: InputMaybe<Scalars['Boolean']['input']>;
  name: Scalars['String']['input'];
};

export type CreateTeamInput = {
  color?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  icon?: InputMaybe<Scalars['String']['input']>;
  key: Scalars['String']['input'];
  name: Scalars['String']['input'];
  private?: InputMaybe<Scalars['Boolean']['input']>;
  timezone?: InputMaybe<Scalars['String']['input']>;
};

export type CreateViewInput = {
  color?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  display?: InputMaybe<Scalars['JSON']['input']>;
  filter: Scalars['JSON']['input'];
  icon?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  /** True keeps the view private to its creator. */
  private?: InputMaybe<Scalars['Boolean']['input']>;
  teamId?: InputMaybe<Scalars['UUID']['input']>;
};

export type CreateWorkflowStateInput = {
  afterStateId?: InputMaybe<Scalars['UUID']['input']>;
  category: StateCategory;
  color?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  teamId: Scalars['UUID']['input'];
};

/** A dated window on one team. Cooldown is a gap between cycles, not a row of this type. */
export type Cycle = {
  archivedAt?: Maybe<Scalars['Time']['output']>;
  completedAt?: Maybe<Scalars['Time']['output']>;
  createdAt: Scalars['Time']['output'];
  description?: Maybe<Scalars['String']['output']>;
  endsAt: Scalars['Time']['output'];
  id: Scalars['UUID']['output'];
  name: Scalars['String']['output'];
  number: Scalars['Int']['output'];
  startsAt: Scalars['Time']['output'];
  teamId: Scalars['UUID']['output'];
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type CyclePayload = MutationResult & {
  cycle: Cycle;
  version: Scalars['Int']['output'];
};

export type DeletePayload = MutationResult & {
  id: Scalars['UUID']['output'];
  version: Scalars['Int']['output'];
};

/**
 * Which subsystem set an issue's due date, and therefore whether a human may edit it. SLAs
 * arrive later and will also want to set one; the two are mutually exclusive.
 */
export type DueDateSource =
  | 'MANUAL'
  | 'SLA';

/**
 * The answer to "may this workspace do X", in one place.
 *
 * Gating touches dozens of features, and the alternative — an `if plan ==` at each of them —
 * is unmaintainable and, worse, is written the day gating ships and never audited again.
 * The feature matrix itself lives in Go rather than the database, because which plan may use
 * which feature changes with a release, not with data.
 */
export type Entitlements = {
  apiKeys: Scalars['Boolean']['output'];
  auditLog: Scalars['Boolean']['output'];
  customViews: Scalars['Boolean']['output'];
  /** How far back the change stream is queryable, in days. */
  historyDays?: Maybe<Scalars['Int']['output']>;
  /** Set while a paid plan is lapsed: reads work, gated writes do not. */
  lapsed: Scalars['Boolean']['output'];
  plan: Scalars['String']['output'];
  privateTeams: Scalars['Boolean']['output'];
  /** Null means unlimited. */
  seatLimit?: Maybe<Scalars['Int']['output']>;
  seatsUsed: Scalars['Int']['output'];
  sso: Scalars['Boolean']['output'];
  teamLimit?: Maybe<Scalars['Int']['output']>;
};

/**
 * How a team renders estimates. The issue stores the number either way, so a team can change
 * scale without rewriting a single issue.
 */
export type EstimateScale =
  | 'EXPONENTIAL'
  | 'FIBONACCI'
  | 'LINEAR'
  /** The team does not estimate. Hides the control rather than leaving it empty. */
  | 'NONE'
  | 'TSHIRT';

export type Favorite = {
  createdAt: Scalars['Time']['output'];
  id: Scalars['UUID']['output'];
  kind: FavoriteKind;
  position: Scalars['String']['output'];
  targetId: Scalars['UUID']['output'];
  updatedAt: Scalars['Time']['output'];
  userId: Scalars['UUID']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type FavoriteKind =
  | 'ISSUE'
  | 'LABEL'
  | 'TEAM'
  | 'VIEW';

export type FavoritePayload = MutationResult & {
  favorite: Favorite;
  version: Scalars['Int']['output'];
};

export type Invite = {
  acceptedAt?: Maybe<Scalars['Time']['output']>;
  createdAt: Scalars['Time']['output'];
  email: Scalars['String']['output'];
  expiresAt: Scalars['Time']['output'];
  id: Scalars['UUID']['output'];
  invitedBy?: Maybe<Scalars['UUID']['output']>;
  revokedAt?: Maybe<Scalars['Time']['output']>;
  role: UserRole;
  teamIds: Array<Scalars['UUID']['output']>;
  workspaceId: Scalars['UUID']['output'];
};

export type InviteInput = {
  email: Scalars['String']['input'];
  role?: InputMaybe<UserRole>;
  teamIds?: InputMaybe<Array<Scalars['UUID']['input']>>;
};

/**
 * Creating an invitation, and the one-time token that goes in the email.
 *
 * Deliberately not a `MutationResult`: an invite is not a replicated entity, so there is no
 * sync version for it to land at, and inventing one would be a number no client could use.
 * The token behaves exactly like an API key's — it exists in this response and nowhere else,
 * because only its SHA-256 is stored, so a database leak does not hand out workspace access.
 */
export type InvitePayload = {
  email: Scalars['String']['output'];
  expiresAt: Scalars['Time']['output'];
  id: Scalars['UUID']['output'];
  role: UserRole;
  /** Shown once. Put it in the invitation link; it is not recoverable afterwards. */
  token: Scalars['String']['output'];
};

export type Issue = {
  archivedAt?: Maybe<Scalars['Time']['output']>;
  assignee?: Maybe<User>;
  assigneeId?: Maybe<Scalars['UUID']['output']>;
  /** Set when the auto-close engine moved this issue to a closed status. Cleared on reopen. */
  autoClosedAt?: Maybe<Scalars['Time']['output']>;
  /** Issues that block this one — the same rows read from the other end. */
  blockedBy: Array<IssueRelation>;
  canceledAt?: Maybe<Scalars['Time']['output']>;
  children: Array<Issue>;
  comments: Array<Comment>;
  completedAt?: Maybe<Scalars['Time']['output']>;
  createdAt: Scalars['Time']['output'];
  creator?: Maybe<User>;
  creatorId?: Maybe<Scalars['UUID']['output']>;
  cycle?: Maybe<Cycle>;
  /** At most one cycle, and it has to belong to the issue's team. */
  cycleId?: Maybe<Scalars['UUID']['output']>;
  /**
   * When the issue was moved to the trash. Only ever set on a row `deletedIssues` returned:
   * every other read in the product filters deleted rows out, and the sync stream carries a
   * delete rather than the row, so a client holding an issue with this set is holding
   * something it should already have dropped.
   */
  deletedAt?: Maybe<Scalars['Time']['output']>;
  /**
   * Who moved it there. Null for a deletion that predates the column, and for one performed
   * by the retention sweep rather than by a person.
   */
  deletedBy?: Maybe<Scalars['UUID']['output']>;
  description: Scalars['String']['output'];
  /**
   * A calendar day, `2006-01-02`. Not a timestamp: a due date is a day in the team's
   * timezone, and as an instant it becomes due on the previous day for everybody west of
   * whoever set it.
   */
  dueDate?: Maybe<Scalars['String']['output']>;
  dueDateSource: DueDateSource;
  /** The raw point value. Null is unestimated, which is not zero. */
  estimate?: Maybe<Scalars['Int']['output']>;
  history: Array<IssueHistoryEntry>;
  id: Scalars['UUID']['output'];
  /**
   * Derived from the team key and number, never stored. The team key is mutable, and a
   * stored identifier would mean rewriting every issue in a team to fix a typo in its key.
   */
  identifier: Scalars['String']['output'];
  labels: Array<Label>;
  number: Scalars['Int']['output'];
  parent?: Maybe<Issue>;
  parentId?: Maybe<Scalars['UUID']['output']>;
  /** 0 none, 1 urgent, 2 high, 3 medium, 4 low. A fixed scale. */
  priority: Scalars['Int']['output'];
  /** Rolled up from the children. Zero children means null, not zero per cent. */
  progress?: Maybe<IssueProgress>;
  project?: Maybe<Project>;
  /** At most one project. Two projects on one issue is unrepresentable. */
  projectId?: Maybe<Scalars['UUID']['output']>;
  projectMilestone?: Maybe<ProjectMilestone>;
  /** A milestone implies its project. */
  projectMilestoneId?: Maybe<Scalars['UUID']['output']>;
  /** Relations where this issue is the subject. */
  relations: Array<IssueRelation>;
  /** Hidden from the triage inbox until this instant, or until the next edit or comment. */
  snoozedUntil?: Maybe<Scalars['Time']['output']>;
  /** Fractional index. Manual order is workspace-global, not per-user and not per-view. */
  sortOrder: Scalars['String']['output'];
  startedAt?: Maybe<Scalars['Time']['output']>;
  state: WorkflowState;
  stateId: Scalars['UUID']['output'];
  /** Order among siblings, independent of sortOrder — a checklist's order is not the backlog's. */
  subIssueSortOrder?: Maybe<Scalars['String']['output']>;
  subscribers: Array<IssueSubscription>;
  team: Team;
  teamId: Scalars['UUID']['output'];
  /** Which template made this issue, for the question "is this template still worth having". */
  templateId?: Maybe<Scalars['UUID']['output']>;
  title: Scalars['String']['output'];
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

/**
 * The activity feed. Distinct from the change log that drives sync: this one is curated,
 * permanent, and folds a run of edits by one person into a single entry.
 */
export type IssueHistoryEntry = {
  actor: Actor;
  createdAt: Scalars['Time']['output'];
  fromValue?: Maybe<Scalars['JSON']['output']>;
  id: Scalars['UUID']['output'];
  issueId: Scalars['UUID']['output'];
  kind: Scalars['String']['output'];
  toValue?: Maybe<Scalars['JSON']['output']>;
};

/**
 * One label applied to one issue, as an entity in its own right.
 *
 * That is the whole point. Labels are the first *set* the sync engine carries, and a set
 * written as a whole loses writes: two people adding different labels a second apart both
 * send the full new set and the second overwrites the first. As individual rows an add is an
 * upsert of one row and a remove is a delete of one, so both survive with no merge logic.
 */
export type IssueLabel = {
  createdAt: Scalars['Time']['output'];
  createdBy?: Maybe<Scalars['UUID']['output']>;
  groupId?: Maybe<Scalars['UUID']['output']>;
  id: Scalars['UUID']['output'];
  issueId: Scalars['UUID']['output'];
  label: Label;
  labelId: Scalars['UUID']['output'];
  teamId: Scalars['UUID']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type IssueLabelPayload = MutationResult & {
  issueLabel: IssueLabel;
  version: Scalars['Int']['output'];
};

export type IssuePayload = MutationResult & {
  issue: Issue;
  version: Scalars['Int']['output'];
};

/** Sub-issue completion, rolled up. Counts direct children only; a deep tree would make a list view walk the whole graph per row. */
export type IssueProgress = {
  canceled: Scalars['Int']['output'];
  completed: Scalars['Int']['output'];
  /** completed / (total - canceled), rounded, 0–100. Cancelled work is not incomplete work. */
  percent: Scalars['Int']['output'];
  total: Scalars['Int']['output'];
};

export type IssueRelation = {
  createdAt: Scalars['Time']['output'];
  createdBy?: Maybe<Scalars['UUID']['output']>;
  id: Scalars['UUID']['output'];
  issue: Issue;
  issueId: Scalars['UUID']['output'];
  relatedIssue: Issue;
  relatedIssueId: Scalars['UUID']['output'];
  relatedTeamId: Scalars['UUID']['output'];
  teamId: Scalars['UUID']['output'];
  type: RelationType;
  workspaceId: Scalars['UUID']['output'];
};

export type IssueRelationPayload = MutationResult & {
  relation: IssueRelation;
  version: Scalars['Int']['output'];
};

export type IssueSubscription = {
  createdAt: Scalars['Time']['output'];
  id: Scalars['UUID']['output'];
  issueId: Scalars['UUID']['output'];
  reason: SubscriptionReason;
  /**
   * An explicit unsubscribe is a flag, not a missing row. Deleting the row would mean the
   * next comment re-subscribes you, so unsubscribe would work for about four minutes.
   */
  unsubscribed: Scalars['Boolean']['output'];
  updatedAt: Scalars['Time']['output'];
  userId: Scalars['UUID']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type IssueTemplate = {
  archivedAt?: Maybe<Scalars['Time']['output']>;
  body: Scalars['String']['output'];
  createdAt: Scalars['Time']['output'];
  createdBy?: Maybe<Scalars['UUID']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['UUID']['output'];
  name: Scalars['String']['output'];
  position: Scalars['String']['output'];
  /** Keys are the same names createIssue takes. */
  properties: Scalars['JSON']['output'];
  /** Null means the template is offered in every team. */
  teamId?: Maybe<Scalars['UUID']['output']>;
  title: Scalars['String']['output'];
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type IssueTemplatePayload = MutationResult & {
  template: IssueTemplate;
  version: Scalars['Int']['output'];
};

/**
 * Both a label and a group of labels: a group is a label with `isGroup` set.
 *
 * One entity rather than two tables means one picker, one permission rule and one place
 * where scoping is decided. A group has exactly the fields a label has.
 */
export type Label = {
  archivedAt?: Maybe<Scalars['Time']['output']>;
  color: Scalars['String']['output'];
  createdAt: Scalars['Time']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['UUID']['output'];
  /**
   * Declared, not derived from "has children" — a group you have just created has no
   * children yet, and under that definition would stay applicable until somebody added one.
   */
  isGroup: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  /** The group this label sits in. Nesting is one level. */
  parentId?: Maybe<Scalars['UUID']['output']>;
  position: Scalars['String']['output'];
  /** Null means the label belongs to the whole workspace. */
  teamId?: Maybe<Scalars['UUID']['output']>;
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type LabelPayload = MutationResult & {
  label: Label;
  version: Scalars['Int']['output'];
};

export type Mutation = {
  acceptTriageIssue: IssuePayload;
  addFavorite: FavoritePayload;
  /**
   * Adds one label. Not "set the labels": a whole-set write means two people adding
   * different labels a second apart produce one winner and one silently lost edit.
   */
  addIssueLabel: IssueLabelPayload;
  addProjectMember: ProjectMemberPayload;
  addProjectTeam: ProjectTeamPayload;
  addTeamMember: TeamMembershipPayload;
  archiveCycle: DeletePayload;
  archiveIssue: DeletePayload;
  /** Retires a template, or brings one back. */
  archiveIssueTemplate: DeletePayload;
  /**
   * Retires a label, or brings one back.
   *
   * Un-archiving is refused while the group the label sits in is still archived: the label
   * would reappear in the picker under a heading nothing can resolve, which is the same state
   * archiving a non-empty group is refused to prevent, reached from the other side.
   */
  archiveLabel: DeletePayload;
  archiveProject: DeletePayload;
  archiveProjectStatus: DeletePayload;
  /**
   * Retires a status, or brings one back. `archived: false` is the way back; without it the
   * only way to undo a mistaken archive is to create a new status, which is a different row
   * that no filter or saved view already points at.
   */
  archiveWorkflowState: DeletePayload;
  bulkUpdateIssues: BulkIssuePayload;
  /** Returns the token exactly once. It is not recoverable afterwards. */
  createApiKey: ApiKeyPayload;
  createComment: CommentPayload;
  createIssue: IssuePayload;
  createIssueRelation: IssueRelationPayload;
  createIssueTemplate: IssueTemplatePayload;
  createLabel: LabelPayload;
  createProject: ProjectPayload;
  createProjectMilestone: ProjectMilestonePayload;
  createProjectStatus: ProjectStatusPayload;
  createTeam: TeamPayload;
  createView: ViewPayload;
  createWorkflowState: WorkflowStatePayload;
  declineTriageIssue: IssuePayload;
  deleteComment: DeletePayload;
  deleteIssue: DeletePayload;
  deleteIssueRelation: DeletePayload;
  deleteNotification: DeletePayload;
  deleteProject: DeletePayload;
  deleteProjectMilestone: DeletePayload;
  deleteView: DeletePayload;
  inviteToWorkspace: InvitePayload;
  markAllNotificationsRead: NotificationsPayload;
  /** The issue being viewed is the duplicate; canonicalId is the one it duplicates. */
  markIssueDuplicate: IssuePayload;
  markNotificationRead: NotificationPayload;
  /**
   * Empties the trash. Admins only, and irreversible.
   *
   * This is a hard DELETE, and the blast radius is everything hanging off each issue: its
   * comments, its labels, its relations from both ends and its whole activity feed all go with
   * it, by foreign-key cascade. Sub-issues are not deleted — `issue.parent_id` is
   * ON DELETE SET NULL — but they are orphaned, and nothing afterwards records which parent
   * they had. There is no restore, no trash behind the trash, and no version of the row left
   * anywhere but a database backup.
   *
   * `before` purges only what was deleted before that instant, which is what makes an
   * unattended retention sweep expressible; omit it to empty the trash completely.
   */
  purgeDeletedIssues: PurgePayload;
  removeFavorite: DeletePayload;
  removeIssueLabel: DeletePayload;
  removeProjectMember: DeletePayload;
  removeProjectTeam: DeletePayload;
  removeTeamMember: DeletePayload;
  removeUser: DeletePayload;
  resolveComment: CommentPayload;
  /** Restores a soft-deleted issue with its comments and relations, within the window. */
  restoreIssue: IssuePayload;
  restoreProject: ProjectPayload;
  revokeApiKey: DeletePayload;
  revokeInvite: DeletePayload;
  setIssueSubscription: SubscriptionPayload;
  setUserRole: UserPayload;
  setViewPreference: ViewPreferencePayload;
  snoozeIssue: IssuePayload;
  snoozeNotification: NotificationPayload;
  suspendUser: UserPayload;
  updateComment: CommentPayload;
  updateIssue: IssuePayload;
  updateIssueTemplate: IssueTemplatePayload;
  updateLabel: LabelPayload;
  updateNotificationPrefs: UserPayload;
  updateProfile: UserPayload;
  updateProject: ProjectPayload;
  updateProjectMilestone: ProjectMilestonePayload;
  updateProjectStatus: ProjectStatusPayload;
  updateTeam: TeamPayload;
  updateTeamArchive: TeamPayload;
  updateTeamCycles: TeamPayload;
  updateTeamEstimates: TeamPayload;
  updateTeamTriage: TeamPayload;
  updateView: ViewPayload;
  updateWorkflowState: WorkflowStatePayload;
  updateWorkspace: WorkspacePayload;
};


export type MutationAcceptTriageIssueArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationAddFavoriteArgs = {
  afterFavoriteId?: InputMaybe<Scalars['UUID']['input']>;
  kind: FavoriteKind;
  targetId: Scalars['UUID']['input'];
};


export type MutationAddIssueLabelArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  issueId: Scalars['UUID']['input'];
  labelId: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationAddProjectMemberArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  opId?: InputMaybe<Scalars['UUID']['input']>;
  projectId: Scalars['UUID']['input'];
  userId: Scalars['UUID']['input'];
};


export type MutationAddProjectTeamArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  opId?: InputMaybe<Scalars['UUID']['input']>;
  projectId: Scalars['UUID']['input'];
  teamId: Scalars['UUID']['input'];
};


export type MutationAddTeamMemberArgs = {
  role?: InputMaybe<TeamRole>;
  teamId: Scalars['UUID']['input'];
  userId: Scalars['UUID']['input'];
};


export type MutationArchiveCycleArgs = {
  archived: Scalars['Boolean']['input'];
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationArchiveIssueArgs = {
  archived: Scalars['Boolean']['input'];
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationArchiveIssueTemplateArgs = {
  archived: Scalars['Boolean']['input'];
  id: Scalars['UUID']['input'];
};


export type MutationArchiveLabelArgs = {
  archived: Scalars['Boolean']['input'];
  id: Scalars['UUID']['input'];
};


export type MutationArchiveProjectArgs = {
  archived: Scalars['Boolean']['input'];
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationArchiveProjectStatusArgs = {
  archived: Scalars['Boolean']['input'];
  id: Scalars['UUID']['input'];
};


export type MutationArchiveWorkflowStateArgs = {
  archived: Scalars['Boolean']['input'];
  id: Scalars['UUID']['input'];
};


export type MutationBulkUpdateIssuesArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: BulkUpdateIssuesInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateApiKeyArgs = {
  input: CreateApiKeyInput;
};


export type MutationCreateCommentArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateCommentInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateIssueArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateIssueInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateIssueRelationArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  issueId: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
  relatedIssueId: Scalars['UUID']['input'];
  type: RelationType;
};


export type MutationCreateIssueTemplateArgs = {
  input: CreateIssueTemplateInput;
};


export type MutationCreateLabelArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateLabelInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateProjectArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateProjectInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateProjectMilestoneArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateProjectMilestoneInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateProjectStatusArgs = {
  input: CreateProjectStatusInput;
};


export type MutationCreateTeamArgs = {
  input: CreateTeamInput;
};


export type MutationCreateViewArgs = {
  input: CreateViewInput;
};


export type MutationCreateWorkflowStateArgs = {
  input: CreateWorkflowStateInput;
};


export type MutationDeclineTriageIssueArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationDeleteCommentArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationDeleteIssueArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationDeleteIssueRelationArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationDeleteNotificationArgs = {
  id: Scalars['UUID']['input'];
};


export type MutationDeleteProjectArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationDeleteProjectMilestoneArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationDeleteViewArgs = {
  id: Scalars['UUID']['input'];
};


export type MutationInviteToWorkspaceArgs = {
  input: InviteInput;
};


export type MutationMarkIssueDuplicateArgs = {
  canonicalId: Scalars['UUID']['input'];
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationMarkNotificationReadArgs = {
  id: Scalars['UUID']['input'];
  read: Scalars['Boolean']['input'];
};


export type MutationPurgeDeletedIssuesArgs = {
  before?: InputMaybe<Scalars['Time']['input']>;
};


export type MutationRemoveFavoriteArgs = {
  kind: FavoriteKind;
  targetId: Scalars['UUID']['input'];
};


export type MutationRemoveIssueLabelArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  issueId: Scalars['UUID']['input'];
  labelId: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationRemoveProjectMemberArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  opId?: InputMaybe<Scalars['UUID']['input']>;
  projectId: Scalars['UUID']['input'];
  userId: Scalars['UUID']['input'];
};


export type MutationRemoveProjectTeamArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  opId?: InputMaybe<Scalars['UUID']['input']>;
  projectId: Scalars['UUID']['input'];
  teamId: Scalars['UUID']['input'];
};


export type MutationRemoveTeamMemberArgs = {
  teamId: Scalars['UUID']['input'];
  userId: Scalars['UUID']['input'];
};


export type MutationRemoveUserArgs = {
  userId: Scalars['UUID']['input'];
};


export type MutationResolveCommentArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
  resolved: Scalars['Boolean']['input'];
};


export type MutationRestoreIssueArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationRestoreProjectArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationRevokeApiKeyArgs = {
  id: Scalars['UUID']['input'];
};


export type MutationRevokeInviteArgs = {
  id: Scalars['UUID']['input'];
};


export type MutationSetIssueSubscriptionArgs = {
  issueId: Scalars['UUID']['input'];
  subscribed: Scalars['Boolean']['input'];
};


export type MutationSetUserRoleArgs = {
  role: UserRole;
  userId: Scalars['UUID']['input'];
};


export type MutationSetViewPreferenceArgs = {
  display: Scalars['JSON']['input'];
  viewKey: Scalars['String']['input'];
};


export type MutationSnoozeIssueArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
  until: Scalars['Time']['input'];
};


export type MutationSnoozeNotificationArgs = {
  id: Scalars['UUID']['input'];
  until?: InputMaybe<Scalars['Time']['input']>;
};


export type MutationSuspendUserArgs = {
  suspended: Scalars['Boolean']['input'];
  userId: Scalars['UUID']['input'];
};


export type MutationUpdateCommentArgs = {
  body: Scalars['String']['input'];
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationUpdateIssueArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: UpdateIssueInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationUpdateIssueTemplateArgs = {
  input: UpdateIssueTemplateInput;
};


export type MutationUpdateLabelArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: UpdateLabelInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationUpdateNotificationPrefsArgs = {
  prefs: Scalars['JSON']['input'];
};


export type MutationUpdateProfileArgs = {
  input: UpdateProfileInput;
};


export type MutationUpdateProjectArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: UpdateProjectInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationUpdateProjectMilestoneArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: UpdateProjectMilestoneInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationUpdateProjectStatusArgs = {
  input: UpdateProjectStatusInput;
};


export type MutationUpdateTeamArgs = {
  input: UpdateTeamInput;
};


export type MutationUpdateTeamArchiveArgs = {
  input: UpdateTeamArchiveInput;
};


export type MutationUpdateTeamCyclesArgs = {
  input: UpdateTeamCyclesInput;
};


export type MutationUpdateTeamEstimatesArgs = {
  input: UpdateTeamEstimatesInput;
};


export type MutationUpdateTeamTriageArgs = {
  input: UpdateTeamTriageInput;
};


export type MutationUpdateViewArgs = {
  input: UpdateViewInput;
};


export type MutationUpdateWorkflowStateArgs = {
  input: UpdateWorkflowStateInput;
};


export type MutationUpdateWorkspaceArgs = {
  input: UpdateWorkspaceInput;
};

/**
 * Every mutation returns the sync version its write landed at, so an optimistic client can
 * tell whether the delta it just received is ahead of or behind its own change without
 * guessing from timestamps.
 */
export type MutationResult = {
  version: Scalars['Int']['output'];
};

/**
 * One inbox row, derived from a change_log row.
 *
 * That derivation is the commitment: "what happened" already has a definition, and
 * re-deriving it from entities produces a second one that disagrees within a month.
 */
export type Notification = {
  actor: Actor;
  /** Traces this row back to the exact mutation that produced it. */
  changeVersion: Scalars['Int']['output'];
  commentId?: Maybe<Scalars['UUID']['output']>;
  /** How many events collapsed into this row. */
  count: Scalars['Int']['output'];
  createdAt: Scalars['Time']['output'];
  /**
   * The coalescing key, and the reason a bulk update of two hundred issues produces one
   * inbox row per person rather than two hundred.
   */
  groupKey: Scalars['String']['output'];
  id: Scalars['UUID']['output'];
  issue?: Maybe<Issue>;
  issueId?: Maybe<Scalars['UUID']['output']>;
  payload?: Maybe<Scalars['JSON']['output']>;
  readAt?: Maybe<Scalars['Time']['output']>;
  snoozedUntil?: Maybe<Scalars['Time']['output']>;
  type: NotificationType;
  updatedAt: Scalars['Time']['output'];
  userId: Scalars['UUID']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type NotificationPayload = MutationResult & {
  notification: Notification;
  version: Scalars['Int']['output'];
};

export type NotificationType =
  | 'COMMENT'
  | 'ISSUE_ASSIGNED'
  | 'ISSUE_BLOCKED'
  | 'ISSUE_DUE'
  | 'ISSUE_PRIORITY_RAISED'
  | 'ISSUE_STATUS_CHANGED'
  | 'MENTION'
  | 'SUB_ISSUE_COMPLETED';

/** Marking a whole inbox read is one mutation, not one per row — which is also what stops it minting one sync version per notification. */
export type NotificationsPayload = MutationResult & {
  notifications: Array<Notification>;
  version: Scalars['Int']['output'];
};

export type Project = {
  archivedAt?: Maybe<Scalars['Time']['output']>;
  color: Scalars['String']['output'];
  createdAt: Scalars['Time']['output'];
  creator?: Maybe<User>;
  creatorId?: Maybe<Scalars['UUID']['output']>;
  deletedAt?: Maybe<Scalars['Time']['output']>;
  deletedBy?: Maybe<Scalars['UUID']['output']>;
  description: Scalars['String']['output'];
  icon?: Maybe<Scalars['String']['output']>;
  id: Scalars['UUID']['output'];
  lead?: Maybe<User>;
  leadId?: Maybe<Scalars['UUID']['output']>;
  members: Array<ProjectMember>;
  milestones: Array<ProjectMilestone>;
  name: Scalars['String']['output'];
  priority: Scalars['Int']['output'];
  sortOrder: Scalars['String']['output'];
  startDate?: Maybe<Scalars['String']['output']>;
  startDateGranularity?: Maybe<TimeframeGranularity>;
  status: ProjectStatus;
  statusId: Scalars['UUID']['output'];
  summary?: Maybe<Scalars['String']['output']>;
  targetDate?: Maybe<Scalars['String']['output']>;
  targetDateGranularity?: Maybe<TimeframeGranularity>;
  teams: Array<ProjectTeam>;
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type ProjectMember = {
  createdAt: Scalars['Time']['output'];
  id: Scalars['UUID']['output'];
  projectId: Scalars['UUID']['output'];
  user: User;
  userId: Scalars['UUID']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type ProjectMemberPayload = MutationResult & {
  projectMember: ProjectMember;
  version: Scalars['Int']['output'];
};

export type ProjectMilestone = {
  archivedAt?: Maybe<Scalars['Time']['output']>;
  createdAt: Scalars['Time']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['UUID']['output'];
  name: Scalars['String']['output'];
  projectId: Scalars['UUID']['output'];
  sortOrder: Scalars['String']['output'];
  targetDate?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type ProjectMilestonePayload = MutationResult & {
  milestone: ProjectMilestone;
  version: Scalars['Int']['output'];
};

export type ProjectPayload = MutationResult & {
  project: Project;
  version: Scalars['Int']['output'];
};

export type ProjectStatus = {
  archivedAt?: Maybe<Scalars['Time']['output']>;
  category: ProjectStatusCategory;
  color: Scalars['String']['output'];
  createdAt: Scalars['Time']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['UUID']['output'];
  isDefault: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  position: Scalars['String']['output'];
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type ProjectStatusCategory =
  | 'BACKLOG'
  | 'CANCELED'
  | 'COMPLETED'
  | 'PLANNED'
  | 'STARTED';

export type ProjectStatusPayload = MutationResult & {
  status: ProjectStatus;
  version: Scalars['Int']['output'];
};

export type ProjectTeam = {
  createdAt: Scalars['Time']['output'];
  id: Scalars['UUID']['output'];
  projectId: Scalars['UUID']['output'];
  team: Team;
  teamId: Scalars['UUID']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type ProjectTeamPayload = MutationResult & {
  projectTeam: ProjectTeam;
  version: Scalars['Int']['output'];
};

/**
 * What a purge destroyed.
 *
 * A list of ids rather than a single one, and no entities: after this response the rows named
 * here do not exist in any table, so there is nothing left to return and nothing any client
 * can do with the ids except confirm what it already dropped.
 */
export type PurgePayload = MutationResult & {
  /** The issues that no longer exist. Empty when the trash was already empty. */
  ids: Array<Scalars['UUID']['output']>;
  /**
   * How many rows were eligible and were left for the next call.
   *
   * A purge is bounded per call so that emptying a large trash cannot mint tens of thousands
   * of sync versions inside one transaction and stall every other writer in the workspace
   * behind the version lock. Zero means the trash is now empty; anything else means call it
   * again.
   */
  remaining: Scalars['Int']['output'];
  version: Scalars['Int']['output'];
};

export type Query = {
  /** The caller's own keys. Never anybody else's, and never the tokens. */
  apiKeys: Array<ApiKey>;
  archivedCycles: Array<Cycle>;
  /** Archived issues, cycles and projects for one team. Loaded on demand, never replicated. */
  archivedIssues: Array<Issue>;
  archivedProjects: Array<Project>;
  comments: Array<Comment>;
  cycle?: Maybe<Cycle>;
  cycles: Array<Cycle>;
  /**
   * Issues deleted within the restore window, so a mistaken delete is recoverable without a
   * support ticket.
   */
  deletedIssues: Array<Issue>;
  favorites: Array<Favorite>;
  /** Pending invitations. Admins only. */
  invites: Array<Invite>;
  issue?: Maybe<Issue>;
  issueByIdentifier?: Maybe<Issue>;
  issueHistory: Array<IssueHistoryEntry>;
  issueTemplate?: Maybe<IssueTemplate>;
  issueTemplates: Array<IssueTemplate>;
  issues: Array<Issue>;
  label?: Maybe<Label>;
  /** Every label the caller can see: workspace labels plus those of their teams. */
  labels: Array<Label>;
  /** Issues assigned to the caller, across every team they can see. */
  myIssues: Array<Issue>;
  /** The caller's inbox. Snoozed rows are excluded until they wake unless includeSnoozed. */
  notifications: Array<Notification>;
  project?: Maybe<Project>;
  projectStatuses: Array<ProjectStatus>;
  projects: Array<Project>;
  search: SearchResults;
  team?: Maybe<Team>;
  teamByKey?: Maybe<Team>;
  teams: Array<Team>;
  unreadNotificationCount: Scalars['Int']['output'];
  user?: Maybe<User>;
  users: Array<User>;
  view?: Maybe<View>;
  viewPreferences: Array<ViewPreference>;
  /** Everything the client needs to render its shell. */
  viewer: Viewer;
  /** Saved views the caller can see: shared ones in scope, plus their own private ones. */
  views: Array<View>;
  workflowStates: Array<WorkflowState>;
  workspace: Workspace;
};


export type QueryArchivedCyclesArgs = {
  teamId: Scalars['UUID']['input'];
};


export type QueryArchivedIssuesArgs = {
  teamId: Scalars['UUID']['input'];
};


export type QueryArchivedProjectsArgs = {
  teamId: Scalars['UUID']['input'];
};


export type QueryCommentsArgs = {
  issueId: Scalars['UUID']['input'];
};


export type QueryCycleArgs = {
  id: Scalars['UUID']['input'];
};


export type QueryCyclesArgs = {
  teamId: Scalars['UUID']['input'];
};


export type QueryIssueArgs = {
  id: Scalars['UUID']['input'];
};


export type QueryIssueByIdentifierArgs = {
  identifier: Scalars['String']['input'];
};


export type QueryIssueHistoryArgs = {
  issueId: Scalars['UUID']['input'];
};


export type QueryIssueTemplateArgs = {
  id: Scalars['UUID']['input'];
};


export type QueryIssueTemplatesArgs = {
  teamId?: InputMaybe<Scalars['UUID']['input']>;
};


export type QueryIssuesArgs = {
  teamId: Scalars['UUID']['input'];
};


export type QueryLabelArgs = {
  id: Scalars['UUID']['input'];
};


export type QueryMyIssuesArgs = {
  includeCompleted?: InputMaybe<Scalars['Boolean']['input']>;
};


export type QueryNotificationsArgs = {
  first?: InputMaybe<Scalars['Int']['input']>;
  includeRead?: InputMaybe<Scalars['Boolean']['input']>;
  includeSnoozed?: InputMaybe<Scalars['Boolean']['input']>;
};


export type QueryProjectArgs = {
  id: Scalars['UUID']['input'];
};


export type QuerySearchArgs = {
  input: SearchInput;
};


export type QueryTeamArgs = {
  id: Scalars['UUID']['input'];
};


export type QueryTeamByKeyArgs = {
  key: Scalars['String']['input'];
};


export type QueryUserArgs = {
  id: Scalars['UUID']['input'];
};


export type QueryViewArgs = {
  id: Scalars['UUID']['input'];
};


export type QueryWorkflowStatesArgs = {
  teamId: Scalars['UUID']['input'];
};

/**
 * `BLOCKS` is the only direction stored. "Blocked by" is the same row read from the other
 * end — storing both would allow two rows that disagree, which is a state no user can
 * explain or repair. `RELATED` is symmetric and stored with the smaller id first.
 */
export type RelationType =
  | 'BLOCKS'
  | 'DUPLICATE'
  | 'RELATED';

/**
 * What to search, and where.
 *
 * `query` goes through the same tokeniser as the index. `filter` is the same AST the views
 * use, so a search and a saved view with identical filters return identical ids — which is
 * one of this milestone's acceptance tests, and the reason there is one compiler.
 */
export type SearchInput = {
  filter?: InputMaybe<Scalars['JSON']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  /**
   * Widens the search to archived issues.
   *
   * It does not survive a filter that says nothing about archiving. The grammar hides archived
   * and deleted issues unless a clause names them, that default is part of what a filter means,
   * and the client's evaluator applies the same one — so the two are combined and the stricter
   * wins. To search archived issues with a filter, say `archived` in the filter. Anything else
   * would make one filter mean two things depending on where it was used.
   *
   * Deleted issues are never returned by search at all, whatever either says: the trash is its
   * own query, with its own window.
   */
  includeArchived?: InputMaybe<Scalars['Boolean']['input']>;
  query: Scalars['String']['input'];
  teamId?: InputMaybe<Scalars['UUID']['input']>;
};

export type SearchResults = {
  comments: Array<Comment>;
  /** Total matches before the limit, so the UI can say "showing 25 of 400". */
  issueCount: Scalars['Int']['output'];
  issues: Array<Issue>;
};

/**
 * The six status categories are fixed by the product. Teams create, rename and reorder
 * statuses *within* a category; they cannot invent categories, because cycle completion,
 * project progress, insights, triage semantics and the git integrations all branch on them.
 */
export type StateCategory =
  | 'BACKLOG'
  | 'CANCELED'
  | 'COMPLETED'
  /** System-managed. Reached by marking an issue as a duplicate, never assigned directly. */
  | 'DUPLICATE'
  | 'STARTED'
  | 'TRIAGE'
  | 'UNSTARTED';

export type SubscriptionPayload = MutationResult & {
  subscription: IssueSubscription;
  version: Scalars['Int']['output'];
};

/** Why somebody is subscribed, so the inbox can say why rather than leaving them to guess. */
export type SubscriptionReason =
  | 'ASSIGNED'
  | 'COMMENTED'
  | 'CREATED'
  | 'MANUAL'
  | 'MENTIONED'
  | 'SUBSCRIBED';

export type Team = {
  archivedAt?: Maybe<Scalars['Time']['output']>;
  /** Days of inactivity after close before archival. Zero is off. */
  autoArchiveDays: Scalars['Int']['output'];
  /** Close remaining sub-issues when the parent is done. */
  autoCloseChildren: Scalars['Boolean']['output'];
  /** Days of inactivity before an open issue is auto-closed. Zero is off. */
  autoCloseDays: Scalars['Int']['output'];
  /** Close a parent when every sub-issue is done. */
  autoCloseParent: Scalars['Boolean']['output'];
  color?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['Time']['output'];
  cycleAutoAddCompleted: Scalars['Boolean']['output'];
  cycleAutoAddStarted: Scalars['Boolean']['output'];
  /** Gap after each cycle, 0–8 weeks. A cooldown is not a cycle; issues cannot be assigned to it. */
  cycleCooldownWeeks: Scalars['Int']['output'];
  /** 1–8 weeks. */
  cycleDurationWeeks: Scalars['Int']['output'];
  /** Weekday the cycle begins at 00:01 in the team's timezone: monday…sunday. */
  cycleStartDay: Scalars['String']['output'];
  /** How many future cycles to keep pre-created, 1–15. */
  cycleUpcomingCount: Scalars['Int']['output'];
  cycles: Array<Cycle>;
  /** Off by default. Turning it on creates the current cycle and the configured upcoming ones. */
  cyclesEnabled: Scalars['Boolean']['output'];
  description?: Maybe<Scalars['String']['output']>;
  /** Whether 0 is offered. For some teams a zero estimate is always a mistake, and offering it invites one. */
  estimateAllowZero: Scalars['Boolean']['output'];
  /** Extends the scale's top end. */
  estimateExtended: Scalars['Boolean']['output'];
  estimateScale: EstimateScale;
  icon?: Maybe<Scalars['String']['output']>;
  id: Scalars['UUID']['output'];
  issues: Array<Issue>;
  /** The identifier prefix: ENG in ENG-123. */
  key: Scalars['String']['output'];
  labels: Array<Label>;
  members: Array<TeamMembership>;
  name: Scalars['String']['output'];
  parentTeamId?: Maybe<Scalars['UUID']['output']>;
  private: Scalars['Boolean']['output'];
  retiredAt?: Maybe<Scalars['Time']['output']>;
  states: Array<WorkflowState>;
  templates: Array<IssueTemplate>;
  timezone: Scalars['String']['output'];
  /** Off by default. Turning it on creates the Triage and Duplicate statuses if they are missing. */
  triageEnabled: Scalars['Boolean']['output'];
  /** An issue cannot leave Triage without a priority other than none. */
  triageRequirePriority: Scalars['Boolean']['output'];
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type TeamMembership = {
  createdAt: Scalars['Time']['output'];
  id: Scalars['UUID']['output'];
  role: TeamRole;
  teamId: Scalars['UUID']['output'];
  updatedAt: Scalars['Time']['output'];
  userId: Scalars['UUID']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type TeamMembershipPayload = MutationResult & {
  membership: TeamMembership;
  version: Scalars['Int']['output'];
};

export type TeamPayload = MutationResult & {
  team: Team;
  version: Scalars['Int']['output'];
};

export type TeamRole =
  | 'MEMBER'
  | 'OWNER';

export type TimeframeGranularity =
  | 'DAY'
  | 'HALF'
  | 'MONTH'
  | 'QUARTER'
  | 'YEAR';

export type UpdateIssueInput = {
  afterIssueId?: InputMaybe<Scalars['UUID']['input']>;
  /** Place among a parent's children. Only meaningful when the issue has a parent. */
  afterSiblingId?: InputMaybe<Scalars['UUID']['input']>;
  assigneeId?: InputMaybe<Scalars['UUID']['input']>;
  /**
   * Explicitly unassign. Needed because a null assigneeId is indistinguishable from
   * "leave it alone" in a partial update.
   */
  clearAssignee?: InputMaybe<Scalars['Boolean']['input']>;
  clearCycle?: InputMaybe<Scalars['Boolean']['input']>;
  clearDueDate?: InputMaybe<Scalars['Boolean']['input']>;
  /** Same reason as clearAssignee: null means "leave it alone". */
  clearEstimate?: InputMaybe<Scalars['Boolean']['input']>;
  clearMilestone?: InputMaybe<Scalars['Boolean']['input']>;
  clearParent?: InputMaybe<Scalars['Boolean']['input']>;
  clearProject?: InputMaybe<Scalars['Boolean']['input']>;
  cycleId?: InputMaybe<Scalars['UUID']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  dueDate?: InputMaybe<Scalars['String']['input']>;
  estimate?: InputMaybe<Scalars['Int']['input']>;
  id: Scalars['UUID']['input'];
  moveToTop?: InputMaybe<Scalars['Boolean']['input']>;
  parentId?: InputMaybe<Scalars['UUID']['input']>;
  priority?: InputMaybe<Scalars['Int']['input']>;
  projectId?: InputMaybe<Scalars['UUID']['input']>;
  projectMilestoneId?: InputMaybe<Scalars['UUID']['input']>;
  stateId?: InputMaybe<Scalars['UUID']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateIssueTemplateInput = {
  body?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['UUID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  properties?: InputMaybe<Scalars['JSON']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateLabelInput = {
  afterLabelId?: InputMaybe<Scalars['UUID']['input']>;
  clearParent?: InputMaybe<Scalars['Boolean']['input']>;
  color?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['UUID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  parentId?: InputMaybe<Scalars['UUID']['input']>;
};

export type UpdateProfileInput = {
  avatarUrl?: InputMaybe<Scalars['String']['input']>;
  displayName?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  timezone?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateProjectInput = {
  clearLead?: InputMaybe<Scalars['Boolean']['input']>;
  clearStart?: InputMaybe<Scalars['Boolean']['input']>;
  clearTarget?: InputMaybe<Scalars['Boolean']['input']>;
  color?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  icon?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['UUID']['input'];
  leadId?: InputMaybe<Scalars['UUID']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  priority?: InputMaybe<Scalars['Int']['input']>;
  startDate?: InputMaybe<Scalars['String']['input']>;
  startDateGranularity?: InputMaybe<TimeframeGranularity>;
  statusId?: InputMaybe<Scalars['UUID']['input']>;
  summary?: InputMaybe<Scalars['String']['input']>;
  targetDate?: InputMaybe<Scalars['String']['input']>;
  targetDateGranularity?: InputMaybe<TimeframeGranularity>;
};

export type UpdateProjectMilestoneInput = {
  clearTarget?: InputMaybe<Scalars['Boolean']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['UUID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  targetDate?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateProjectStatusInput = {
  category?: InputMaybe<ProjectStatusCategory>;
  color?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['UUID']['input'];
  isDefault?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateTeamArchiveInput = {
  autoArchiveDays?: InputMaybe<Scalars['Int']['input']>;
  autoCloseChildren?: InputMaybe<Scalars['Boolean']['input']>;
  autoCloseDays?: InputMaybe<Scalars['Int']['input']>;
  autoCloseParent?: InputMaybe<Scalars['Boolean']['input']>;
  teamId: Scalars['UUID']['input'];
};

export type UpdateTeamCyclesInput = {
  autoAddCompleted?: InputMaybe<Scalars['Boolean']['input']>;
  autoAddStarted?: InputMaybe<Scalars['Boolean']['input']>;
  cooldownWeeks?: InputMaybe<Scalars['Int']['input']>;
  durationWeeks?: InputMaybe<Scalars['Int']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  startDay?: InputMaybe<Scalars['String']['input']>;
  teamId: Scalars['UUID']['input'];
  upcomingCount?: InputMaybe<Scalars['Int']['input']>;
};

export type UpdateTeamEstimatesInput = {
  allowZero?: InputMaybe<Scalars['Boolean']['input']>;
  extended?: InputMaybe<Scalars['Boolean']['input']>;
  scale: EstimateScale;
  teamId: Scalars['UUID']['input'];
};

export type UpdateTeamInput = {
  color?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  icon?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['UUID']['input'];
  key?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  private?: InputMaybe<Scalars['Boolean']['input']>;
  timezone?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateTeamTriageInput = {
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  requirePriority?: InputMaybe<Scalars['Boolean']['input']>;
  teamId: Scalars['UUID']['input'];
};

export type UpdateViewInput = {
  afterViewId?: InputMaybe<Scalars['UUID']['input']>;
  color?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  display?: InputMaybe<Scalars['JSON']['input']>;
  filter?: InputMaybe<Scalars['JSON']['input']>;
  icon?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['UUID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateWorkflowStateInput = {
  afterStateId?: InputMaybe<Scalars['UUID']['input']>;
  color?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['UUID']['input'];
  makeDefault?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateWorkspaceInput = {
  logoUrl?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
};

export type User = {
  archivedAt?: Maybe<Scalars['Time']['output']>;
  avatarUrl?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['Time']['output'];
  displayName: Scalars['String']['output'];
  /** Populated only for the viewer themselves and for admins. */
  email?: Maybe<Scalars['String']['output']>;
  id: Scalars['UUID']['output'];
  kind: UserKind;
  lastSeenAt?: Maybe<Scalars['Time']['output']>;
  name: Scalars['String']['output'];
  /**
   * Per-channel, per-type delivery toggles. Opaque on purpose: read whole at delivery time
   * and never filtered on, so a field per toggle would be a schema change every time a
   * notification type is added.
   */
  notificationPrefs?: Maybe<Scalars['JSON']['output']>;
  role: UserRole;
  status: UserStatus;
  timezone: Scalars['String']['output'];
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

/** Humans sign in; agents are installed. Both appear as users so that assignee, mention and actor keep one foreign key target. */
export type UserKind =
  | 'APP'
  | 'HUMAN';

export type UserPayload = MutationResult & {
  user: User;
  version: Scalars['Int']['output'];
};

export type UserRole =
  | 'ADMIN'
  | 'GUEST'
  | 'MEMBER'
  | 'OWNER';

export type UserStatus =
  | 'ACTIVE'
  | 'SUSPENDED';

/** A saved filter plus how to display it. */
export type View = {
  archivedAt?: Maybe<Scalars['Time']['output']>;
  color?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['Time']['output'];
  createdBy?: Maybe<Scalars['UUID']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  /** Grouping, ordering, layout, and which properties are shown. */
  display: Scalars['JSON']['output'];
  /**
   * The filter AST.
   *
   * Deliberately not a typed GraphQL tree. The grammar has exactly one definition — the
   * compiler in internal/filter — and a parallel set of GraphQL input and output types would
   * be a second one, which is the precise failure this milestone set out to avoid: a filter
   * meaning one thing in a view and another in search. The compiler validates at the
   * boundary and rejects anything it does not recognise.
   */
  filter: Scalars['JSON']['output'];
  icon?: Maybe<Scalars['String']['output']>;
  id: Scalars['UUID']['output'];
  name: Scalars['String']['output'];
  /** Null means shared. Set means it is that person's private view. */
  ownerId?: Maybe<Scalars['UUID']['output']>;
  position: Scalars['String']['output'];
  /** Null means the view spans the workspace. */
  teamId?: Maybe<Scalars['UUID']['output']>;
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type ViewPayload = MutationResult & {
  version: Scalars['Int']['output'];
  view: View;
};

/**
 * Display options for the views that have no row of their own — Team issues, My issues and
 * the rest. On the server rather than in localStorage because the grouping you chose has to
 * follow you to your other machine.
 */
export type ViewPreference = {
  createdAt: Scalars['Time']['output'];
  display: Scalars['JSON']['output'];
  id: Scalars['UUID']['output'];
  updatedAt: Scalars['Time']['output'];
  userId: Scalars['UUID']['output'];
  viewKey: Scalars['String']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type ViewPreferencePayload = MutationResult & {
  preference: ViewPreference;
  version: Scalars['Int']['output'];
};

/** What the client needs on boot, before it opens the sync socket. */
export type Viewer = {
  /** The sync watermark at the time of this response. */
  syncVersion: Scalars['Int']['output'];
  user: User;
  workspace: Workspace;
  /** Every workspace this account belongs to, for the switcher. */
  workspaces: Array<Workspace>;
};

export type WorkflowState = {
  archivedAt?: Maybe<Scalars['Time']['output']>;
  category: StateCategory;
  color: Scalars['String']['output'];
  createdAt: Scalars['Time']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['UUID']['output'];
  isDefault: Scalars['Boolean']['output'];
  isSystem: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  /** Fractional index. Ordering within a category; never compared across categories. */
  position: Scalars['String']['output'];
  teamId: Scalars['UUID']['output'];
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type WorkflowStatePayload = MutationResult & {
  state: WorkflowState;
  version: Scalars['Int']['output'];
};

export type Workspace = {
  archivedAt?: Maybe<Scalars['Time']['output']>;
  createdAt: Scalars['Time']['output'];
  /** What this workspace's plan permits, resolved by one service rather than scattered plan checks. */
  entitlements: Entitlements;
  id: Scalars['UUID']['output'];
  labels: Array<Label>;
  logoUrl?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  plan: Scalars['String']['output'];
  planExpiresAt?: Maybe<Scalars['Time']['output']>;
  /**
   * Set when a paid plan has lapsed. Reads keep working and writes needing a paid feature do
   * not — locking people out of their own data over a failed card is not a business model.
   */
  planLapsedAt?: Maybe<Scalars['Time']['output']>;
  /** Overrides the plan's default seat count. Null means whatever the plan says. */
  seatLimit?: Maybe<Scalars['Int']['output']>;
  teams: Array<Team>;
  updatedAt: Scalars['Time']['output'];
  /** The address segment: /<urlKey>/issue/ENG-1. */
  urlKey: Scalars['String']['output'];
  users: Array<User>;
};

export type WorkspacePayload = MutationResult & {
  version: Scalars['Int']['output'];
  workspace: Workspace;
};

export type EntitlementsQueryVariables = Exact<{ [key: string]: never; }>;


export type EntitlementsQuery = { workspace: { id: string, name: string, plan: string, planExpiresAt?: string | null, planLapsedAt?: string | null, seatLimit?: number | null, entitlements: { plan: string, seatLimit?: number | null, seatsUsed: number, teamLimit?: number | null, historyDays?: number | null, privateTeams: boolean, customViews: boolean, apiKeys: boolean, sso: boolean, auditLog: boolean, lapsed: boolean } } };

export type InvitesQueryVariables = Exact<{ [key: string]: never; }>;


export type InvitesQuery = { invites: Array<{ id: string, email: string, role: UserRole, invitedBy?: string | null, teamIds: Array<string>, expiresAt: string, createdAt: string }> };

export type InviteToWorkspaceMutationVariables = Exact<{
  input: InviteInput;
}>;


export type InviteToWorkspaceMutation = { inviteToWorkspace: { id: string, email: string, role: UserRole, expiresAt: string, token: string } };

export type RevokeInviteMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
}>;


export type RevokeInviteMutation = { revokeInvite: { version: number, id: string } };

export type RemoveUserMutationVariables = Exact<{
  userId: Scalars['UUID']['input'];
}>;


export type RemoveUserMutation = { removeUser: { version: number, id: string } };

export type DeletedIssuesQueryVariables = Exact<{ [key: string]: never; }>;


export type DeletedIssuesQuery = { deletedIssues: Array<{ id: string, workspaceId: string, teamId: string, number: number, identifier: string, title: string, description: string, stateId: string, assigneeId?: string | null, creatorId?: string | null, priority: number, sortOrder: string, estimate?: number | null, dueDate?: string | null, dueDateSource: DueDateSource, parentId?: string | null, subIssueSortOrder?: string | null, templateId?: string | null, projectId?: string | null, projectMilestoneId?: string | null, cycleId?: string | null, snoozedUntil?: string | null, autoClosedAt?: string | null, startedAt?: string | null, completedAt?: string | null, canceledAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string }> };

export type RestoreIssueMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type RestoreIssueMutation = { restoreIssue: { version: number, issue: { id: string, workspaceId: string, teamId: string, number: number, identifier: string, title: string, description: string, stateId: string, assigneeId?: string | null, creatorId?: string | null, priority: number, sortOrder: string, estimate?: number | null, dueDate?: string | null, dueDateSource: DueDateSource, parentId?: string | null, subIssueSortOrder?: string | null, templateId?: string | null, projectId?: string | null, projectMilestoneId?: string | null, cycleId?: string | null, snoozedUntil?: string | null, autoClosedAt?: string | null, startedAt?: string | null, completedAt?: string | null, canceledAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string } } };

export type ApiKeyFieldsFragment = { id: string, userId: string, name: string, prefix: string, scopes: Array<string>, lastUsedAt?: string | null, expiresAt?: string | null, revokedAt?: string | null, createdAt: string };

export type ApiKeysQueryVariables = Exact<{ [key: string]: never; }>;


export type ApiKeysQuery = { apiKeys: Array<{ id: string, userId: string, name: string, prefix: string, scopes: Array<string>, lastUsedAt?: string | null, expiresAt?: string | null, revokedAt?: string | null, createdAt: string }> };

export type CreateApiKeyMutationVariables = Exact<{
  input: CreateApiKeyInput;
}>;


export type CreateApiKeyMutation = { createApiKey: { version: number, created: { token: string, apiKey: { id: string, userId: string, name: string, prefix: string, scopes: Array<string>, lastUsedAt?: string | null, expiresAt?: string | null, revokedAt?: string | null, createdAt: string } } } };

export type RevokeApiKeyMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
}>;


export type RevokeApiKeyMutation = { revokeApiKey: { version: number, id: string } };

export type ArchivedIssuesQueryVariables = Exact<{
  teamId: Scalars['UUID']['input'];
}>;


export type ArchivedIssuesQuery = { archivedIssues: Array<{ id: string, workspaceId: string, teamId: string, number: number, identifier: string, title: string, description: string, stateId: string, assigneeId?: string | null, creatorId?: string | null, priority: number, sortOrder: string, estimate?: number | null, dueDate?: string | null, dueDateSource: DueDateSource, parentId?: string | null, subIssueSortOrder?: string | null, templateId?: string | null, projectId?: string | null, projectMilestoneId?: string | null, cycleId?: string | null, snoozedUntil?: string | null, autoClosedAt?: string | null, startedAt?: string | null, completedAt?: string | null, canceledAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string }> };

export type ArchivedCyclesQueryVariables = Exact<{
  teamId: Scalars['UUID']['input'];
}>;


export type ArchivedCyclesQuery = { archivedCycles: Array<{ id: string, workspaceId: string, teamId: string, number: number, name: string, description?: string | null, startsAt: string, endsAt: string, completedAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string }> };

export type ArchivedProjectsQueryVariables = Exact<{
  teamId: Scalars['UUID']['input'];
}>;


export type ArchivedProjectsQuery = { archivedProjects: Array<{ id: string, workspaceId: string, name: string, summary?: string | null, description: string, icon?: string | null, color: string, statusId: string, priority: number, leadId?: string | null, creatorId?: string | null, sortOrder: string, startDate?: string | null, startDateGranularity?: TimeframeGranularity | null, targetDate?: string | null, targetDateGranularity?: TimeframeGranularity | null, archivedAt?: string | null, deletedAt?: string | null, deletedBy?: string | null, createdAt: string, updatedAt: string }> };

export type ArchiveCycleMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  archived: Scalars['Boolean']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type ArchiveCycleMutation = { archiveCycle: { version: number, id: string } };

export type ArchiveProjectMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  archived: Scalars['Boolean']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type ArchiveProjectMutation = { archiveProject: { version: number, id: string } };

export type NotificationFieldsFragment = { id: string, workspaceId: string, userId: string, type: NotificationType, issueId?: string | null, commentId?: string | null, changeVersion: number, groupKey: string, count: number, payload?: unknown | null, readAt?: string | null, snoozedUntil?: string | null, createdAt: string, updatedAt: string, actor: { type: ActorType, id?: string | null } };

export type InboxQueryVariables = Exact<{
  first: Scalars['Int']['input'];
}>;


export type InboxQuery = { notifications: Array<{ id: string, workspaceId: string, userId: string, type: NotificationType, issueId?: string | null, commentId?: string | null, changeVersion: number, groupKey: string, count: number, payload?: unknown | null, readAt?: string | null, snoozedUntil?: string | null, createdAt: string, updatedAt: string, actor: { type: ActorType, id?: string | null } }> };

export type UnreadNotificationCountQueryVariables = Exact<{ [key: string]: never; }>;


export type UnreadNotificationCountQuery = { unreadNotificationCount: number };

export type MarkNotificationReadMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  read: Scalars['Boolean']['input'];
}>;


export type MarkNotificationReadMutation = { markNotificationRead: { version: number, notification: { id: string, workspaceId: string, userId: string, type: NotificationType, issueId?: string | null, commentId?: string | null, changeVersion: number, groupKey: string, count: number, payload?: unknown | null, readAt?: string | null, snoozedUntil?: string | null, createdAt: string, updatedAt: string, actor: { type: ActorType, id?: string | null } } } };

export type MarkAllNotificationsReadMutationVariables = Exact<{ [key: string]: never; }>;


export type MarkAllNotificationsReadMutation = { markAllNotificationsRead: { version: number, notifications: Array<{ id: string, workspaceId: string, userId: string, type: NotificationType, issueId?: string | null, commentId?: string | null, changeVersion: number, groupKey: string, count: number, payload?: unknown | null, readAt?: string | null, snoozedUntil?: string | null, createdAt: string, updatedAt: string, actor: { type: ActorType, id?: string | null } }> } };

export type SnoozeNotificationMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  until?: InputMaybe<Scalars['Time']['input']>;
}>;


export type SnoozeNotificationMutation = { snoozeNotification: { version: number, notification: { id: string, workspaceId: string, userId: string, type: NotificationType, issueId?: string | null, commentId?: string | null, changeVersion: number, groupKey: string, count: number, payload?: unknown | null, readAt?: string | null, snoozedUntil?: string | null, createdAt: string, updatedAt: string, actor: { type: ActorType, id?: string | null } } } };

export type DeleteNotificationMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
}>;


export type DeleteNotificationMutation = { deleteNotification: { version: number, id: string } };

export type UpdateNotificationPrefsMutationVariables = Exact<{
  prefs: Scalars['JSON']['input'];
}>;


export type UpdateNotificationPrefsMutation = { updateNotificationPrefs: { version: number, user: { id: string, workspaceId: string, name: string, displayName: string, avatarUrl?: string | null, timezone: string, role: UserRole, status: UserStatus, kind: UserKind, email?: string | null, notificationPrefs?: unknown | null, lastSeenAt?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

export type SubIssueFieldsFragment = { id: string, workspaceId: string, teamId: string, number: number, identifier: string, title: string, description: string, stateId: string, assigneeId?: string | null, creatorId?: string | null, priority: number, sortOrder: string, estimate?: number | null, dueDate?: string | null, dueDateSource: DueDateSource, parentId?: string | null, subIssueSortOrder?: string | null, templateId?: string | null, projectId?: string | null, projectMilestoneId?: string | null, cycleId?: string | null, snoozedUntil?: string | null, autoClosedAt?: string | null, startedAt?: string | null, completedAt?: string | null, canceledAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string };

export type RelationFieldsFragment = { id: string, workspaceId: string, issueId: string, relatedIssueId: string, type: RelationType, teamId: string, relatedTeamId: string, createdBy?: string | null, createdAt: string };

export type SubscriptionFieldsFragment = { id: string, workspaceId: string, issueId: string, userId: string, reason: SubscriptionReason, unsubscribed: boolean, createdAt: string, updatedAt: string };

export type CreateSubIssueMutationVariables = Exact<{
  input: CreateIssueInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateSubIssueMutation = { createIssue: { version: number, issue: { id: string, workspaceId: string, teamId: string, number: number, identifier: string, title: string, description: string, stateId: string, assigneeId?: string | null, creatorId?: string | null, priority: number, sortOrder: string, estimate?: number | null, dueDate?: string | null, dueDateSource: DueDateSource, parentId?: string | null, subIssueSortOrder?: string | null, templateId?: string | null, projectId?: string | null, projectMilestoneId?: string | null, cycleId?: string | null, snoozedUntil?: string | null, autoClosedAt?: string | null, startedAt?: string | null, completedAt?: string | null, canceledAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string } } };

export type CreateIssueRelationMutationVariables = Exact<{
  issueId: Scalars['UUID']['input'];
  relatedIssueId: Scalars['UUID']['input'];
  type: RelationType;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateIssueRelationMutation = { createIssueRelation: { version: number, relation: { id: string, workspaceId: string, issueId: string, relatedIssueId: string, type: RelationType, teamId: string, relatedTeamId: string, createdBy?: string | null, createdAt: string } } };

export type DeleteIssueRelationMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type DeleteIssueRelationMutation = { deleteIssueRelation: { version: number, id: string } };

export type SetIssueSubscriptionMutationVariables = Exact<{
  issueId: Scalars['UUID']['input'];
  subscribed: Scalars['Boolean']['input'];
}>;


export type SetIssueSubscriptionMutation = { setIssueSubscription: { version: number, subscription: { id: string, workspaceId: string, issueId: string, userId: string, reason: SubscriptionReason, unsubscribed: boolean, createdAt: string, updatedAt: string } } };

export type LabelFieldsFragment = { id: string, workspaceId: string, teamId?: string | null, parentId?: string | null, isGroup: boolean, name: string, description?: string | null, color: string, position: string, createdAt: string, updatedAt: string, archivedAt?: string | null };

export type IssueLabelFieldsFragment = { id: string, workspaceId: string, issueId: string, labelId: string, teamId: string, groupId?: string | null, createdBy?: string | null, createdAt: string };

export type CreateLabelMutationVariables = Exact<{
  input: CreateLabelInput;
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  opId?: InputMaybe<Scalars['UUID']['input']>;
}>;


export type CreateLabelMutation = { createLabel: { version: number, label: { id: string, workspaceId: string, teamId?: string | null, parentId?: string | null, isGroup: boolean, name: string, description?: string | null, color: string, position: string, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

export type UpdateLabelMutationVariables = Exact<{
  input: UpdateLabelInput;
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  opId?: InputMaybe<Scalars['UUID']['input']>;
}>;


export type UpdateLabelMutation = { updateLabel: { version: number, label: { id: string, workspaceId: string, teamId?: string | null, parentId?: string | null, isGroup: boolean, name: string, description?: string | null, color: string, position: string, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

export type ArchiveLabelMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  archived: Scalars['Boolean']['input'];
}>;


export type ArchiveLabelMutation = { archiveLabel: { version: number, id: string } };

export type AddIssueLabelMutationVariables = Exact<{
  issueId: Scalars['UUID']['input'];
  labelId: Scalars['UUID']['input'];
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  opId?: InputMaybe<Scalars['UUID']['input']>;
}>;


export type AddIssueLabelMutation = { addIssueLabel: { version: number, issueLabel: { id: string, workspaceId: string, issueId: string, labelId: string, teamId: string, groupId?: string | null, createdBy?: string | null, createdAt: string } } };

export type RemoveIssueLabelMutationVariables = Exact<{
  issueId: Scalars['UUID']['input'];
  labelId: Scalars['UUID']['input'];
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  opId?: InputMaybe<Scalars['UUID']['input']>;
}>;


export type RemoveIssueLabelMutation = { removeIssueLabel: { version: number, id: string } };

export type ProjectStatusFieldsFragment = { id: string, workspaceId: string, name: string, description?: string | null, color: string, category: ProjectStatusCategory, position: string, isDefault: boolean, createdAt: string, updatedAt: string, archivedAt?: string | null };

export type ProjectFieldsFragment = { id: string, workspaceId: string, name: string, summary?: string | null, description: string, icon?: string | null, color: string, statusId: string, priority: number, leadId?: string | null, creatorId?: string | null, sortOrder: string, startDate?: string | null, startDateGranularity?: TimeframeGranularity | null, targetDate?: string | null, targetDateGranularity?: TimeframeGranularity | null, archivedAt?: string | null, deletedAt?: string | null, deletedBy?: string | null, createdAt: string, updatedAt: string };

export type ProjectTeamFieldsFragment = { id: string, workspaceId: string, projectId: string, teamId: string, createdAt: string };

export type ProjectMemberFieldsFragment = { id: string, workspaceId: string, projectId: string, userId: string, createdAt: string };

export type ProjectMilestoneFieldsFragment = { id: string, workspaceId: string, projectId: string, name: string, description?: string | null, targetDate?: string | null, sortOrder: string, createdAt: string, updatedAt: string, archivedAt?: string | null };

export type CreateProjectMutationVariables = Exact<{
  input: CreateProjectInput;
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  opId?: InputMaybe<Scalars['UUID']['input']>;
}>;


export type CreateProjectMutation = { createProject: { version: number, project: { id: string, workspaceId: string, name: string, summary?: string | null, description: string, icon?: string | null, color: string, statusId: string, priority: number, leadId?: string | null, creatorId?: string | null, sortOrder: string, startDate?: string | null, startDateGranularity?: TimeframeGranularity | null, targetDate?: string | null, targetDateGranularity?: TimeframeGranularity | null, archivedAt?: string | null, deletedAt?: string | null, deletedBy?: string | null, createdAt: string, updatedAt: string } } };

export type UpdateProjectMutationVariables = Exact<{
  input: UpdateProjectInput;
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  opId?: InputMaybe<Scalars['UUID']['input']>;
}>;


export type UpdateProjectMutation = { updateProject: { version: number, project: { id: string, workspaceId: string, name: string, summary?: string | null, description: string, icon?: string | null, color: string, statusId: string, priority: number, leadId?: string | null, creatorId?: string | null, sortOrder: string, startDate?: string | null, startDateGranularity?: TimeframeGranularity | null, targetDate?: string | null, targetDateGranularity?: TimeframeGranularity | null, archivedAt?: string | null, deletedAt?: string | null, deletedBy?: string | null, createdAt: string, updatedAt: string } } };

export type DeleteProjectMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  opId?: InputMaybe<Scalars['UUID']['input']>;
}>;


export type DeleteProjectMutation = { deleteProject: { version: number, id: string } };

export type AddProjectTeamMutationVariables = Exact<{
  projectId: Scalars['UUID']['input'];
  teamId: Scalars['UUID']['input'];
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  opId?: InputMaybe<Scalars['UUID']['input']>;
}>;


export type AddProjectTeamMutation = { addProjectTeam: { version: number, projectTeam: { id: string, workspaceId: string, projectId: string, teamId: string, createdAt: string } } };

export type AddProjectMemberMutationVariables = Exact<{
  projectId: Scalars['UUID']['input'];
  userId: Scalars['UUID']['input'];
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  opId?: InputMaybe<Scalars['UUID']['input']>;
}>;


export type AddProjectMemberMutation = { addProjectMember: { version: number, projectMember: { id: string, workspaceId: string, projectId: string, userId: string, createdAt: string } } };

export type SearchQueryVariables = Exact<{
  input: SearchInput;
}>;


export type SearchQuery = { search: { issueCount: number, issues: Array<{ id: string, identifier: string, title: string, priority: number, state: { id: string, name: string, category: StateCategory, color: string }, assignee?: { id: string, displayName: string, avatarUrl?: string | null } | null }>, comments: Array<{ id: string, issueId: string, body: string, createdAt: string }> } };

export type IssueTemplateFieldsFragment = { id: string, workspaceId: string, teamId?: string | null, name: string, description?: string | null, title: string, body: string, properties: unknown, position: string, createdBy?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null };

export type CreateIssueTemplateMutationVariables = Exact<{
  input: CreateIssueTemplateInput;
}>;


export type CreateIssueTemplateMutation = { createIssueTemplate: { version: number, template: { id: string, workspaceId: string, teamId?: string | null, name: string, description?: string | null, title: string, body: string, properties: unknown, position: string, createdBy?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

export type UpdateIssueTemplateMutationVariables = Exact<{
  input: UpdateIssueTemplateInput;
}>;


export type UpdateIssueTemplateMutation = { updateIssueTemplate: { version: number, template: { id: string, workspaceId: string, teamId?: string | null, name: string, description?: string | null, title: string, body: string, properties: unknown, position: string, createdBy?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

export type ArchiveIssueTemplateMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  archived: Scalars['Boolean']['input'];
}>;


export type ArchiveIssueTemplateMutation = { archiveIssueTemplate: { version: number, id: string } };

export type ViewFieldsFragment = { id: string, workspaceId: string, teamId?: string | null, ownerId?: string | null, name: string, description?: string | null, icon?: string | null, color?: string | null, filter: unknown, display: unknown, position: string, createdBy?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null };

export type ViewPreferenceFieldsFragment = { id: string, workspaceId: string, userId: string, viewKey: string, display: unknown, createdAt: string, updatedAt: string };

export type FavoriteFieldsFragment = { id: string, workspaceId: string, userId: string, kind: FavoriteKind, targetId: string, position: string, createdAt: string, updatedAt: string };

export type CreateViewMutationVariables = Exact<{
  input: CreateViewInput;
}>;


export type CreateViewMutation = { createView: { version: number, view: { id: string, workspaceId: string, teamId?: string | null, ownerId?: string | null, name: string, description?: string | null, icon?: string | null, color?: string | null, filter: unknown, display: unknown, position: string, createdBy?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

export type UpdateViewMutationVariables = Exact<{
  input: UpdateViewInput;
}>;


export type UpdateViewMutation = { updateView: { version: number, view: { id: string, workspaceId: string, teamId?: string | null, ownerId?: string | null, name: string, description?: string | null, icon?: string | null, color?: string | null, filter: unknown, display: unknown, position: string, createdBy?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

export type DeleteViewMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
}>;


export type DeleteViewMutation = { deleteView: { version: number, id: string } };

export type SetViewPreferenceMutationVariables = Exact<{
  viewKey: Scalars['String']['input'];
  display: Scalars['JSON']['input'];
}>;


export type SetViewPreferenceMutation = { setViewPreference: { version: number, preference: { id: string, workspaceId: string, userId: string, viewKey: string, display: unknown, createdAt: string, updatedAt: string } } };

export type AddFavoriteMutationVariables = Exact<{
  kind: FavoriteKind;
  targetId: Scalars['UUID']['input'];
  afterFavoriteId?: InputMaybe<Scalars['UUID']['input']>;
}>;


export type AddFavoriteMutation = { addFavorite: { version: number, favorite: { id: string, workspaceId: string, userId: string, kind: FavoriteKind, targetId: string, position: string, createdAt: string, updatedAt: string } } };

export type RemoveFavoriteMutationVariables = Exact<{
  kind: FavoriteKind;
  targetId: Scalars['UUID']['input'];
}>;


export type RemoveFavoriteMutation = { removeFavorite: { version: number, id: string } };

export type IssueFieldsFragment = { id: string, workspaceId: string, teamId: string, number: number, identifier: string, title: string, description: string, stateId: string, assigneeId?: string | null, creatorId?: string | null, priority: number, sortOrder: string, estimate?: number | null, dueDate?: string | null, dueDateSource: DueDateSource, parentId?: string | null, subIssueSortOrder?: string | null, templateId?: string | null, projectId?: string | null, projectMilestoneId?: string | null, cycleId?: string | null, snoozedUntil?: string | null, autoClosedAt?: string | null, startedAt?: string | null, completedAt?: string | null, canceledAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string };

export type TeamFieldsFragment = { id: string, workspaceId: string, key: string, name: string, description?: string | null, icon?: string | null, color?: string | null, timezone: string, parentTeamId?: string | null, private: boolean, estimateScale: EstimateScale, estimateAllowZero: boolean, estimateExtended: boolean, cyclesEnabled: boolean, cycleDurationWeeks: number, cycleCooldownWeeks: number, cycleStartDay: string, cycleUpcomingCount: number, cycleAutoAddStarted: boolean, cycleAutoAddCompleted: boolean, triageEnabled: boolean, triageRequirePriority: boolean, autoCloseDays: number, autoArchiveDays: number, autoCloseParent: boolean, autoCloseChildren: boolean, createdAt: string, updatedAt: string, retiredAt?: string | null, archivedAt?: string | null };

export type StateFieldsFragment = { id: string, workspaceId: string, teamId: string, name: string, description?: string | null, color: string, category: StateCategory, position: string, isDefault: boolean, isSystem: boolean, createdAt: string, updatedAt: string, archivedAt?: string | null };

export type UserFieldsFragment = { id: string, workspaceId: string, name: string, displayName: string, avatarUrl?: string | null, timezone: string, role: UserRole, status: UserStatus, kind: UserKind, email?: string | null, notificationPrefs?: unknown | null, lastSeenAt?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null };

export type CommentFieldsFragment = { id: string, workspaceId: string, issueId: string, parentId?: string | null, body: string, editedAt?: string | null, resolvedAt?: string | null, resolvedBy?: string | null, createdAt: string, updatedAt: string, actor: { type: ActorType, id?: string | null } };

export type ViewerQueryVariables = Exact<{ [key: string]: never; }>;


export type ViewerQuery = { viewer: { syncVersion: number, user: { id: string, workspaceId: string, name: string, displayName: string, avatarUrl?: string | null, timezone: string, role: UserRole, status: UserStatus, kind: UserKind, email?: string | null, notificationPrefs?: unknown | null, lastSeenAt?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null }, workspace: { id: string, name: string, urlKey: string, logoUrl?: string | null, plan: string, createdAt: string, updatedAt: string }, workspaces: Array<{ id: string, name: string, urlKey: string, logoUrl?: string | null, plan: string, createdAt: string, updatedAt: string }> } };

export type IssueDetailQueryVariables = Exact<{
  id: Scalars['UUID']['input'];
}>;


export type IssueDetailQuery = { comments: Array<{ id: string, workspaceId: string, issueId: string, parentId?: string | null, body: string, editedAt?: string | null, resolvedAt?: string | null, resolvedBy?: string | null, createdAt: string, updatedAt: string, actor: { type: ActorType, id?: string | null } }>, issueHistory: Array<{ id: string, issueId: string, kind: string, fromValue?: unknown | null, toValue?: unknown | null, createdAt: string, actor: { type: ActorType, id?: string | null } }> };

export type CreateIssueMutationVariables = Exact<{
  input: CreateIssueInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateIssueMutation = { createIssue: { version: number, issue: { id: string, workspaceId: string, teamId: string, number: number, identifier: string, title: string, description: string, stateId: string, assigneeId?: string | null, creatorId?: string | null, priority: number, sortOrder: string, estimate?: number | null, dueDate?: string | null, dueDateSource: DueDateSource, parentId?: string | null, subIssueSortOrder?: string | null, templateId?: string | null, projectId?: string | null, projectMilestoneId?: string | null, cycleId?: string | null, snoozedUntil?: string | null, autoClosedAt?: string | null, startedAt?: string | null, completedAt?: string | null, canceledAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string } } };

export type UpdateIssueMutationVariables = Exact<{
  input: UpdateIssueInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type UpdateIssueMutation = { updateIssue: { version: number, issue: { id: string, workspaceId: string, teamId: string, number: number, identifier: string, title: string, description: string, stateId: string, assigneeId?: string | null, creatorId?: string | null, priority: number, sortOrder: string, estimate?: number | null, dueDate?: string | null, dueDateSource: DueDateSource, parentId?: string | null, subIssueSortOrder?: string | null, templateId?: string | null, projectId?: string | null, projectMilestoneId?: string | null, cycleId?: string | null, snoozedUntil?: string | null, autoClosedAt?: string | null, startedAt?: string | null, completedAt?: string | null, canceledAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string } } };

export type ArchiveIssueMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  archived: Scalars['Boolean']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type ArchiveIssueMutation = { archiveIssue: { version: number, id: string } };

export type DeleteIssueMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type DeleteIssueMutation = { deleteIssue: { version: number, id: string } };

export type CreateCommentMutationVariables = Exact<{
  input: CreateCommentInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateCommentMutation = { createComment: { version: number, comment: { id: string, workspaceId: string, issueId: string, parentId?: string | null, body: string, editedAt?: string | null, resolvedAt?: string | null, resolvedBy?: string | null, createdAt: string, updatedAt: string, actor: { type: ActorType, id?: string | null } } } };

export type UpdateCommentMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  body: Scalars['String']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type UpdateCommentMutation = { updateComment: { version: number, comment: { id: string, workspaceId: string, issueId: string, parentId?: string | null, body: string, editedAt?: string | null, resolvedAt?: string | null, resolvedBy?: string | null, createdAt: string, updatedAt: string, actor: { type: ActorType, id?: string | null } } } };

export type DeleteCommentMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type DeleteCommentMutation = { deleteComment: { version: number, id: string } };

export type CreateTeamMutationVariables = Exact<{
  input: CreateTeamInput;
}>;


export type CreateTeamMutation = { createTeam: { version: number, team: { id: string, workspaceId: string, key: string, name: string, description?: string | null, icon?: string | null, color?: string | null, timezone: string, parentTeamId?: string | null, private: boolean, estimateScale: EstimateScale, estimateAllowZero: boolean, estimateExtended: boolean, cyclesEnabled: boolean, cycleDurationWeeks: number, cycleCooldownWeeks: number, cycleStartDay: string, cycleUpcomingCount: number, cycleAutoAddStarted: boolean, cycleAutoAddCompleted: boolean, triageEnabled: boolean, triageRequirePriority: boolean, autoCloseDays: number, autoArchiveDays: number, autoCloseParent: boolean, autoCloseChildren: boolean, createdAt: string, updatedAt: string, retiredAt?: string | null, archivedAt?: string | null, states: Array<{ id: string, workspaceId: string, teamId: string, name: string, description?: string | null, color: string, category: StateCategory, position: string, isDefault: boolean, isSystem: boolean, createdAt: string, updatedAt: string, archivedAt?: string | null }> } } };

export type UpdateTeamMutationVariables = Exact<{
  input: UpdateTeamInput;
}>;


export type UpdateTeamMutation = { updateTeam: { version: number, team: { id: string, workspaceId: string, key: string, name: string, description?: string | null, icon?: string | null, color?: string | null, timezone: string, parentTeamId?: string | null, private: boolean, estimateScale: EstimateScale, estimateAllowZero: boolean, estimateExtended: boolean, cyclesEnabled: boolean, cycleDurationWeeks: number, cycleCooldownWeeks: number, cycleStartDay: string, cycleUpcomingCount: number, cycleAutoAddStarted: boolean, cycleAutoAddCompleted: boolean, triageEnabled: boolean, triageRequirePriority: boolean, autoCloseDays: number, autoArchiveDays: number, autoCloseParent: boolean, autoCloseChildren: boolean, createdAt: string, updatedAt: string, retiredAt?: string | null, archivedAt?: string | null } } };

export type CycleFieldsFragment = { id: string, workspaceId: string, teamId: string, number: number, name: string, description?: string | null, startsAt: string, endsAt: string, completedAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string };

export type UpdateTeamCyclesMutationVariables = Exact<{
  input: UpdateTeamCyclesInput;
}>;


export type UpdateTeamCyclesMutation = { updateTeamCycles: { version: number, team: { id: string, workspaceId: string, key: string, name: string, description?: string | null, icon?: string | null, color?: string | null, timezone: string, parentTeamId?: string | null, private: boolean, estimateScale: EstimateScale, estimateAllowZero: boolean, estimateExtended: boolean, cyclesEnabled: boolean, cycleDurationWeeks: number, cycleCooldownWeeks: number, cycleStartDay: string, cycleUpcomingCount: number, cycleAutoAddStarted: boolean, cycleAutoAddCompleted: boolean, triageEnabled: boolean, triageRequirePriority: boolean, autoCloseDays: number, autoArchiveDays: number, autoCloseParent: boolean, autoCloseChildren: boolean, createdAt: string, updatedAt: string, retiredAt?: string | null, archivedAt?: string | null } } };

export type UpdateTeamTriageMutationVariables = Exact<{
  input: UpdateTeamTriageInput;
}>;


export type UpdateTeamTriageMutation = { updateTeamTriage: { version: number, team: { id: string, workspaceId: string, key: string, name: string, description?: string | null, icon?: string | null, color?: string | null, timezone: string, parentTeamId?: string | null, private: boolean, estimateScale: EstimateScale, estimateAllowZero: boolean, estimateExtended: boolean, cyclesEnabled: boolean, cycleDurationWeeks: number, cycleCooldownWeeks: number, cycleStartDay: string, cycleUpcomingCount: number, cycleAutoAddStarted: boolean, cycleAutoAddCompleted: boolean, triageEnabled: boolean, triageRequirePriority: boolean, autoCloseDays: number, autoArchiveDays: number, autoCloseParent: boolean, autoCloseChildren: boolean, createdAt: string, updatedAt: string, retiredAt?: string | null, archivedAt?: string | null } } };

export type UpdateTeamArchiveMutationVariables = Exact<{
  input: UpdateTeamArchiveInput;
}>;


export type UpdateTeamArchiveMutation = { updateTeamArchive: { version: number, team: { id: string, workspaceId: string, key: string, name: string, description?: string | null, icon?: string | null, color?: string | null, timezone: string, parentTeamId?: string | null, private: boolean, estimateScale: EstimateScale, estimateAllowZero: boolean, estimateExtended: boolean, cyclesEnabled: boolean, cycleDurationWeeks: number, cycleCooldownWeeks: number, cycleStartDay: string, cycleUpcomingCount: number, cycleAutoAddStarted: boolean, cycleAutoAddCompleted: boolean, triageEnabled: boolean, triageRequirePriority: boolean, autoCloseDays: number, autoArchiveDays: number, autoCloseParent: boolean, autoCloseChildren: boolean, createdAt: string, updatedAt: string, retiredAt?: string | null, archivedAt?: string | null } } };

export type AcceptTriageIssueMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type AcceptTriageIssueMutation = { acceptTriageIssue: { version: number, issue: { id: string, workspaceId: string, teamId: string, number: number, identifier: string, title: string, description: string, stateId: string, assigneeId?: string | null, creatorId?: string | null, priority: number, sortOrder: string, estimate?: number | null, dueDate?: string | null, dueDateSource: DueDateSource, parentId?: string | null, subIssueSortOrder?: string | null, templateId?: string | null, projectId?: string | null, projectMilestoneId?: string | null, cycleId?: string | null, snoozedUntil?: string | null, autoClosedAt?: string | null, startedAt?: string | null, completedAt?: string | null, canceledAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string } } };

export type DeclineTriageIssueMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type DeclineTriageIssueMutation = { declineTriageIssue: { version: number, issue: { id: string, workspaceId: string, teamId: string, number: number, identifier: string, title: string, description: string, stateId: string, assigneeId?: string | null, creatorId?: string | null, priority: number, sortOrder: string, estimate?: number | null, dueDate?: string | null, dueDateSource: DueDateSource, parentId?: string | null, subIssueSortOrder?: string | null, templateId?: string | null, projectId?: string | null, projectMilestoneId?: string | null, cycleId?: string | null, snoozedUntil?: string | null, autoClosedAt?: string | null, startedAt?: string | null, completedAt?: string | null, canceledAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string } } };

export type MarkIssueDuplicateMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  canonicalId: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type MarkIssueDuplicateMutation = { markIssueDuplicate: { version: number, issue: { id: string, workspaceId: string, teamId: string, number: number, identifier: string, title: string, description: string, stateId: string, assigneeId?: string | null, creatorId?: string | null, priority: number, sortOrder: string, estimate?: number | null, dueDate?: string | null, dueDateSource: DueDateSource, parentId?: string | null, subIssueSortOrder?: string | null, templateId?: string | null, projectId?: string | null, projectMilestoneId?: string | null, cycleId?: string | null, snoozedUntil?: string | null, autoClosedAt?: string | null, startedAt?: string | null, completedAt?: string | null, canceledAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string } } };

export type SnoozeIssueMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  until: Scalars['Time']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type SnoozeIssueMutation = { snoozeIssue: { version: number, issue: { id: string, workspaceId: string, teamId: string, number: number, identifier: string, title: string, description: string, stateId: string, assigneeId?: string | null, creatorId?: string | null, priority: number, sortOrder: string, estimate?: number | null, dueDate?: string | null, dueDateSource: DueDateSource, parentId?: string | null, subIssueSortOrder?: string | null, templateId?: string | null, projectId?: string | null, projectMilestoneId?: string | null, cycleId?: string | null, snoozedUntil?: string | null, autoClosedAt?: string | null, startedAt?: string | null, completedAt?: string | null, canceledAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string } } };

export type CreateWorkflowStateMutationVariables = Exact<{
  input: CreateWorkflowStateInput;
}>;


export type CreateWorkflowStateMutation = { createWorkflowState: { version: number, state: { id: string, workspaceId: string, teamId: string, name: string, description?: string | null, color: string, category: StateCategory, position: string, isDefault: boolean, isSystem: boolean, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

export type UpdateWorkflowStateMutationVariables = Exact<{
  input: UpdateWorkflowStateInput;
}>;


export type UpdateWorkflowStateMutation = { updateWorkflowState: { version: number, state: { id: string, workspaceId: string, teamId: string, name: string, description?: string | null, color: string, category: StateCategory, position: string, isDefault: boolean, isSystem: boolean, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

export type ArchiveWorkflowStateMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  archived: Scalars['Boolean']['input'];
}>;


export type ArchiveWorkflowStateMutation = { archiveWorkflowState: { version: number, id: string } };

export type SetUserRoleMutationVariables = Exact<{
  userId: Scalars['UUID']['input'];
  role: UserRole;
}>;


export type SetUserRoleMutation = { setUserRole: { version: number, user: { id: string, workspaceId: string, name: string, displayName: string, avatarUrl?: string | null, timezone: string, role: UserRole, status: UserStatus, kind: UserKind, email?: string | null, notificationPrefs?: unknown | null, lastSeenAt?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

export type SuspendUserMutationVariables = Exact<{
  userId: Scalars['UUID']['input'];
  suspended: Scalars['Boolean']['input'];
}>;


export type SuspendUserMutation = { suspendUser: { version: number, user: { id: string, workspaceId: string, name: string, displayName: string, avatarUrl?: string | null, timezone: string, role: UserRole, status: UserStatus, kind: UserKind, email?: string | null, notificationPrefs?: unknown | null, lastSeenAt?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

export type UpdateProfileMutationVariables = Exact<{
  input: UpdateProfileInput;
}>;


export type UpdateProfileMutation = { updateProfile: { version: number, user: { id: string, workspaceId: string, name: string, displayName: string, avatarUrl?: string | null, timezone: string, role: UserRole, status: UserStatus, kind: UserKind, email?: string | null, notificationPrefs?: unknown | null, lastSeenAt?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

export const ApiKeyFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ApiKeyFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ApiKey"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"prefix"}},{"kind":"Field","name":{"kind":"Name","value":"scopes"}},{"kind":"Field","name":{"kind":"Name","value":"lastUsedAt"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"revokedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<ApiKeyFieldsFragment, unknown>;
export const NotificationFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"NotificationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Notification"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"commentId"}},{"kind":"Field","name":{"kind":"Name","value":"actor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"changeVersion"}},{"kind":"Field","name":{"kind":"Name","value":"groupKey"}},{"kind":"Field","name":{"kind":"Name","value":"count"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}},{"kind":"Field","name":{"kind":"Name","value":"readAt"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<NotificationFieldsFragment, unknown>;
export const SubIssueFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SubIssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Issue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"stateId"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"estimate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDateSource"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"subIssueSortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"projectMilestoneId"}},{"kind":"Field","name":{"kind":"Name","value":"cycleId"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"autoClosedAt"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"canceledAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<SubIssueFieldsFragment, unknown>;
export const RelationFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"RelationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IssueRelation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"relatedIssueId"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"relatedTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<RelationFieldsFragment, unknown>;
export const SubscriptionFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SubscriptionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IssueSubscription"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"reason"}},{"kind":"Field","name":{"kind":"Name","value":"unsubscribed"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<SubscriptionFieldsFragment, unknown>;
export const LabelFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"LabelFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Label"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"isGroup"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<LabelFieldsFragment, unknown>;
export const IssueLabelFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueLabelFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IssueLabel"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"labelId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"groupId"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<IssueLabelFieldsFragment, unknown>;
export const ProjectStatusFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectStatusFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectStatus"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"isDefault"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<ProjectStatusFieldsFragment, unknown>;
export const ProjectFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Project"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"statusId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"leadId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"startDate"}},{"kind":"Field","name":{"kind":"Name","value":"startDateGranularity"}},{"kind":"Field","name":{"kind":"Name","value":"targetDate"}},{"kind":"Field","name":{"kind":"Name","value":"targetDateGranularity"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<ProjectFieldsFragment, unknown>;
export const ProjectTeamFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectTeamFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectTeam"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<ProjectTeamFieldsFragment, unknown>;
export const ProjectMemberFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectMemberFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectMember"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<ProjectMemberFieldsFragment, unknown>;
export const ProjectMilestoneFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectMilestoneFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectMilestone"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"targetDate"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<ProjectMilestoneFieldsFragment, unknown>;
export const IssueTemplateFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueTemplateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IssueTemplate"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"properties"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<IssueTemplateFieldsFragment, unknown>;
export const ViewFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ViewFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"View"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"filter"}},{"kind":"Field","name":{"kind":"Name","value":"display"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<ViewFieldsFragment, unknown>;
export const ViewPreferenceFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ViewPreferenceFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ViewPreference"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"viewKey"}},{"kind":"Field","name":{"kind":"Name","value":"display"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<ViewPreferenceFieldsFragment, unknown>;
export const FavoriteFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"FavoriteFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Favorite"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"targetId"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<FavoriteFieldsFragment, unknown>;
export const IssueFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Issue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"stateId"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"estimate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDateSource"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"subIssueSortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"projectMilestoneId"}},{"kind":"Field","name":{"kind":"Name","value":"cycleId"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"autoClosedAt"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"canceledAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<IssueFieldsFragment, unknown>;
export const TeamFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TeamFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Team"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"parentTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"private"}},{"kind":"Field","name":{"kind":"Name","value":"estimateScale"}},{"kind":"Field","name":{"kind":"Name","value":"estimateAllowZero"}},{"kind":"Field","name":{"kind":"Name","value":"estimateExtended"}},{"kind":"Field","name":{"kind":"Name","value":"cyclesEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"cycleDurationWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleCooldownWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleStartDay"}},{"kind":"Field","name":{"kind":"Name","value":"cycleUpcomingCount"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddStarted"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddCompleted"}},{"kind":"Field","name":{"kind":"Name","value":"triageEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"triageRequirePriority"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoArchiveDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseParent"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseChildren"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"retiredAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<TeamFieldsFragment, unknown>;
export const StateFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"StateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkflowState"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"isDefault"}},{"kind":"Field","name":{"kind":"Name","value":"isSystem"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<StateFieldsFragment, unknown>;
export const UserFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"UserFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"User"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"notificationPrefs"}},{"kind":"Field","name":{"kind":"Name","value":"lastSeenAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UserFieldsFragment, unknown>;
export const CommentFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CommentFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Comment"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"actor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"editedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CommentFieldsFragment, unknown>;
export const CycleFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CycleFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Cycle"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"startsAt"}},{"kind":"Field","name":{"kind":"Name","value":"endsAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CycleFieldsFragment, unknown>;
export const EntitlementsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Entitlements"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"workspace"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"plan"}},{"kind":"Field","name":{"kind":"Name","value":"planExpiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"planLapsedAt"}},{"kind":"Field","name":{"kind":"Name","value":"seatLimit"}},{"kind":"Field","name":{"kind":"Name","value":"entitlements"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"plan"}},{"kind":"Field","name":{"kind":"Name","value":"seatLimit"}},{"kind":"Field","name":{"kind":"Name","value":"seatsUsed"}},{"kind":"Field","name":{"kind":"Name","value":"teamLimit"}},{"kind":"Field","name":{"kind":"Name","value":"historyDays"}},{"kind":"Field","name":{"kind":"Name","value":"privateTeams"}},{"kind":"Field","name":{"kind":"Name","value":"customViews"}},{"kind":"Field","name":{"kind":"Name","value":"apiKeys"}},{"kind":"Field","name":{"kind":"Name","value":"sso"}},{"kind":"Field","name":{"kind":"Name","value":"auditLog"}},{"kind":"Field","name":{"kind":"Name","value":"lapsed"}}]}}]}}]}}]} as unknown as DocumentNode<EntitlementsQuery, EntitlementsQueryVariables>;
export const InvitesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Invites"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"invites"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"invitedBy"}},{"kind":"Field","name":{"kind":"Name","value":"teamIds"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<InvitesQuery, InvitesQueryVariables>;
export const InviteToWorkspaceDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"InviteToWorkspace"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"InviteInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"inviteToWorkspace"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"token"}}]}}]}}]} as unknown as DocumentNode<InviteToWorkspaceMutation, InviteToWorkspaceMutationVariables>;
export const RevokeInviteDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RevokeInvite"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"revokeInvite"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<RevokeInviteMutation, RevokeInviteMutationVariables>;
export const RemoveUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"userId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"userId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"userId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<RemoveUserMutation, RemoveUserMutationVariables>;
export const DeletedIssuesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"DeletedIssues"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deletedIssues"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IssueFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Issue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"stateId"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"estimate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDateSource"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"subIssueSortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"projectMilestoneId"}},{"kind":"Field","name":{"kind":"Name","value":"cycleId"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"autoClosedAt"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"canceledAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<DeletedIssuesQuery, DeletedIssuesQueryVariables>;
export const RestoreIssueDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RestoreIssue"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"restoreIssue"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"issue"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IssueFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Issue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"stateId"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"estimate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDateSource"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"subIssueSortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"projectMilestoneId"}},{"kind":"Field","name":{"kind":"Name","value":"cycleId"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"autoClosedAt"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"canceledAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<RestoreIssueMutation, RestoreIssueMutationVariables>;
export const ApiKeysDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ApiKeys"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"apiKeys"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ApiKeyFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ApiKeyFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ApiKey"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"prefix"}},{"kind":"Field","name":{"kind":"Name","value":"scopes"}},{"kind":"Field","name":{"kind":"Name","value":"lastUsedAt"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"revokedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<ApiKeysQuery, ApiKeysQueryVariables>;
export const CreateApiKeyDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateApiKey"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateApiKeyInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createApiKey"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"created"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"token"}},{"kind":"Field","name":{"kind":"Name","value":"apiKey"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ApiKeyFields"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ApiKeyFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ApiKey"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"prefix"}},{"kind":"Field","name":{"kind":"Name","value":"scopes"}},{"kind":"Field","name":{"kind":"Name","value":"lastUsedAt"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"revokedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<CreateApiKeyMutation, CreateApiKeyMutationVariables>;
export const RevokeApiKeyDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RevokeApiKey"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"revokeApiKey"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<RevokeApiKeyMutation, RevokeApiKeyMutationVariables>;
export const ArchivedIssuesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ArchivedIssues"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"archivedIssues"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"teamId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IssueFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Issue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"stateId"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"estimate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDateSource"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"subIssueSortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"projectMilestoneId"}},{"kind":"Field","name":{"kind":"Name","value":"cycleId"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"autoClosedAt"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"canceledAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<ArchivedIssuesQuery, ArchivedIssuesQueryVariables>;
export const ArchivedCyclesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ArchivedCycles"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"archivedCycles"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"teamId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CycleFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CycleFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Cycle"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"startsAt"}},{"kind":"Field","name":{"kind":"Name","value":"endsAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<ArchivedCyclesQuery, ArchivedCyclesQueryVariables>;
export const ArchivedProjectsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ArchivedProjects"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"archivedProjects"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"teamId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProjectFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Project"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"statusId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"leadId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"startDate"}},{"kind":"Field","name":{"kind":"Name","value":"startDateGranularity"}},{"kind":"Field","name":{"kind":"Name","value":"targetDate"}},{"kind":"Field","name":{"kind":"Name","value":"targetDateGranularity"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<ArchivedProjectsQuery, ArchivedProjectsQueryVariables>;
export const ArchiveCycleDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ArchiveCycle"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"archived"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"archiveCycle"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"archived"},"value":{"kind":"Variable","name":{"kind":"Name","value":"archived"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<ArchiveCycleMutation, ArchiveCycleMutationVariables>;
export const ArchiveProjectDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ArchiveProject"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"archived"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"archiveProject"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"archived"},"value":{"kind":"Variable","name":{"kind":"Name","value":"archived"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<ArchiveProjectMutation, ArchiveProjectMutationVariables>;
export const InboxDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Inbox"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"first"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"notifications"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"includeRead"},"value":{"kind":"BooleanValue","value":true}},{"kind":"Argument","name":{"kind":"Name","value":"includeSnoozed"},"value":{"kind":"BooleanValue","value":true}},{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"Variable","name":{"kind":"Name","value":"first"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"NotificationFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"NotificationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Notification"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"commentId"}},{"kind":"Field","name":{"kind":"Name","value":"actor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"changeVersion"}},{"kind":"Field","name":{"kind":"Name","value":"groupKey"}},{"kind":"Field","name":{"kind":"Name","value":"count"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}},{"kind":"Field","name":{"kind":"Name","value":"readAt"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<InboxQuery, InboxQueryVariables>;
export const UnreadNotificationCountDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UnreadNotificationCount"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"unreadNotificationCount"}}]}}]} as unknown as DocumentNode<UnreadNotificationCountQuery, UnreadNotificationCountQueryVariables>;
export const MarkNotificationReadDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MarkNotificationRead"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"read"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"markNotificationRead"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"read"},"value":{"kind":"Variable","name":{"kind":"Name","value":"read"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"notification"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"NotificationFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"NotificationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Notification"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"commentId"}},{"kind":"Field","name":{"kind":"Name","value":"actor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"changeVersion"}},{"kind":"Field","name":{"kind":"Name","value":"groupKey"}},{"kind":"Field","name":{"kind":"Name","value":"count"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}},{"kind":"Field","name":{"kind":"Name","value":"readAt"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<MarkNotificationReadMutation, MarkNotificationReadMutationVariables>;
export const MarkAllNotificationsReadDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MarkAllNotificationsRead"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"markAllNotificationsRead"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"NotificationFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"NotificationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Notification"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"commentId"}},{"kind":"Field","name":{"kind":"Name","value":"actor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"changeVersion"}},{"kind":"Field","name":{"kind":"Name","value":"groupKey"}},{"kind":"Field","name":{"kind":"Name","value":"count"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}},{"kind":"Field","name":{"kind":"Name","value":"readAt"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<MarkAllNotificationsReadMutation, MarkAllNotificationsReadMutationVariables>;
export const SnoozeNotificationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SnoozeNotification"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"until"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Time"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"snoozeNotification"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"until"},"value":{"kind":"Variable","name":{"kind":"Name","value":"until"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"notification"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"NotificationFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"NotificationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Notification"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"commentId"}},{"kind":"Field","name":{"kind":"Name","value":"actor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"changeVersion"}},{"kind":"Field","name":{"kind":"Name","value":"groupKey"}},{"kind":"Field","name":{"kind":"Name","value":"count"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}},{"kind":"Field","name":{"kind":"Name","value":"readAt"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<SnoozeNotificationMutation, SnoozeNotificationMutationVariables>;
export const DeleteNotificationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteNotification"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteNotification"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteNotificationMutation, DeleteNotificationMutationVariables>;
export const UpdateNotificationPrefsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateNotificationPrefs"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"prefs"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"JSON"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateNotificationPrefs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"prefs"},"value":{"kind":"Variable","name":{"kind":"Name","value":"prefs"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"UserFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"UserFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"User"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"notificationPrefs"}},{"kind":"Field","name":{"kind":"Name","value":"lastSeenAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UpdateNotificationPrefsMutation, UpdateNotificationPrefsMutationVariables>;
export const CreateSubIssueDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateSubIssue"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateIssueInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createIssue"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"issue"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SubIssueFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SubIssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Issue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"stateId"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"estimate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDateSource"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"subIssueSortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"projectMilestoneId"}},{"kind":"Field","name":{"kind":"Name","value":"cycleId"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"autoClosedAt"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"canceledAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateSubIssueMutation, CreateSubIssueMutationVariables>;
export const CreateIssueRelationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateIssueRelation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"issueId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"relatedIssueId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"type"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RelationType"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createIssueRelation"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"issueId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"issueId"}}},{"kind":"Argument","name":{"kind":"Name","value":"relatedIssueId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"relatedIssueId"}}},{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"Variable","name":{"kind":"Name","value":"type"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"relation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"RelationFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"RelationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IssueRelation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"relatedIssueId"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"relatedTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<CreateIssueRelationMutation, CreateIssueRelationMutationVariables>;
export const DeleteIssueRelationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteIssueRelation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteIssueRelation"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteIssueRelationMutation, DeleteIssueRelationMutationVariables>;
export const SetIssueSubscriptionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetIssueSubscription"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"issueId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"subscribed"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setIssueSubscription"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"issueId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"issueId"}}},{"kind":"Argument","name":{"kind":"Name","value":"subscribed"},"value":{"kind":"Variable","name":{"kind":"Name","value":"subscribed"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"subscription"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SubscriptionFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SubscriptionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IssueSubscription"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"reason"}},{"kind":"Field","name":{"kind":"Name","value":"unsubscribed"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<SetIssueSubscriptionMutation, SetIssueSubscriptionMutationVariables>;
export const CreateLabelDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateLabel"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateLabelInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createLabel"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"label"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"LabelFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"LabelFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Label"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"isGroup"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<CreateLabelMutation, CreateLabelMutationVariables>;
export const UpdateLabelDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateLabel"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateLabelInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateLabel"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"label"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"LabelFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"LabelFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Label"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"isGroup"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UpdateLabelMutation, UpdateLabelMutationVariables>;
export const ArchiveLabelDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ArchiveLabel"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"archived"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"archiveLabel"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"archived"},"value":{"kind":"Variable","name":{"kind":"Name","value":"archived"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<ArchiveLabelMutation, ArchiveLabelMutationVariables>;
export const AddIssueLabelDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AddIssueLabel"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"issueId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"labelId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"addIssueLabel"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"issueId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"issueId"}}},{"kind":"Argument","name":{"kind":"Name","value":"labelId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"labelId"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"issueLabel"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IssueLabelFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueLabelFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IssueLabel"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"labelId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"groupId"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<AddIssueLabelMutation, AddIssueLabelMutationVariables>;
export const RemoveIssueLabelDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveIssueLabel"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"issueId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"labelId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeIssueLabel"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"issueId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"issueId"}}},{"kind":"Argument","name":{"kind":"Name","value":"labelId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"labelId"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<RemoveIssueLabelMutation, RemoveIssueLabelMutationVariables>;
export const CreateProjectDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateProject"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateProjectInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createProject"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"project"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProjectFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Project"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"statusId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"leadId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"startDate"}},{"kind":"Field","name":{"kind":"Name","value":"startDateGranularity"}},{"kind":"Field","name":{"kind":"Name","value":"targetDate"}},{"kind":"Field","name":{"kind":"Name","value":"targetDateGranularity"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateProjectMutation, CreateProjectMutationVariables>;
export const UpdateProjectDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateProject"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateProjectInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateProject"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"project"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProjectFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Project"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"statusId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"leadId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"startDate"}},{"kind":"Field","name":{"kind":"Name","value":"startDateGranularity"}},{"kind":"Field","name":{"kind":"Name","value":"targetDate"}},{"kind":"Field","name":{"kind":"Name","value":"targetDateGranularity"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UpdateProjectMutation, UpdateProjectMutationVariables>;
export const DeleteProjectDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteProject"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteProject"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteProjectMutation, DeleteProjectMutationVariables>;
export const AddProjectTeamDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AddProjectTeam"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"addProjectTeam"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"projectId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}}},{"kind":"Argument","name":{"kind":"Name","value":"teamId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"projectTeam"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProjectTeamFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectTeamFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectTeam"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<AddProjectTeamMutation, AddProjectTeamMutationVariables>;
export const AddProjectMemberDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AddProjectMember"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"userId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"addProjectMember"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"projectId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}}},{"kind":"Argument","name":{"kind":"Name","value":"userId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"userId"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"projectMember"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProjectMemberFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectMemberFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectMember"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<AddProjectMemberMutation, AddProjectMemberMutationVariables>;
export const SearchDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Search"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SearchInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"search"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"issueCount"}},{"kind":"Field","name":{"kind":"Name","value":"issues"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"state"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"color"}}]}},{"kind":"Field","name":{"kind":"Name","value":"assignee"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"comments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]}}]} as unknown as DocumentNode<SearchQuery, SearchQueryVariables>;
export const CreateIssueTemplateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateIssueTemplate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateIssueTemplateInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createIssueTemplate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"template"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IssueTemplateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueTemplateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IssueTemplate"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"properties"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<CreateIssueTemplateMutation, CreateIssueTemplateMutationVariables>;
export const UpdateIssueTemplateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateIssueTemplate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateIssueTemplateInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateIssueTemplate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"template"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IssueTemplateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueTemplateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IssueTemplate"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"properties"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UpdateIssueTemplateMutation, UpdateIssueTemplateMutationVariables>;
export const ArchiveIssueTemplateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ArchiveIssueTemplate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"archived"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"archiveIssueTemplate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"archived"},"value":{"kind":"Variable","name":{"kind":"Name","value":"archived"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<ArchiveIssueTemplateMutation, ArchiveIssueTemplateMutationVariables>;
export const CreateViewDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateView"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateViewInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createView"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"view"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ViewFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ViewFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"View"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"filter"}},{"kind":"Field","name":{"kind":"Name","value":"display"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<CreateViewMutation, CreateViewMutationVariables>;
export const UpdateViewDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateView"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateViewInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateView"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"view"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ViewFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ViewFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"View"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"filter"}},{"kind":"Field","name":{"kind":"Name","value":"display"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UpdateViewMutation, UpdateViewMutationVariables>;
export const DeleteViewDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteView"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteView"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteViewMutation, DeleteViewMutationVariables>;
export const SetViewPreferenceDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetViewPreference"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"viewKey"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"display"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"JSON"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setViewPreference"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"viewKey"},"value":{"kind":"Variable","name":{"kind":"Name","value":"viewKey"}}},{"kind":"Argument","name":{"kind":"Name","value":"display"},"value":{"kind":"Variable","name":{"kind":"Name","value":"display"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"preference"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ViewPreferenceFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ViewPreferenceFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ViewPreference"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"viewKey"}},{"kind":"Field","name":{"kind":"Name","value":"display"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<SetViewPreferenceMutation, SetViewPreferenceMutationVariables>;
export const AddFavoriteDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AddFavorite"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"kind"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"FavoriteKind"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"targetId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"afterFavoriteId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"addFavorite"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"kind"},"value":{"kind":"Variable","name":{"kind":"Name","value":"kind"}}},{"kind":"Argument","name":{"kind":"Name","value":"targetId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"targetId"}}},{"kind":"Argument","name":{"kind":"Name","value":"afterFavoriteId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"afterFavoriteId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"favorite"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"FavoriteFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"FavoriteFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Favorite"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"targetId"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<AddFavoriteMutation, AddFavoriteMutationVariables>;
export const RemoveFavoriteDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveFavorite"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"kind"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"FavoriteKind"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"targetId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeFavorite"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"kind"},"value":{"kind":"Variable","name":{"kind":"Name","value":"kind"}}},{"kind":"Argument","name":{"kind":"Name","value":"targetId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"targetId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<RemoveFavoriteMutation, RemoveFavoriteMutationVariables>;
export const ViewerDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Viewer"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"viewer"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"syncVersion"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"UserFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"workspace"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"urlKey"}},{"kind":"Field","name":{"kind":"Name","value":"logoUrl"}},{"kind":"Field","name":{"kind":"Name","value":"plan"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"workspaces"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"urlKey"}},{"kind":"Field","name":{"kind":"Name","value":"logoUrl"}},{"kind":"Field","name":{"kind":"Name","value":"plan"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"UserFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"User"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"notificationPrefs"}},{"kind":"Field","name":{"kind":"Name","value":"lastSeenAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<ViewerQuery, ViewerQueryVariables>;
export const IssueDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"IssueDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"comments"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"issueId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CommentFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"issueHistory"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"issueId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"fromValue"}},{"kind":"Field","name":{"kind":"Name","value":"toValue"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"actor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CommentFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Comment"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"actor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"editedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<IssueDetailQuery, IssueDetailQueryVariables>;
export const CreateIssueDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateIssue"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateIssueInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createIssue"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"issue"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IssueFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Issue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"stateId"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"estimate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDateSource"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"subIssueSortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"projectMilestoneId"}},{"kind":"Field","name":{"kind":"Name","value":"cycleId"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"autoClosedAt"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"canceledAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateIssueMutation, CreateIssueMutationVariables>;
export const UpdateIssueDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateIssue"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateIssueInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateIssue"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"issue"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IssueFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Issue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"stateId"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"estimate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDateSource"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"subIssueSortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"projectMilestoneId"}},{"kind":"Field","name":{"kind":"Name","value":"cycleId"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"autoClosedAt"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"canceledAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UpdateIssueMutation, UpdateIssueMutationVariables>;
export const ArchiveIssueDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ArchiveIssue"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"archived"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"archiveIssue"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"archived"},"value":{"kind":"Variable","name":{"kind":"Name","value":"archived"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<ArchiveIssueMutation, ArchiveIssueMutationVariables>;
export const DeleteIssueDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteIssue"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteIssue"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteIssueMutation, DeleteIssueMutationVariables>;
export const CreateCommentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateComment"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateCommentInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createComment"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"comment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CommentFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CommentFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Comment"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"actor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"editedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateCommentMutation, CreateCommentMutationVariables>;
export const UpdateCommentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateComment"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"body"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateComment"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"body"},"value":{"kind":"Variable","name":{"kind":"Name","value":"body"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"comment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CommentFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CommentFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Comment"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"actor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"editedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UpdateCommentMutation, UpdateCommentMutationVariables>;
export const DeleteCommentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteComment"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteComment"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteCommentMutation, DeleteCommentMutationVariables>;
export const CreateTeamDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateTeam"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateTeamInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createTeam"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"team"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"TeamFields"}},{"kind":"Field","name":{"kind":"Name","value":"states"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"StateFields"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TeamFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Team"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"parentTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"private"}},{"kind":"Field","name":{"kind":"Name","value":"estimateScale"}},{"kind":"Field","name":{"kind":"Name","value":"estimateAllowZero"}},{"kind":"Field","name":{"kind":"Name","value":"estimateExtended"}},{"kind":"Field","name":{"kind":"Name","value":"cyclesEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"cycleDurationWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleCooldownWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleStartDay"}},{"kind":"Field","name":{"kind":"Name","value":"cycleUpcomingCount"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddStarted"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddCompleted"}},{"kind":"Field","name":{"kind":"Name","value":"triageEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"triageRequirePriority"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoArchiveDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseParent"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseChildren"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"retiredAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"StateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkflowState"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"isDefault"}},{"kind":"Field","name":{"kind":"Name","value":"isSystem"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<CreateTeamMutation, CreateTeamMutationVariables>;
export const UpdateTeamDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateTeam"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateTeamInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateTeam"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"team"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"TeamFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TeamFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Team"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"parentTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"private"}},{"kind":"Field","name":{"kind":"Name","value":"estimateScale"}},{"kind":"Field","name":{"kind":"Name","value":"estimateAllowZero"}},{"kind":"Field","name":{"kind":"Name","value":"estimateExtended"}},{"kind":"Field","name":{"kind":"Name","value":"cyclesEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"cycleDurationWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleCooldownWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleStartDay"}},{"kind":"Field","name":{"kind":"Name","value":"cycleUpcomingCount"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddStarted"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddCompleted"}},{"kind":"Field","name":{"kind":"Name","value":"triageEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"triageRequirePriority"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoArchiveDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseParent"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseChildren"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"retiredAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UpdateTeamMutation, UpdateTeamMutationVariables>;
export const UpdateTeamCyclesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateTeamCycles"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateTeamCyclesInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateTeamCycles"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"team"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"TeamFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TeamFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Team"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"parentTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"private"}},{"kind":"Field","name":{"kind":"Name","value":"estimateScale"}},{"kind":"Field","name":{"kind":"Name","value":"estimateAllowZero"}},{"kind":"Field","name":{"kind":"Name","value":"estimateExtended"}},{"kind":"Field","name":{"kind":"Name","value":"cyclesEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"cycleDurationWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleCooldownWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleStartDay"}},{"kind":"Field","name":{"kind":"Name","value":"cycleUpcomingCount"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddStarted"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddCompleted"}},{"kind":"Field","name":{"kind":"Name","value":"triageEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"triageRequirePriority"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoArchiveDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseParent"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseChildren"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"retiredAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UpdateTeamCyclesMutation, UpdateTeamCyclesMutationVariables>;
export const UpdateTeamTriageDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateTeamTriage"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateTeamTriageInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateTeamTriage"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"team"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"TeamFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TeamFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Team"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"parentTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"private"}},{"kind":"Field","name":{"kind":"Name","value":"estimateScale"}},{"kind":"Field","name":{"kind":"Name","value":"estimateAllowZero"}},{"kind":"Field","name":{"kind":"Name","value":"estimateExtended"}},{"kind":"Field","name":{"kind":"Name","value":"cyclesEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"cycleDurationWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleCooldownWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleStartDay"}},{"kind":"Field","name":{"kind":"Name","value":"cycleUpcomingCount"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddStarted"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddCompleted"}},{"kind":"Field","name":{"kind":"Name","value":"triageEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"triageRequirePriority"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoArchiveDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseParent"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseChildren"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"retiredAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UpdateTeamTriageMutation, UpdateTeamTriageMutationVariables>;
export const UpdateTeamArchiveDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateTeamArchive"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateTeamArchiveInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateTeamArchive"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"team"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"TeamFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TeamFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Team"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"parentTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"private"}},{"kind":"Field","name":{"kind":"Name","value":"estimateScale"}},{"kind":"Field","name":{"kind":"Name","value":"estimateAllowZero"}},{"kind":"Field","name":{"kind":"Name","value":"estimateExtended"}},{"kind":"Field","name":{"kind":"Name","value":"cyclesEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"cycleDurationWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleCooldownWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleStartDay"}},{"kind":"Field","name":{"kind":"Name","value":"cycleUpcomingCount"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddStarted"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddCompleted"}},{"kind":"Field","name":{"kind":"Name","value":"triageEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"triageRequirePriority"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoArchiveDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseParent"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseChildren"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"retiredAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UpdateTeamArchiveMutation, UpdateTeamArchiveMutationVariables>;
export const AcceptTriageIssueDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AcceptTriageIssue"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"acceptTriageIssue"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"issue"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IssueFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Issue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"stateId"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"estimate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDateSource"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"subIssueSortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"projectMilestoneId"}},{"kind":"Field","name":{"kind":"Name","value":"cycleId"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"autoClosedAt"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"canceledAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<AcceptTriageIssueMutation, AcceptTriageIssueMutationVariables>;
export const DeclineTriageIssueDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeclineTriageIssue"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"declineTriageIssue"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"issue"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IssueFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Issue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"stateId"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"estimate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDateSource"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"subIssueSortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"projectMilestoneId"}},{"kind":"Field","name":{"kind":"Name","value":"cycleId"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"autoClosedAt"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"canceledAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<DeclineTriageIssueMutation, DeclineTriageIssueMutationVariables>;
export const MarkIssueDuplicateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MarkIssueDuplicate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"canonicalId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"markIssueDuplicate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"canonicalId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"canonicalId"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"issue"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IssueFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Issue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"stateId"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"estimate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDateSource"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"subIssueSortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"projectMilestoneId"}},{"kind":"Field","name":{"kind":"Name","value":"cycleId"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"autoClosedAt"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"canceledAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<MarkIssueDuplicateMutation, MarkIssueDuplicateMutationVariables>;
export const SnoozeIssueDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SnoozeIssue"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"until"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Time"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"snoozeIssue"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"until"},"value":{"kind":"Variable","name":{"kind":"Name","value":"until"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"issue"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IssueFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Issue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"stateId"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"estimate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDateSource"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"subIssueSortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"projectMilestoneId"}},{"kind":"Field","name":{"kind":"Name","value":"cycleId"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"autoClosedAt"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"canceledAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<SnoozeIssueMutation, SnoozeIssueMutationVariables>;
export const CreateWorkflowStateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateWorkflowState"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateWorkflowStateInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createWorkflowState"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"state"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"StateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"StateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkflowState"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"isDefault"}},{"kind":"Field","name":{"kind":"Name","value":"isSystem"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<CreateWorkflowStateMutation, CreateWorkflowStateMutationVariables>;
export const UpdateWorkflowStateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateWorkflowState"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateWorkflowStateInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateWorkflowState"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"state"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"StateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"StateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkflowState"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"isDefault"}},{"kind":"Field","name":{"kind":"Name","value":"isSystem"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UpdateWorkflowStateMutation, UpdateWorkflowStateMutationVariables>;
export const ArchiveWorkflowStateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ArchiveWorkflowState"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"archived"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"archiveWorkflowState"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"archived"},"value":{"kind":"Variable","name":{"kind":"Name","value":"archived"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<ArchiveWorkflowStateMutation, ArchiveWorkflowStateMutationVariables>;
export const SetUserRoleDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetUserRole"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"userId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"role"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserRole"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setUserRole"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"userId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"userId"}}},{"kind":"Argument","name":{"kind":"Name","value":"role"},"value":{"kind":"Variable","name":{"kind":"Name","value":"role"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"UserFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"UserFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"User"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"notificationPrefs"}},{"kind":"Field","name":{"kind":"Name","value":"lastSeenAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<SetUserRoleMutation, SetUserRoleMutationVariables>;
export const SuspendUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SuspendUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"userId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"suspended"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"suspendUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"userId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"userId"}}},{"kind":"Argument","name":{"kind":"Name","value":"suspended"},"value":{"kind":"Variable","name":{"kind":"Name","value":"suspended"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"UserFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"UserFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"User"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"notificationPrefs"}},{"kind":"Field","name":{"kind":"Name","value":"lastSeenAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<SuspendUserMutation, SuspendUserMutationVariables>;
export const UpdateProfileDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateProfile"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateProfileInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateProfile"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"UserFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"UserFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"User"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"notificationPrefs"}},{"kind":"Field","name":{"kind":"Name","value":"lastSeenAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UpdateProfileMutation, UpdateProfileMutationVariables>;