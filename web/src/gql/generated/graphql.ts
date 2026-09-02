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

/**
 * A signed-in browser or device. The refresh token is never on this type.
 *
 * Sessions are not replicated: they belong to an account, not a workspace, and putting
 * them in every device's IndexedDB would copy a credential inventory onto every laptop.
 */
export type AccountSession = {
  country?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['Time']['output'];
  /** True when this row is the refresh cookie on this request. */
  current: Scalars['Boolean']['output'];
  expiresAt: Scalars['Time']['output'];
  id: Scalars['UUID']['output'];
  ip?: Maybe<Scalars['String']['output']>;
  /** Chrome on macOS, or Unknown device when the user-agent cannot be read. */
  label: Scalars['String']['output'];
  lastSeenAt: Scalars['Time']['output'];
  userAgent?: Maybe<Scalars['String']['output']>;
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

/** A shareable intake form. Submitting it creates a triage issue on the team. */
export type AskForm = {
  archivedAt?: Maybe<Scalars['Time']['output']>;
  createdAt: Scalars['Time']['output'];
  creatorId?: Maybe<Scalars['UUID']['output']>;
  deletedAt?: Maybe<Scalars['Time']['output']>;
  description: Scalars['String']['output'];
  id: Scalars['UUID']['output'];
  name: Scalars['String']['output'];
  teamId: Scalars['UUID']['output'];
  /** The public URL secret. Members copy `{origin}/ask/{token}` from settings. */
  token: Scalars['String']['output'];
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type AskFormPayload = MutationResult & {
  askForm: AskForm;
  version: Scalars['Int']['output'];
};

/** A link card on an issue. Recreating the same URL updates this row instead of minting another. */
export type Attachment = {
  createdAt: Scalars['Time']['output'];
  creatorId?: Maybe<Scalars['UUID']['output']>;
  iconUrl?: Maybe<Scalars['String']['output']>;
  id: Scalars['UUID']['output'];
  issueId: Scalars['UUID']['output'];
  /** Arbitrary key/value. Subtitle tokens `{var__since}` and `{var__relativeTimestamp}` look up keys here. */
  metadata?: Maybe<Scalars['JSON']['output']>;
  subtitle?: Maybe<Scalars['String']['output']>;
  teamId: Scalars['UUID']['output'];
  title: Scalars['String']['output'];
  updatedAt: Scalars['Time']['output'];
  url: Scalars['String']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type AttachmentPayload = MutationResult & {
  attachment: Attachment;
  version: Scalars['Int']['output'];
};

/**
 * One security-relevant event: who did what, to what, from where.
 *
 * Read on the admin-only audit log screen. Not on the sync stream — a workspace-wide record
 * of everybody's administrative actions does not belong in every member's local replica.
 */
export type AuditLogEntry = {
  /** A dotted name, e.g. member.role_changed. Stable enough to filter and export on. */
  action: Scalars['String']['output'];
  actorLabel: Scalars['String']['output'];
  /** One of: user, app_user, integration, system. */
  actorType: Scalars['String']['output'];
  /**
   * The actor's user id, or null once that user has been deleted. Use actorLabel to name
   * them: it is the name as it read when the event happened, and it survives the deletion.
   */
  actorUserId?: Maybe<Scalars['UUID']['output']>;
  after?: Maybe<Scalars['JSON']['output']>;
  /** The entity either side of the change. Null where the event has no such side. Never contains a credential. */
  before?: Maybe<Scalars['JSON']['output']>;
  createdAt: Scalars['Time']['output'];
  id: Scalars['UUID']['output'];
  /** Null where the transport did not carry it; today only the sign-in paths do. */
  ip?: Maybe<Scalars['String']['output']>;
  targetId?: Maybe<Scalars['UUID']['output']>;
  targetLabel?: Maybe<Scalars['String']['output']>;
  /** Null together with targetId, for events that act on nobody — a sign-in. */
  targetType?: Maybe<Scalars['String']['output']>;
  userAgent?: Maybe<Scalars['String']['output']>;
};

/**
 * A third-party application this person has authorised in this workspace.
 *
 * Grouped by application: several live tokens for the same app are one row. Tokens
 * and secrets are never on this type. Authorisations are not replicated — they belong
 * to a person, and putting them in every device's IndexedDB would copy a credential
 * inventory onto every laptop.
 */
export type AuthorisedOauthApp = {
  clientId: Scalars['String']['output'];
  /** When this person first authorised the application. */
  createdAt: Scalars['Time']['output'];
  developer?: Maybe<Scalars['String']['output']>;
  /** The OAuth application's id, not a token id. */
  id: Scalars['UUID']['output'];
  imageUrl?: Maybe<Scalars['String']['output']>;
  lastUsedAt?: Maybe<Scalars['Time']['output']>;
  name: Scalars['String']['output'];
  /** The union of scopes still granted by live tokens. */
  scopes: Array<Scalars['String']['output']>;
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
  /** End of the highlighted span (exclusive). */
  anchorEnd?: Maybe<Scalars['Int']['output']>;
  /**
   * Start of the highlighted span in the issue description, in UTF-16 code units.
   * Set together with `anchorEnd` and `quote` on an inline comment; omitted otherwise.
   */
  anchorStart?: Maybe<Scalars['Int']['output']>;
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
  /** The selected text at the moment the comment was left, used to re-find the span after edits. */
  quote?: Maybe<Scalars['String']['output']>;
  /**
   * Emoji reactions on this comment, oldest first.
   *
   * Non-null and possibly empty: a comment with no reactions is the ordinary case, and a null
   * here would make every client write the same emptiness check.
   */
  reactions: Array<Reaction>;
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

export type CreateAskFormInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  teamId: Scalars['UUID']['input'];
};

export type CreateAttachmentInput = {
  iconUrl?: InputMaybe<Scalars['String']['input']>;
  issueId: Scalars['UUID']['input'];
  metadata?: InputMaybe<Scalars['JSON']['input']>;
  subtitle?: InputMaybe<Scalars['String']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
  url: Scalars['String']['input'];
};

export type CreateCommentInput = {
  anchorEnd?: InputMaybe<Scalars['Int']['input']>;
  /** Set together with `anchorEnd` and `quote` to pin the comment to a span of the issue description. */
  anchorStart?: InputMaybe<Scalars['Int']['input']>;
  body: Scalars['String']['input'];
  issueId: Scalars['UUID']['input'];
  parentId?: InputMaybe<Scalars['UUID']['input']>;
  quote?: InputMaybe<Scalars['String']['input']>;
};

export type CreateCustomerInput = {
  domains?: InputMaybe<Array<Scalars['String']['input']>>;
  logoUrl?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  ownerId?: InputMaybe<Scalars['UUID']['input']>;
  revenue?: InputMaybe<Scalars['Int']['input']>;
  size?: InputMaybe<Scalars['Int']['input']>;
  status?: InputMaybe<CustomerStatus>;
  tier?: InputMaybe<Scalars['String']['input']>;
};

export type CreateCustomerRequestInput = {
  body?: InputMaybe<Scalars['String']['input']>;
  customerId?: InputMaybe<Scalars['UUID']['input']>;
  important?: InputMaybe<Scalars['Boolean']['input']>;
  issueId?: InputMaybe<Scalars['UUID']['input']>;
  projectId?: InputMaybe<Scalars['UUID']['input']>;
};

export type CreateDashboardInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<Scalars['JSON']['input']>;
  name: Scalars['String']['input'];
  /** True keeps the dashboard private to its creator. */
  private?: InputMaybe<Scalars['Boolean']['input']>;
  teamId?: InputMaybe<Scalars['UUID']['input']>;
};

export type CreateDashboardTileInput = {
  dashboardId: Scalars['UUID']['input'];
  display?: InputMaybe<DashboardTileDisplay>;
  filter?: InputMaybe<Scalars['JSON']['input']>;
  measure?: InputMaybe<DashboardMeasure>;
  slice?: InputMaybe<DashboardSlice>;
  title?: InputMaybe<Scalars['String']['input']>;
};

export type CreateDocumentInput = {
  body?: InputMaybe<Scalars['String']['input']>;
  /** When set, the document belongs to this project rather than the team home. */
  projectId?: InputMaybe<Scalars['UUID']['input']>;
  teamId: Scalars['UUID']['input'];
  title: Scalars['String']['input'];
};

export type CreateDraftInput = {
  /** Optional. The server mints one when this is absent. */
  id?: InputMaybe<Scalars['UUID']['input']>;
  kind: DraftKind;
  payload: Scalars['JSON']['input'];
};

export type CreateFormTemplateFieldInput = {
  config?: InputMaybe<Scalars['JSON']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  fieldType: FormTemplateFieldType;
  formTemplateId: Scalars['UUID']['input'];
  label: Scalars['String']['input'];
  required?: InputMaybe<Scalars['Boolean']['input']>;
};

export type CreateFormTemplateInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  properties?: InputMaybe<Scalars['JSON']['input']>;
  teamId?: InputMaybe<Scalars['UUID']['input']>;
};

export type CreateGitHubConnectionInput = {
  branchNameFormat?: InputMaybe<Scalars['String']['input']>;
  linkCommits?: InputMaybe<Scalars['Boolean']['input']>;
  linkbacks?: InputMaybe<Scalars['Boolean']['input']>;
  orgLogin?: InputMaybe<Scalars['String']['input']>;
};

export type CreateGitHubUserLinkInput = {
  githubLogin: Scalars['String']['input'];
};

export type CreateGitLabConnectionInput = {
  accessToken?: InputMaybe<Scalars['String']['input']>;
  branchNameFormat?: InputMaybe<Scalars['String']['input']>;
  instanceUrl?: InputMaybe<Scalars['String']['input']>;
  linkCommits?: InputMaybe<Scalars['Boolean']['input']>;
  linkbacks?: InputMaybe<Scalars['Boolean']['input']>;
};

export type CreateGitLabUserLinkInput = {
  gitlabUsername: Scalars['String']['input'];
};

export type CreateInitiativeInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  leadTeamId?: InputMaybe<Scalars['UUID']['input']>;
  name: Scalars['String']['input'];
  ownerId?: InputMaybe<Scalars['UUID']['input']>;
  /** Nests the new initiative under this parent. Same rules as addInitiativeRelation. */
  parentInitiativeId?: InputMaybe<Scalars['UUID']['input']>;
  priority?: InputMaybe<Scalars['Int']['input']>;
  status?: InputMaybe<InitiativeStatus>;
  targetDate?: InputMaybe<Scalars['String']['input']>;
  targetDateGranularity?: InputMaybe<TimeframeGranularity>;
};

export type CreateInitiativeLabelInput = {
  afterLabelId?: InputMaybe<Scalars['UUID']['input']>;
  color?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  isGroup?: InputMaybe<Scalars['Boolean']['input']>;
  name: Scalars['String']['input'];
  parentId?: InputMaybe<Scalars['UUID']['input']>;
};

export type CreateInitiativeUpdateInput = {
  body?: InputMaybe<Scalars['String']['input']>;
  health: ProjectUpdateHealth;
  initiativeId: Scalars['UUID']['input'];
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
  /** Records which form template the issue was filed from. */
  formTemplateId?: InputMaybe<Scalars['UUID']['input']>;
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
  /**
   * Makes the new issue the first occurrence of a schedule. Requires a first due date
   * (recurringFirstDueDate, or dueDate).
   */
  recurringCadence?: InputMaybe<RecurringCadence>;
  /** Calendar day, `2006-01-02`. The due date of the first occurrence. */
  recurringFirstDueDate?: InputMaybe<Scalars['String']['input']>;
  /**
   * The team's member or non-member default is applied when templateId is omitted.
   * Set this when the composer cleared the applied default — otherwise the server would
   * put it back.
   */
  skipDefaultTemplate?: InputMaybe<Scalars['Boolean']['input']>;
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
  /** Omitted or empty means the template files a parent only. */
  subIssues?: InputMaybe<Array<TemplateSubIssueInput>>;
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

export type CreateOauthAuthorizationInput = {
  /** user (default) or app. */
  actor?: InputMaybe<Scalars['String']['input']>;
  clientId: Scalars['String']['input'];
  codeChallenge?: InputMaybe<Scalars['String']['input']>;
  codeChallengeMethod?: InputMaybe<Scalars['String']['input']>;
  redirectUri: Scalars['String']['input'];
  responseType: Scalars['String']['input'];
  scope: Scalars['String']['input'];
  state?: InputMaybe<Scalars['String']['input']>;
  teamIds?: InputMaybe<Array<Scalars['UUID']['input']>>;
};

export type CreateOauthClientInput = {
  allowedScopes?: InputMaybe<Array<Scalars['String']['input']>>;
  clientCredentialsEnabled?: InputMaybe<Scalars['Boolean']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  developer?: InputMaybe<Scalars['String']['input']>;
  developerUrl?: InputMaybe<Scalars['String']['input']>;
  imageUrl?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  publicEnabled?: InputMaybe<Scalars['Boolean']['input']>;
  redirectUris: Array<Scalars['String']['input']>;
  webhookUrl?: InputMaybe<Scalars['String']['input']>;
};

export type CreateProjectInput = {
  color?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  icon?: InputMaybe<Scalars['String']['input']>;
  leadId?: InputMaybe<Scalars['UUID']['input']>;
  memberIds?: InputMaybe<Array<Scalars['UUID']['input']>>;
  name: Scalars['String']['input'];
  priority?: InputMaybe<Scalars['Int']['input']>;
  projectTemplateId?: InputMaybe<Scalars['UUID']['input']>;
  startDate?: InputMaybe<Scalars['String']['input']>;
  startDateGranularity?: InputMaybe<TimeframeGranularity>;
  statusId?: InputMaybe<Scalars['UUID']['input']>;
  summary?: InputMaybe<Scalars['String']['input']>;
  targetDate?: InputMaybe<Scalars['String']['input']>;
  targetDateGranularity?: InputMaybe<TimeframeGranularity>;
  /** At least one. A project with no team is invisible to everyone. */
  teamIds: Array<Scalars['UUID']['input']>;
};

export type CreateProjectLabelInput = {
  afterLabelId?: InputMaybe<Scalars['UUID']['input']>;
  color?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  isGroup?: InputMaybe<Scalars['Boolean']['input']>;
  name: Scalars['String']['input'];
  parentId?: InputMaybe<Scalars['UUID']['input']>;
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

export type CreateProjectTemplateInput = {
  body?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  properties?: InputMaybe<Scalars['JSON']['input']>;
  summary?: InputMaybe<Scalars['String']['input']>;
  teamId?: InputMaybe<Scalars['UUID']['input']>;
};

export type CreateProjectTemplateIssueInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  parentId?: InputMaybe<Scalars['UUID']['input']>;
  projectTemplateId: Scalars['UUID']['input'];
  properties?: InputMaybe<Scalars['JSON']['input']>;
  title: Scalars['String']['input'];
};

export type CreateProjectTemplateMilestoneInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  projectTemplateId: Scalars['UUID']['input'];
  targetDate?: InputMaybe<Scalars['String']['input']>;
};

export type CreateProjectUpdateInput = {
  body?: InputMaybe<Scalars['String']['input']>;
  health: ProjectUpdateHealth;
  projectId: Scalars['UUID']['input'];
};

export type CreatePulseFeedInput = {
  name: Scalars['String']['input'];
  projectIds: Array<Scalars['UUID']['input']>;
};

export type CreateRecurringIssueInput = {
  body?: InputMaybe<Scalars['String']['input']>;
  cadence: RecurringCadence;
  /** Calendar day, `2006-01-02`. The due date of the first occurrence, which is filed immediately. */
  firstDueDate: Scalars['String']['input'];
  properties?: InputMaybe<Scalars['JSON']['input']>;
  /** Convert this existing issue into the first occurrence instead of filing a new one. */
  sourceIssueId?: InputMaybe<Scalars['UUID']['input']>;
  teamId: Scalars['UUID']['input'];
  /** Provenance only. The snapshot is taken now; later edits to this template are ignored. */
  templateId?: InputMaybe<Scalars['UUID']['input']>;
  title: Scalars['String']['input'];
};

export type CreateSentryConnectionInput = {
  defaultTeamId: Scalars['UUID']['input'];
  organizationSlug?: InputMaybe<Scalars['String']['input']>;
};

export type CreateSlaRuleInput = {
  action: SlaAction;
  durationMinutes?: InputMaybe<Scalars['Int']['input']>;
  filter?: InputMaybe<Scalars['JSON']['input']>;
};

export type CreateSlackConnectionInput = {
  channelName?: InputMaybe<Scalars['String']['input']>;
  defaultTeamId: Scalars['UUID']['input'];
  notifyComments?: InputMaybe<Scalars['Boolean']['input']>;
  notifyIssues?: InputMaybe<Scalars['Boolean']['input']>;
  webhookUrl?: InputMaybe<Scalars['String']['input']>;
};

export type CreateTeamInput = {
  color?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  icon?: InputMaybe<Scalars['String']['input']>;
  key: Scalars['String']['input'];
  name: Scalars['String']['input'];
  /** When set, creates a sub-team under this parent. */
  parentTeamId?: InputMaybe<Scalars['UUID']['input']>;
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
  /** Attaches the view as a tab on this project rather than in a sidebar. */
  projectId?: InputMaybe<Scalars['UUID']['input']>;
  teamId?: InputMaybe<Scalars['UUID']['input']>;
};

export type CreateWebhookInput = {
  allPublicTeams?: InputMaybe<Scalars['Boolean']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  resourceTypes: Array<Scalars['String']['input']>;
  /** XOR with allPublicTeams: one team, or every public team. */
  teamId?: InputMaybe<Scalars['UUID']['input']>;
  url: Scalars['String']['input'];
};

export type CreateWorkflowStateInput = {
  afterStateId?: InputMaybe<Scalars['UUID']['input']>;
  category: StateCategory;
  color?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  teamId: Scalars['UUID']['input'];
};

/** An external organisation whose feedback is attributed onto issues and projects. */
export type Customer = {
  archivedAt?: Maybe<Scalars['Time']['output']>;
  createdAt: Scalars['Time']['output'];
  creator?: Maybe<User>;
  creatorId?: Maybe<Scalars['UUID']['output']>;
  deletedAt?: Maybe<Scalars['Time']['output']>;
  deletedBy?: Maybe<Scalars['UUID']['output']>;
  domains: Array<Scalars['String']['output']>;
  id: Scalars['UUID']['output'];
  logoUrl: Scalars['String']['output'];
  name: Scalars['String']['output'];
  owner?: Maybe<User>;
  ownerId?: Maybe<Scalars['UUID']['output']>;
  revenue?: Maybe<Scalars['Int']['output']>;
  size?: Maybe<Scalars['Int']['output']>;
  sortOrder: Scalars['String']['output'];
  status: CustomerStatus;
  tier?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type CustomerPayload = MutationResult & {
  customer: Customer;
  version: Scalars['Int']['output'];
};

/** Feedback attached to an issue and/or a project, optionally a customer. */
export type CustomerRequest = {
  body: Scalars['String']['output'];
  createdAt: Scalars['Time']['output'];
  creator?: Maybe<User>;
  creatorId?: Maybe<Scalars['UUID']['output']>;
  customer?: Maybe<Customer>;
  customerId?: Maybe<Scalars['UUID']['output']>;
  id: Scalars['UUID']['output'];
  important: Scalars['Boolean']['output'];
  issue?: Maybe<Issue>;
  issueId?: Maybe<Scalars['UUID']['output']>;
  project?: Maybe<Project>;
  projectId?: Maybe<Scalars['UUID']['output']>;
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type CustomerRequestPayload = MutationResult & {
  customerRequest: CustomerRequest;
  version: Scalars['Int']['output'];
};

export type CustomerStatus =
  | 'ACTIVE'
  | 'CHURNED'
  | 'PROSPECT';

/** Personal watch on a customer. Slack-channel subscriptions stay out. */
export type CustomerSubscription = {
  createdAt: Scalars['Time']['output'];
  customerId: Scalars['UUID']['output'];
  id: Scalars['UUID']['output'];
  /** Notify when a request is attributed to the customer. */
  requestAdded: Scalars['Boolean']['output'];
  /** Notify when a request's issue is completed or canceled. */
  requestCompleted: Scalars['Boolean']['output'];
  /** Notify when a request is marked important. */
  requestImportant: Scalars['Boolean']['output'];
  updatedAt: Scalars['Time']['output'];
  userId: Scalars['UUID']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type CustomerSubscriptionPayload = MutationResult & {
  customerSubscription: CustomerSubscription;
  version: Scalars['Int']['output'];
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

/**
 * The viewer's ICS subscription for one team. The feed token is not on this type:
 * the replica only needs to know a feed exists. The URL that contains the token
 * is on CycleCalendarFeedURL.
 */
export type CycleCalendarFeed = {
  createdAt: Scalars['Time']['output'];
  id: Scalars['UUID']['output'];
  teamId: Scalars['UUID']['output'];
  updatedAt: Scalars['Time']['output'];
  userId: Scalars['UUID']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type CycleCalendarFeedPayload = MutationResult & {
  cycleCalendarFeed: CycleCalendarFeed;
  url: Scalars['String']['output'];
  version: Scalars['Int']['output'];
};

export type CycleCalendarFeedUrl = {
  url: Scalars['String']['output'];
};

export type CyclePayload = MutationResult & {
  cycle: Cycle;
  version: Scalars['Int']['output'];
};

/** A page of Insights tiles, workspace / team / personal. */
export type Dashboard = {
  archivedAt?: Maybe<Scalars['Time']['output']>;
  createdAt: Scalars['Time']['output'];
  creatorId?: Maybe<Scalars['UUID']['output']>;
  deletedAt?: Maybe<Scalars['Time']['output']>;
  deletedBy?: Maybe<Scalars['UUID']['output']>;
  description: Scalars['String']['output'];
  /** Dashboard-level filter, AND-ed with each tile's filter. Same AST as views. */
  filter: Scalars['JSON']['output'];
  id: Scalars['UUID']['output'];
  name: Scalars['String']['output'];
  /** Set means it is that person's private dashboard. */
  ownerId?: Maybe<Scalars['UUID']['output']>;
  sortOrder: Scalars['String']['output'];
  /** Null means the dashboard spans the workspace. */
  teamId?: Maybe<Scalars['UUID']['output']>;
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

/** Insights measure a dashboard tile charts. Same vocabulary as the live Insights panel. */
export type DashboardMeasure =
  | 'BURN_UP'
  | 'COUNT'
  | 'CYCLE_TIME'
  | 'EFFORT'
  | 'ISSUE_AGE'
  | 'LEAD_TIME';

export type DashboardPayload = MutationResult & {
  dashboard: Dashboard;
  version: Scalars['Int']['output'];
};

/** Dimension a dashboard tile slices by. Same vocabulary as the live Insights panel. */
export type DashboardSlice =
  | 'ASSIGNEE'
  | 'LABEL'
  | 'PRIORITY'
  | 'PROJECT'
  | 'STATE_CATEGORY'
  | 'TEAM';

/** One Insights chart, table, or metric on a dashboard. */
export type DashboardTile = {
  createdAt: Scalars['Time']['output'];
  dashboardId: Scalars['UUID']['output'];
  display: DashboardTileDisplay;
  filter: Scalars['JSON']['output'];
  id: Scalars['UUID']['output'];
  measure: DashboardMeasure;
  slice: DashboardSlice;
  sortOrder: Scalars['String']['output'];
  title: Scalars['String']['output'];
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type DashboardTileDisplay =
  | 'CHART'
  | 'METRIC'
  | 'TABLE';

export type DashboardTilePayload = MutationResult & {
  dashboardTile: DashboardTile;
  version: Scalars['Int']['output'];
};

export type DeletePayload = MutationResult & {
  id: Scalars['UUID']['output'];
  version: Scalars['Int']['output'];
};

/** Long-form markdown attached to a team or a project. */
export type Document = {
  archivedAt?: Maybe<Scalars['Time']['output']>;
  body: Scalars['String']['output'];
  createdAt: Scalars['Time']['output'];
  creatorId?: Maybe<Scalars['UUID']['output']>;
  deletedAt?: Maybe<Scalars['Time']['output']>;
  id: Scalars['UUID']['output'];
  projectId?: Maybe<Scalars['UUID']['output']>;
  sortOrder: Scalars['String']['output'];
  teamId: Scalars['UUID']['output'];
  title: Scalars['String']['output'];
  updatedAt: Scalars['Time']['output'];
  updatedBy?: Maybe<Scalars['UUID']['output']>;
  workspaceId: Scalars['UUID']['output'];
};

export type DocumentPayload = MutationResult & {
  document: Document;
  version: Scalars['Int']['output'];
};

export type Draft = {
  createdAt: Scalars['Time']['output'];
  id: Scalars['UUID']['output'];
  kind: DraftKind;
  payload: Scalars['JSON']['output'];
  updatedAt: Scalars['Time']['output'];
  userId: Scalars['UUID']['output'];
  workspaceId: Scalars['UUID']['output'];
};

/** An unsent issue or comment the author asked to keep. Personal; not replicated. */
export type DraftKind =
  | 'COMMENT'
  | 'ISSUE';

export type DraftPayload = MutationResult & {
  draft: Draft;
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
  /** Enterprise: sub-teams nested up to five levels deep. */
  multiLevelSubTeams: Scalars['Boolean']['output'];
  plan: Scalars['String']['output'];
  privateTeams: Scalars['Boolean']['output'];
  /** Null means unlimited. */
  seatLimit?: Maybe<Scalars['Int']['output']>;
  seatsUsed: Scalars['Int']['output'];
  /** Slack integration. Stays free: gating chat is how an open-source tracker loses its ecosystem. */
  slack: Scalars['Boolean']['output'];
  /** Business+: SLA rules that own an issue's due date. */
  slas: Scalars['Boolean']['output'];
  sso: Scalars['Boolean']['output'];
  /** Business+: one level of sub-teams under a top-level parent. */
  subTeams: Scalars['Boolean']['output'];
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
  /** The folder this entry sits in. Null means the sidebar root. Folders themselves are always root. */
  folderId?: Maybe<Scalars['UUID']['output']>;
  id: Scalars['UUID']['output'];
  kind: FavoriteKind;
  /** The heading, for a folder. Null for every other kind. */
  name?: Maybe<Scalars['String']['output']>;
  position: Scalars['String']['output'];
  targetId: Scalars['UUID']['output'];
  updatedAt: Scalars['Time']['output'];
  userId: Scalars['UUID']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type FavoriteKind =
  | 'FOLDER'
  | 'ISSUE'
  | 'LABEL'
  | 'TEAM'
  | 'VIEW';

export type FavoritePayload = MutationResult & {
  favorite: Favorite;
  version: Scalars['Int']['output'];
};

/**
 * Structured intake template. Fields are separate rows (`FormTemplateField`) replicated
 * alongside the template.
 */
export type FormTemplate = {
  archivedAt?: Maybe<Scalars['Time']['output']>;
  createdAt: Scalars['Time']['output'];
  createdBy?: Maybe<Scalars['UUID']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['UUID']['output'];
  name: Scalars['String']['output'];
  position: Scalars['String']['output'];
  /** Default issue properties not captured by a field (assignee, status, labels, etc.). */
  properties: Scalars['JSON']['output'];
  /** Null means the template is offered in every team. */
  teamId?: Maybe<Scalars['UUID']['output']>;
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type FormTemplateField = {
  config: Scalars['JSON']['output'];
  createdAt: Scalars['Time']['output'];
  description?: Maybe<Scalars['String']['output']>;
  fieldType: FormTemplateFieldType;
  formTemplateId: Scalars['UUID']['output'];
  id: Scalars['UUID']['output'];
  label: Scalars['String']['output'];
  required: Scalars['Boolean']['output'];
  sortOrder: Scalars['String']['output'];
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type FormTemplateFieldPayload = MutationResult & {
  field: FormTemplateField;
  version: Scalars['Int']['output'];
};

export type FormTemplateFieldType =
  | 'checkboxes'
  | 'date'
  | 'dropdown'
  | 'due_date'
  | 'file_upload'
  | 'instructions'
  | 'label_group'
  | 'long_text'
  | 'priority'
  | 'text'
  | 'title';

export type FormTemplatePayload = MutationResult & {
  template: FormTemplate;
  version: Scalars['Int']['output'];
};

export type GitHubCommitWebhook = {
  secret: Scalars['String']['output'];
  url: Scalars['String']['output'];
};

/**
 * Workspace GitHub install. Credentials are not on this type: the replica carries the
 * settings a client needs to copy a git branch name, and nothing that could be a token.
 */
export type GitHubConnection = {
  branchNameFormat: Scalars['String']['output'];
  connectedAt?: Maybe<Scalars['Time']['output']>;
  createdAt: Scalars['Time']['output'];
  creatorId: Scalars['UUID']['output'];
  enabled: Scalars['Boolean']['output'];
  id: Scalars['UUID']['output'];
  linkCommits: Scalars['Boolean']['output'];
  /** When false, skip posting a comment back onto the GitHub PR or commit. */
  linkbacks: Scalars['Boolean']['output'];
  orgLogin?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type GitHubConnectionPayload = MutationResult & {
  githubConnection: GitHubConnection;
  version: Scalars['Int']['output'];
};

export type GitHubLinkPayload = MutationResult & {
  attachments: Array<Attachment>;
  version: Scalars['Int']['output'];
};

/**
 * GitHub pull-request status automations for one team.
 *
 * Not replicated: a mapping is a settings row, not a sync entity. When configured is
 * false, opened moves to the first Started status and a merged closing PR moves to the
 * first Completed status. A present row with a null field means no action for that event.
 */
export type GitHubTeamAutomation = {
  configured: Scalars['Boolean']['output'];
  draftedStateId?: Maybe<Scalars['UUID']['output']>;
  mergedStateId?: Maybe<Scalars['UUID']['output']>;
  openedStateId?: Maybe<Scalars['UUID']['output']>;
  readyForMergeStateId?: Maybe<Scalars['UUID']['output']>;
  reviewRequestedStateId?: Maybe<Scalars['UUID']['output']>;
  teamId: Scalars['UUID']['output'];
};

export type GitHubTeamAutomationPayload = {
  githubTeamAutomation: GitHubTeamAutomation;
};

export type GitHubUserLink = {
  createdAt: Scalars['Time']['output'];
  githubLogin: Scalars['String']['output'];
  id: Scalars['UUID']['output'];
  updatedAt: Scalars['Time']['output'];
  userId: Scalars['UUID']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type GitHubUserLinkPayload = MutationResult & {
  githubUserLink: GitHubUserLink;
  version: Scalars['Int']['output'];
};

/**
 * Workspace GitLab instance. Credentials are not on this type: the replica carries the
 * settings a client needs to copy a git branch name, and nothing that could be a token.
 * One GitLab instance per workspace; self-hosted is an instance URL with no path.
 */
export type GitLabConnection = {
  branchNameFormat: Scalars['String']['output'];
  connectedAt?: Maybe<Scalars['Time']['output']>;
  createdAt: Scalars['Time']['output'];
  creatorId: Scalars['UUID']['output'];
  enabled: Scalars['Boolean']['output'];
  id: Scalars['UUID']['output'];
  instanceUrl: Scalars['String']['output'];
  linkCommits: Scalars['Boolean']['output'];
  /** When false, skip posting a note back onto the GitLab MR or commit. */
  linkbacks: Scalars['Boolean']['output'];
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type GitLabConnectionPayload = MutationResult & {
  gitlabConnection: GitLabConnection;
  version: Scalars['Int']['output'];
};

export type GitLabLinkPayload = MutationResult & {
  attachments: Array<Attachment>;
  version: Scalars['Int']['output'];
};

/**
 * GitLab merge-request status automations for one team.
 *
 * Not replicated: a mapping is a settings row, not a sync entity. When configured is
 * false, opened moves to the first Started status and a merged closing MR moves to the
 * first Completed status. A present row with a null field means no action for that event.
 */
export type GitLabTeamAutomation = {
  configured: Scalars['Boolean']['output'];
  draftedStateId?: Maybe<Scalars['UUID']['output']>;
  mergedStateId?: Maybe<Scalars['UUID']['output']>;
  openedStateId?: Maybe<Scalars['UUID']['output']>;
  readyForMergeStateId?: Maybe<Scalars['UUID']['output']>;
  reviewRequestedStateId?: Maybe<Scalars['UUID']['output']>;
  teamId: Scalars['UUID']['output'];
};

export type GitLabTeamAutomationPayload = {
  gitlabTeamAutomation: GitLabTeamAutomation;
};

export type GitLabUserLink = {
  createdAt: Scalars['Time']['output'];
  gitlabUsername: Scalars['String']['output'];
  id: Scalars['UUID']['output'];
  updatedAt: Scalars['Time']['output'];
  userId: Scalars['UUID']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type GitLabUserLinkPayload = MutationResult & {
  gitlabUserLink: GitLabUserLink;
  version: Scalars['Int']['output'];
};

export type GitLabWebhook = {
  secret: Scalars['String']['output'];
  url: Scalars['String']['output'];
};

/** A workspace objective grouping a manually curated set of projects. */
export type Initiative = {
  archivedAt?: Maybe<Scalars['Time']['output']>;
  createdAt: Scalars['Time']['output'];
  creator?: Maybe<User>;
  creatorId?: Maybe<Scalars['UUID']['output']>;
  deletedAt?: Maybe<Scalars['Time']['output']>;
  deletedBy?: Maybe<Scalars['UUID']['output']>;
  description: Scalars['String']['output'];
  id: Scalars['UUID']['output'];
  leadTeam?: Maybe<Team>;
  leadTeamId?: Maybe<Scalars['UUID']['output']>;
  name: Scalars['String']['output'];
  owner?: Maybe<User>;
  ownerId?: Maybe<Scalars['UUID']['output']>;
  priority: Scalars['Int']['output'];
  projects: Array<InitiativeProject>;
  sortOrder: Scalars['String']['output'];
  status: InitiativeStatus;
  targetDate?: Maybe<Scalars['String']['output']>;
  targetDateGranularity?: Maybe<TimeframeGranularity>;
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

/** Workspace taxonomy for labelling initiatives — separate from issue and project labels. */
export type InitiativeLabel = {
  archivedAt?: Maybe<Scalars['Time']['output']>;
  color: Scalars['String']['output'];
  createdAt: Scalars['Time']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['UUID']['output'];
  isGroup: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  parentId?: Maybe<Scalars['UUID']['output']>;
  position: Scalars['String']['output'];
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

/** One initiative label applied to one initiative. */
export type InitiativeLabelLink = {
  createdAt: Scalars['Time']['output'];
  createdBy?: Maybe<Scalars['UUID']['output']>;
  groupId?: Maybe<Scalars['UUID']['output']>;
  id: Scalars['UUID']['output'];
  initiativeId: Scalars['UUID']['output'];
  labelId: Scalars['UUID']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type InitiativeLabelLinkPayload = MutationResult & {
  initiativeLabelLink: InitiativeLabelLink;
  version: Scalars['Int']['output'];
};

export type InitiativeLabelPayload = MutationResult & {
  initiativeLabel: InitiativeLabel;
  version: Scalars['Int']['output'];
};

export type InitiativePayload = MutationResult & {
  initiative: Initiative;
  version: Scalars['Int']['output'];
};

export type InitiativeProject = {
  createdAt: Scalars['Time']['output'];
  id: Scalars['UUID']['output'];
  initiativeId: Scalars['UUID']['output'];
  project: Project;
  projectId: Scalars['UUID']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type InitiativeProjectPayload = MutationResult & {
  initiativeProject: InitiativeProject;
  version: Scalars['Int']['output'];
};

/** A parent → child nest between two initiatives. Multiple parents are allowed. */
export type InitiativeRelation = {
  childInitiativeId: Scalars['UUID']['output'];
  createdAt: Scalars['Time']['output'];
  createdBy?: Maybe<Scalars['UUID']['output']>;
  id: Scalars['UUID']['output'];
  parentInitiativeId: Scalars['UUID']['output'];
  sortOrder: Scalars['String']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type InitiativeRelationPayload = MutationResult & {
  initiativeRelation: InitiativeRelation;
  version: Scalars['Int']['output'];
};

export type InitiativeStatus =
  | 'ACTIVE'
  | 'CANCELED'
  | 'COMPLETED'
  | 'PLANNED'
  | 'PROPOSED';

/** Personal watch on an initiative. Issues fire for projects linked to it. */
export type InitiativeSubscription = {
  createdAt: Scalars['Time']['output'];
  id: Scalars['UUID']['output'];
  initiativeId: Scalars['UUID']['output'];
  /** Notify when a newly created issue is in a linked project. */
  issuesAdded: Scalars['Boolean']['output'];
  /** Notify when an issue in a linked project is completed or canceled. */
  issuesCompleted: Scalars['Boolean']['output'];
  updatedAt: Scalars['Time']['output'];
  /** Notify when a new initiative update is posted. */
  updates: Scalars['Boolean']['output'];
  userId: Scalars['UUID']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type InitiativeSubscriptionPayload = MutationResult & {
  initiativeSubscription: InitiativeSubscription;
  version: Scalars['Int']['output'];
};

/** A status post on an initiative — health plus narrative markdown. */
export type InitiativeUpdate = {
  author?: Maybe<User>;
  authorId: Scalars['UUID']['output'];
  body: Scalars['String']['output'];
  createdAt: Scalars['Time']['output'];
  deletedAt?: Maybe<Scalars['Time']['output']>;
  editedAt?: Maybe<Scalars['Time']['output']>;
  health: ProjectUpdateHealth;
  id: Scalars['UUID']['output'];
  initiative?: Maybe<Initiative>;
  initiativeId: Scalars['UUID']['output'];
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type InitiativeUpdatePayload = MutationResult & {
  initiativeUpdate: InitiativeUpdate;
  version: Scalars['Int']['output'];
};

/**
 * A proposal to list a third-party integration in this workspace's directory.
 *
 * Deliberately not a `MutationResult` and not on the replica: the catalogue itself is
 * derived from live connection rows, and a submission is an inbox item for the people
 * who can connect new tools.
 */
export type IntegrationSubmission = {
  createdAt: Scalars['Time']['output'];
  id: Scalars['UUID']['output'];
  name: Scalars['String']['output'];
  submittedBy: Scalars['UUID']['output'];
  summary: Scalars['String']['output'];
  updatedAt: Scalars['Time']['output'];
  website: Scalars['String']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type IntegrationSubmissionPayload = {
  submission: IntegrationSubmission;
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
  /** Link cards on this issue. URL-idempotent: the same URL is one card. */
  attachments: Array<Attachment>;
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
  /** Which form template made this issue, for intake reporting. */
  formTemplateId?: Maybe<Scalars['UUID']['output']>;
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
  /** The schedule that minted this issue, or that this issue was converted into. */
  recurringIssueId?: Maybe<Scalars['UUID']['output']>;
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
  /** The address that creates issues from this template. Null until intake is enabled. */
  emailIntakeAddress?: Maybe<Scalars['String']['output']>;
  /** Off by default. Team templates only — a workspace template has no team to file into. */
  emailIntakeEnabled: Scalars['Boolean']['output'];
  id: Scalars['UUID']['output'];
  name: Scalars['String']['output'];
  position: Scalars['String']['output'];
  /** Keys are the same names createIssue takes. */
  properties: Scalars['JSON']['output'];
  /** Children filed with the issue. Empty means the template makes a parent only. */
  subIssues: Array<TemplateSubIssue>;
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

export type LinkGitHubPullRequestInput = {
  body?: InputMaybe<Scalars['String']['input']>;
  branchName?: InputMaybe<Scalars['String']['input']>;
  /** Webhook-shaped flags so the public API can drive the same status automations. */
  draft?: InputMaybe<Scalars['Boolean']['input']>;
  mergeableState?: InputMaybe<Scalars['String']['input']>;
  merged?: InputMaybe<Scalars['Boolean']['input']>;
  reviewRequested?: InputMaybe<Scalars['Boolean']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
  url: Scalars['String']['input'];
};

export type LinkGitLabMergeRequestInput = {
  body?: InputMaybe<Scalars['String']['input']>;
  branchName?: InputMaybe<Scalars['String']['input']>;
  /** Webhook-shaped flags so the public API can drive the same status automations. */
  draft?: InputMaybe<Scalars['Boolean']['input']>;
  mergeableState?: InputMaybe<Scalars['String']['input']>;
  merged?: InputMaybe<Scalars['Boolean']['input']>;
  reviewRequested?: InputMaybe<Scalars['Boolean']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
  url: Scalars['String']['input'];
};

export type LinkSentryIssueInput = {
  issueId: Scalars['UUID']['input'];
  title?: InputMaybe<Scalars['String']['input']>;
  url: Scalars['String']['input'];
};

export type MoveFavoriteInput = {
  afterFavoriteId?: InputMaybe<Scalars['UUID']['input']>;
  /** Lift it to the sidebar root. */
  clearFolder?: InputMaybe<Scalars['Boolean']['input']>;
  /** The folder to sit in. Ignored when clearFolder is set. */
  folderId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
};

export type Mutation = {
  acceptTriageIssue: IssuePayload;
  addFavorite: FavoritePayload;
  addInitiativeLabel: InitiativeLabelLinkPayload;
  addInitiativeProject: InitiativeProjectPayload;
  addInitiativeRelation: InitiativeRelationPayload;
  /**
   * Adds one label. Not "set the labels": a whole-set write means two people adding
   * different labels a second apart produce one winner and one silently lost edit.
   */
  addIssueLabel: IssueLabelPayload;
  addProjectDependency: ProjectDependencyPayload;
  addProjectLabel: ProjectLabelLinkPayload;
  addProjectMember: ProjectMemberPayload;
  addProjectTeam: ProjectTeamPayload;
  /** Add your own emoji to a comment. Adding one you already added is a no-op that succeeds. */
  addReaction: ReactionPayload;
  addTeamMember: TeamMembershipPayload;
  archiveAskForm: DeletePayload;
  archiveCustomer: DeletePayload;
  archiveCycle: DeletePayload;
  archiveDashboard: DeletePayload;
  archiveDocument: DeletePayload;
  archiveFormTemplate: DeletePayload;
  archiveInitiative: DeletePayload;
  archiveInitiativeLabel: DeletePayload;
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
  archiveProjectLabel: DeletePayload;
  archiveProjectStatus: DeletePayload;
  archiveProjectTemplate: DeletePayload;
  /** Retires a schedule, or brings one back. Does not archive the issues it already minted. */
  archiveRecurringIssue: DeletePayload;
  /**
   * Retires a status, or brings one back. `archived: false` is the way back; without it the
   * only way to undo a mistaken archive is to create a new status, which is a different row
   * that no filter or saved view already points at.
   */
  archiveWorkflowState: DeletePayload;
  bulkUpdateIssues: BulkIssuePayload;
  clearIssueSla: IssuePayload;
  /** Returns the token exactly once. It is not recoverable afterwards. */
  createApiKey: ApiKeyPayload;
  createAskForm: AskFormPayload;
  createAttachment: AttachmentPayload;
  createComment: CommentPayload;
  createCustomer: CustomerPayload;
  createCustomerRequest: CustomerRequestPayload;
  createDashboard: DashboardPayload;
  createDashboardTile: DashboardTilePayload;
  createDocument: DocumentPayload;
  createDraft: DraftPayload;
  createFavoriteFolder: FavoritePayload;
  createFormTemplate: FormTemplatePayload;
  createFormTemplateField: FormTemplateFieldPayload;
  createGitHubConnection: GitHubConnectionPayload;
  createGitHubUserLink: GitHubUserLinkPayload;
  createGitLabConnection: GitLabConnectionPayload;
  createGitLabUserLink: GitLabUserLinkPayload;
  createInitiative: InitiativePayload;
  createInitiativeLabel: InitiativeLabelPayload;
  createInitiativeUpdate: InitiativeUpdatePayload;
  createIssue: IssuePayload;
  createIssueRelation: IssueRelationPayload;
  createIssueTemplate: IssueTemplatePayload;
  createLabel: LabelPayload;
  /** Consent: issues an authorization code and returns the redirect the browser should follow. */
  createOauthAuthorization: OauthAuthorizationPayload;
  /** Returns the client secret exactly once. */
  createOauthClient: OauthClientCreatePayload;
  createProject: ProjectPayload;
  createProjectLabel: ProjectLabelPayload;
  createProjectMilestone: ProjectMilestonePayload;
  createProjectStatus: ProjectStatusPayload;
  createProjectTemplate: ProjectTemplatePayload;
  createProjectTemplateIssue: ProjectTemplateIssuePayload;
  createProjectTemplateMilestone: ProjectTemplateMilestonePayload;
  createProjectUpdate: ProjectUpdatePayload;
  createPulseFeed: PulseFeedPayload;
  createRecurringIssue: RecurringIssuePayload;
  createSentryConnection: SentryConnectionPayload;
  createSlaRule: SlaRulePayload;
  createSlackConnection: SlackConnectionPayload;
  createTeam: TeamPayload;
  createView: ViewPayload;
  /** Returns the signing secret exactly once. */
  createWebhook: WebhookCreatePayload;
  createWorkflowState: WorkflowStatePayload;
  declineTriageIssue: IssuePayload;
  deleteAskForm: DeletePayload;
  deleteAttachment: DeletePayload;
  deleteComment: DeletePayload;
  deleteCustomer: DeletePayload;
  deleteCustomerRequest: DeletePayload;
  deleteCustomerSubscription: DeletePayload;
  deleteDashboard: DeletePayload;
  deleteDashboardTile: DeletePayload;
  deleteDocument: DeletePayload;
  deleteDraft: DeletePayload;
  deleteFormTemplateField: DeletePayload;
  deleteGitHubConnection: DeletePayload;
  deleteGitHubTeamAutomation: GitHubTeamAutomationPayload;
  deleteGitHubUserLink: DeletePayload;
  deleteGitLabConnection: DeletePayload;
  deleteGitLabTeamAutomation: GitLabTeamAutomationPayload;
  deleteGitLabUserLink: DeletePayload;
  deleteInitiative: DeletePayload;
  deleteInitiativeSubscription: DeletePayload;
  deleteInitiativeUpdate: DeletePayload;
  deleteIssue: DeletePayload;
  deleteIssueRelation: DeletePayload;
  deleteNotification: DeletePayload;
  deleteOauthClient: DeletePayload;
  deleteProject: DeletePayload;
  deleteProjectMilestone: DeletePayload;
  deleteProjectSubscription: DeletePayload;
  deleteProjectTemplateIssue: DeletePayload;
  deleteProjectTemplateMilestone: DeletePayload;
  deleteProjectUpdate: DeletePayload;
  deletePulseFeed: DeletePayload;
  deleteSentryConnection: DeletePayload;
  deleteSlaRule: DeletePayload;
  deleteSlackConnection: DeletePayload;
  /** Soft-deletes a team and its issues. Restorable within 30 days. */
  deleteTeam: DeletePayload;
  deleteView: DeletePayload;
  deleteViewSubscription: DeletePayload;
  deleteWebhook: DeletePayload;
  /** Mint (or return) a personal ICS feed for this team's cycles. */
  ensureCycleCalendarFeed: CycleCalendarFeedPayload;
  inviteToWorkspace: InvitePayload;
  /**
   * Leave this workspace. The last owner cannot: somebody has to remain who can invite,
   * change a role, or manage billing. Work stays attributed. Returns the caller's user id.
   */
  leaveWorkspace: DeletePayload;
  linkGitHubPullRequest: GitHubLinkPayload;
  linkGitLabMergeRequest: GitLabLinkPayload;
  linkSentryIssue: SentryLinkPayload;
  markAllNotificationsRead: NotificationsPayload;
  /** The issue being viewed is the duplicate; canonicalId is the one it duplicates. */
  markIssueDuplicate: IssuePayload;
  markNotificationRead: NotificationPayload;
  /** Folds source into the survivor: domains and requests move, source is archived. */
  mergeCustomers: CustomerPayload;
  /**
   * Fold one label into another. Applications of the source move onto the survivor;
   * the source is then archived. Same scope, same group (or both ungrouped); neither
   * may be a group.
   */
  mergeLabels: LabelPayload;
  /**
   * Move a favourite into a folder, out of one, or along the sidebar. `clearFolder`
   * lifts it to the root; `folderId` puts it in that folder. Neither leaves it where it is.
   */
  moveFavorite: FavoritePayload;
  /** Nest under a parent, or pass null to make a top-level team. */
  moveTeam: TeamPayload;
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
  removeInitiativeLabel: DeletePayload;
  removeInitiativeProject: DeletePayload;
  removeInitiativeRelation: DeletePayload;
  removeIssueLabel: DeletePayload;
  removeProjectDependency: DeletePayload;
  removeProjectLabel: DeletePayload;
  removeProjectMember: DeletePayload;
  removeProjectTeam: DeletePayload;
  /**
   * Remove your own emoji from a comment. You may only remove your own, admins included: a
   * reaction is a signature, and an admin who can delete the comment deletes them with it.
   *
   * Removing one that is not there succeeds with `version` 0 and the nil id.
   */
  removeReaction: DeletePayload;
  removeTeamMember: DeletePayload;
  removeUser: DeletePayload;
  resolveComment: CommentPayload;
  /** Restores a soft-deleted issue with its comments and relations, within the window. */
  restoreIssue: IssuePayload;
  restoreProject: ProjectPayload;
  /** Restores a soft-deleted team and its issues, within the window. */
  restoreTeam: TeamPayload;
  /** Freezes a team: read-only issues and settings, hidden from sidebars. Restorable any time. */
  retireTeam: TeamPayload;
  /** Revoke one of the caller's own sessions. Revoking this device signs it out on the next refresh. */
  revokeAccountSession: DeletePayload;
  revokeApiKey: DeletePayload;
  /**
   * Revoke every live token this person granted to one application in this workspace.
   * A foreign or already-revoked id is not-found. Returns the application id.
   */
  revokeAuthorisedOauthApp: DeletePayload;
  revokeInvite: DeletePayload;
  /** Revoke every other live session, keeping the one making this request. Returns that session's id. */
  revokeOtherSessions: DeletePayload;
  /** Replace the personal ICS token. The previous feed URL stops working. */
  rotateCycleCalendarFeed: CycleCalendarFeedPayload;
  rotateOauthClientSecret: OauthClientSecretPayload;
  setCustomerSubscription: CustomerSubscriptionPayload;
  setInitiativeSubscription: InitiativeSubscriptionPayload;
  setIssueSla: IssuePayload;
  setIssueSubscription: SubscriptionPayload;
  /**
   * Subscribe to a project, or change which events fire. Passing every flag false is an
   * unsubscribe. The row is personal: only the caller can write their own.
   */
  setProjectSubscription: ProjectSubscriptionPayload;
  setUserRole: UserPayload;
  setViewPreference: ViewPreferencePayload;
  /**
   * Subscribe to a saved view, or change which events fire. Passing added and completed
   * both false is an unsubscribe. The row is personal: only the caller can write their own.
   */
  setViewSubscription: ViewSubscriptionPayload;
  snoozeIssue: IssuePayload;
  snoozeNotification: NotificationPayload;
  /** Pull the next upcoming cycle forward to midnight today in the team's timezone. Irreversible. */
  startCycleToday: CyclePayload;
  /** Propose a third-party integration for this workspace's directory. */
  submitIntegration: IntegrationSubmissionPayload;
  suspendUser: UserPayload;
  /** Brings a retired team back to active use. */
  unretireTeam: TeamPayload;
  updateAskForm: AskFormPayload;
  updateAttachment: AttachmentPayload;
  updateComment: CommentPayload;
  updateCustomer: CustomerPayload;
  updateCustomerRequest: CustomerRequestPayload;
  updateCycle: CyclePayload;
  updateDashboard: DashboardPayload;
  updateDashboardTile: DashboardTilePayload;
  updateDocument: DocumentPayload;
  updateDraft: DraftPayload;
  updateFavoriteFolder: FavoritePayload;
  updateFormTemplate: FormTemplatePayload;
  updateFormTemplateField: FormTemplateFieldPayload;
  updateGitHubConnection: GitHubConnectionPayload;
  updateGitHubTeamAutomation: GitHubTeamAutomationPayload;
  updateGitLabConnection: GitLabConnectionPayload;
  updateGitLabTeamAutomation: GitLabTeamAutomationPayload;
  updateInitiative: InitiativePayload;
  updateInitiativeLabel: InitiativeLabelPayload;
  updateInitiativeUpdate: InitiativeUpdatePayload;
  updateIssue: IssuePayload;
  updateIssueTemplate: IssueTemplatePayload;
  updateIssueTemplateEmailIntake: IssueTemplatePayload;
  updateLabel: LabelPayload;
  updateNotificationPrefs: UserPayload;
  updateOauthClient: OauthClientPayload;
  updateProfile: UserPayload;
  updateProject: ProjectPayload;
  updateProjectLabel: ProjectLabelPayload;
  updateProjectMilestone: ProjectMilestonePayload;
  updateProjectStatus: ProjectStatusPayload;
  updateProjectTemplate: ProjectTemplatePayload;
  updateProjectTemplateIssue: ProjectTemplateIssuePayload;
  updateProjectTemplateMilestone: ProjectTemplateMilestonePayload;
  updateProjectUpdate: ProjectUpdatePayload;
  updatePulseFeed: PulseFeedPayload;
  updateRecurringIssue: RecurringIssuePayload;
  updateSentryConnection: SentryConnectionPayload;
  updateSlaRule: SlaRulePayload;
  updateSlackConnection: SlackConnectionPayload;
  updateTeam: TeamPayload;
  updateTeamArchive: TeamPayload;
  updateTeamCycles: TeamPayload;
  updateTeamEmailIntake: TeamPayload;
  updateTeamEstimates: TeamPayload;
  updateTeamTemplates: TeamPayload;
  updateTeamTriage: TeamPayload;
  updateView: ViewPayload;
  updateWebhook: WebhookPayload;
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


export type MutationAddInitiativeLabelArgs = {
  initiativeId: Scalars['UUID']['input'];
  labelId: Scalars['UUID']['input'];
};


export type MutationAddInitiativeProjectArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  initiativeId: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
  projectId: Scalars['UUID']['input'];
};


export type MutationAddInitiativeRelationArgs = {
  childInitiativeId: Scalars['UUID']['input'];
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  opId?: InputMaybe<Scalars['UUID']['input']>;
  parentInitiativeId: Scalars['UUID']['input'];
};


export type MutationAddIssueLabelArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  issueId: Scalars['UUID']['input'];
  labelId: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationAddProjectDependencyArgs = {
  blockedProjectId: Scalars['UUID']['input'];
  blockingProjectId: Scalars['UUID']['input'];
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationAddProjectLabelArgs = {
  labelId: Scalars['UUID']['input'];
  projectId: Scalars['UUID']['input'];
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


export type MutationAddReactionArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  commentId: Scalars['UUID']['input'];
  emoji: Scalars['String']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationAddTeamMemberArgs = {
  role?: InputMaybe<TeamRole>;
  teamId: Scalars['UUID']['input'];
  userId: Scalars['UUID']['input'];
};


export type MutationArchiveAskFormArgs = {
  archived: Scalars['Boolean']['input'];
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationArchiveCustomerArgs = {
  archived: Scalars['Boolean']['input'];
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationArchiveCycleArgs = {
  archived: Scalars['Boolean']['input'];
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationArchiveDashboardArgs = {
  archived: Scalars['Boolean']['input'];
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationArchiveDocumentArgs = {
  archived: Scalars['Boolean']['input'];
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationArchiveFormTemplateArgs = {
  archived: Scalars['Boolean']['input'];
  id: Scalars['UUID']['input'];
};


export type MutationArchiveInitiativeArgs = {
  archived: Scalars['Boolean']['input'];
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationArchiveInitiativeLabelArgs = {
  archived: Scalars['Boolean']['input'];
  id: Scalars['UUID']['input'];
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


export type MutationArchiveProjectLabelArgs = {
  archived: Scalars['Boolean']['input'];
  id: Scalars['UUID']['input'];
};


export type MutationArchiveProjectStatusArgs = {
  archived: Scalars['Boolean']['input'];
  id: Scalars['UUID']['input'];
};


export type MutationArchiveProjectTemplateArgs = {
  archived: Scalars['Boolean']['input'];
  id: Scalars['UUID']['input'];
};


export type MutationArchiveRecurringIssueArgs = {
  archived: Scalars['Boolean']['input'];
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
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


export type MutationClearIssueSlaArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  issueId: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateApiKeyArgs = {
  input: CreateApiKeyInput;
};


export type MutationCreateAskFormArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateAskFormInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateAttachmentArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateAttachmentInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateCommentArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateCommentInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateCustomerArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateCustomerInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateCustomerRequestArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateCustomerRequestInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateDashboardArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateDashboardInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateDashboardTileArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateDashboardTileInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateDocumentArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateDocumentInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateDraftArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateDraftInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateFavoriteFolderArgs = {
  afterFavoriteId?: InputMaybe<Scalars['UUID']['input']>;
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  name: Scalars['String']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateFormTemplateArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateFormTemplateInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateFormTemplateFieldArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateFormTemplateFieldInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateGitHubConnectionArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateGitHubConnectionInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateGitHubUserLinkArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateGitHubUserLinkInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateGitLabConnectionArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateGitLabConnectionInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateGitLabUserLinkArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateGitLabUserLinkInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateInitiativeArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateInitiativeInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateInitiativeLabelArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateInitiativeLabelInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateInitiativeUpdateArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateInitiativeUpdateInput;
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
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateIssueTemplateInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateLabelArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateLabelInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateOauthAuthorizationArgs = {
  input: CreateOauthAuthorizationInput;
};


export type MutationCreateOauthClientArgs = {
  input: CreateOauthClientInput;
};


export type MutationCreateProjectArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateProjectInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateProjectLabelArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateProjectLabelInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateProjectMilestoneArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateProjectMilestoneInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateProjectStatusArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateProjectStatusInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateProjectTemplateArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateProjectTemplateInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateProjectTemplateIssueArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateProjectTemplateIssueInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateProjectTemplateMilestoneArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateProjectTemplateMilestoneInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateProjectUpdateArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateProjectUpdateInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreatePulseFeedArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreatePulseFeedInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateRecurringIssueArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateRecurringIssueInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateSentryConnectionArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateSentryConnectionInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateSlaRuleArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateSlaRuleInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateSlackConnectionArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateSlackConnectionInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateTeamArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateTeamInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateViewArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateViewInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationCreateWebhookArgs = {
  input: CreateWebhookInput;
};


export type MutationCreateWorkflowStateArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: CreateWorkflowStateInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationDeclineTriageIssueArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationDeleteAskFormArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationDeleteAttachmentArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationDeleteCommentArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationDeleteCustomerArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationDeleteCustomerRequestArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationDeleteCustomerSubscriptionArgs = {
  customerId: Scalars['UUID']['input'];
};


export type MutationDeleteDashboardArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationDeleteDashboardTileArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationDeleteDocumentArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationDeleteDraftArgs = {
  id: Scalars['UUID']['input'];
};


export type MutationDeleteFormTemplateFieldArgs = {
  id: Scalars['UUID']['input'];
};


export type MutationDeleteGitHubTeamAutomationArgs = {
  teamId: Scalars['UUID']['input'];
};


export type MutationDeleteGitLabTeamAutomationArgs = {
  teamId: Scalars['UUID']['input'];
};


export type MutationDeleteInitiativeArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationDeleteInitiativeSubscriptionArgs = {
  initiativeId: Scalars['UUID']['input'];
};


export type MutationDeleteInitiativeUpdateArgs = {
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


export type MutationDeleteOauthClientArgs = {
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


export type MutationDeleteProjectSubscriptionArgs = {
  projectId: Scalars['UUID']['input'];
};


export type MutationDeleteProjectTemplateIssueArgs = {
  id: Scalars['UUID']['input'];
};


export type MutationDeleteProjectTemplateMilestoneArgs = {
  id: Scalars['UUID']['input'];
};


export type MutationDeleteProjectUpdateArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationDeletePulseFeedArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationDeleteSlaRuleArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationDeleteTeamArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationDeleteViewArgs = {
  id: Scalars['UUID']['input'];
};


export type MutationDeleteViewSubscriptionArgs = {
  viewId: Scalars['UUID']['input'];
};


export type MutationDeleteWebhookArgs = {
  id: Scalars['UUID']['input'];
};


export type MutationEnsureCycleCalendarFeedArgs = {
  teamId: Scalars['UUID']['input'];
};


export type MutationInviteToWorkspaceArgs = {
  input: InviteInput;
};


export type MutationLinkGitHubPullRequestArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: LinkGitHubPullRequestInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationLinkGitLabMergeRequestArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: LinkGitLabMergeRequestInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationLinkSentryIssueArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: LinkSentryIssueInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
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


export type MutationMergeCustomersArgs = {
  intoId: Scalars['UUID']['input'];
  sourceId: Scalars['UUID']['input'];
};


export type MutationMergeLabelsArgs = {
  intoId: Scalars['UUID']['input'];
  sourceId: Scalars['UUID']['input'];
};


export type MutationMoveFavoriteArgs = {
  input: MoveFavoriteInput;
};


export type MutationMoveTeamArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  opId?: InputMaybe<Scalars['UUID']['input']>;
  parentTeamId?: InputMaybe<Scalars['UUID']['input']>;
  teamId: Scalars['UUID']['input'];
};


export type MutationPurgeDeletedIssuesArgs = {
  before?: InputMaybe<Scalars['Time']['input']>;
};


export type MutationRemoveFavoriteArgs = {
  kind: FavoriteKind;
  targetId: Scalars['UUID']['input'];
};


export type MutationRemoveInitiativeLabelArgs = {
  initiativeId: Scalars['UUID']['input'];
  labelId: Scalars['UUID']['input'];
};


export type MutationRemoveInitiativeProjectArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  initiativeId: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
  projectId: Scalars['UUID']['input'];
};


export type MutationRemoveInitiativeRelationArgs = {
  childInitiativeId: Scalars['UUID']['input'];
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  opId?: InputMaybe<Scalars['UUID']['input']>;
  parentInitiativeId: Scalars['UUID']['input'];
};


export type MutationRemoveIssueLabelArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  issueId: Scalars['UUID']['input'];
  labelId: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationRemoveProjectDependencyArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationRemoveProjectLabelArgs = {
  labelId: Scalars['UUID']['input'];
  projectId: Scalars['UUID']['input'];
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


export type MutationRemoveReactionArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  commentId: Scalars['UUID']['input'];
  emoji: Scalars['String']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
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


export type MutationRestoreTeamArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationRetireTeamArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationRevokeAccountSessionArgs = {
  id: Scalars['UUID']['input'];
};


export type MutationRevokeApiKeyArgs = {
  id: Scalars['UUID']['input'];
};


export type MutationRevokeAuthorisedOauthAppArgs = {
  id: Scalars['UUID']['input'];
};


export type MutationRevokeInviteArgs = {
  id: Scalars['UUID']['input'];
};


export type MutationRotateCycleCalendarFeedArgs = {
  teamId: Scalars['UUID']['input'];
};


export type MutationRotateOauthClientSecretArgs = {
  id: Scalars['UUID']['input'];
};


export type MutationSetCustomerSubscriptionArgs = {
  input: SetCustomerSubscriptionInput;
};


export type MutationSetInitiativeSubscriptionArgs = {
  input: SetInitiativeSubscriptionInput;
};


export type MutationSetIssueSlaArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: SetIssueSlaInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationSetIssueSubscriptionArgs = {
  issueId: Scalars['UUID']['input'];
  subscribed: Scalars['Boolean']['input'];
};


export type MutationSetProjectSubscriptionArgs = {
  input: SetProjectSubscriptionInput;
};


export type MutationSetUserRoleArgs = {
  role: UserRole;
  userId: Scalars['UUID']['input'];
};


export type MutationSetViewPreferenceArgs = {
  display: Scalars['JSON']['input'];
  viewKey: Scalars['String']['input'];
};


export type MutationSetViewSubscriptionArgs = {
  input: SetViewSubscriptionInput;
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


export type MutationStartCycleTodayArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationSubmitIntegrationArgs = {
  input: SubmitIntegrationInput;
};


export type MutationSuspendUserArgs = {
  suspended: Scalars['Boolean']['input'];
  userId: Scalars['UUID']['input'];
};


export type MutationUnretireTeamArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationUpdateAskFormArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: UpdateAskFormInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationUpdateAttachmentArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: UpdateAttachmentInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationUpdateCommentArgs = {
  body: Scalars['String']['input'];
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationUpdateCustomerArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: UpdateCustomerInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationUpdateCustomerRequestArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: UpdateCustomerRequestInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationUpdateCycleArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: UpdateCycleInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationUpdateDashboardArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: UpdateDashboardInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationUpdateDashboardTileArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: UpdateDashboardTileInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationUpdateDocumentArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: UpdateDocumentInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationUpdateDraftArgs = {
  input: UpdateDraftInput;
};


export type MutationUpdateFavoriteFolderArgs = {
  id: Scalars['UUID']['input'];
  name: Scalars['String']['input'];
};


export type MutationUpdateFormTemplateArgs = {
  input: UpdateFormTemplateInput;
};


export type MutationUpdateFormTemplateFieldArgs = {
  input: UpdateFormTemplateFieldInput;
};


export type MutationUpdateGitHubConnectionArgs = {
  input: UpdateGitHubConnectionInput;
};


export type MutationUpdateGitHubTeamAutomationArgs = {
  input: UpdateGitHubTeamAutomationInput;
};


export type MutationUpdateGitLabConnectionArgs = {
  input: UpdateGitLabConnectionInput;
};


export type MutationUpdateGitLabTeamAutomationArgs = {
  input: UpdateGitLabTeamAutomationInput;
};


export type MutationUpdateInitiativeArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: UpdateInitiativeInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationUpdateInitiativeLabelArgs = {
  input: UpdateInitiativeLabelInput;
};


export type MutationUpdateInitiativeUpdateArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: UpdateInitiativeUpdateInput;
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


export type MutationUpdateIssueTemplateEmailIntakeArgs = {
  input: UpdateIssueTemplateEmailIntakeInput;
};


export type MutationUpdateLabelArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: UpdateLabelInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationUpdateNotificationPrefsArgs = {
  prefs: Scalars['JSON']['input'];
};


export type MutationUpdateOauthClientArgs = {
  input: UpdateOauthClientInput;
};


export type MutationUpdateProfileArgs = {
  input: UpdateProfileInput;
};


export type MutationUpdateProjectArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: UpdateProjectInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationUpdateProjectLabelArgs = {
  input: UpdateProjectLabelInput;
};


export type MutationUpdateProjectMilestoneArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: UpdateProjectMilestoneInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationUpdateProjectStatusArgs = {
  input: UpdateProjectStatusInput;
};


export type MutationUpdateProjectTemplateArgs = {
  input: UpdateProjectTemplateInput;
};


export type MutationUpdateProjectTemplateIssueArgs = {
  input: UpdateProjectTemplateIssueInput;
};


export type MutationUpdateProjectTemplateMilestoneArgs = {
  input: UpdateProjectTemplateMilestoneInput;
};


export type MutationUpdateProjectUpdateArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: UpdateProjectUpdateInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationUpdatePulseFeedArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: UpdatePulseFeedInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationUpdateRecurringIssueArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: UpdateRecurringIssueInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationUpdateSentryConnectionArgs = {
  input: UpdateSentryConnectionInput;
};


export type MutationUpdateSlaRuleArgs = {
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  input: UpdateSlaRuleInput;
  opId?: InputMaybe<Scalars['UUID']['input']>;
};


export type MutationUpdateSlackConnectionArgs = {
  input: UpdateSlackConnectionInput;
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


export type MutationUpdateTeamEmailIntakeArgs = {
  input: UpdateTeamEmailIntakeInput;
};


export type MutationUpdateTeamEstimatesArgs = {
  input: UpdateTeamEstimatesInput;
};


export type MutationUpdateTeamTemplatesArgs = {
  input: UpdateTeamTemplatesInput;
};


export type MutationUpdateTeamTriageArgs = {
  input: UpdateTeamTriageInput;
};


export type MutationUpdateViewArgs = {
  input: UpdateViewInput;
};


export type MutationUpdateWebhookArgs = {
  input: UpdateWebhookInput;
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
  | 'CUSTOMER_REQUEST_ADDED'
  | 'CUSTOMER_REQUEST_COMPLETED'
  | 'CUSTOMER_REQUEST_IMPORTANT'
  | 'INITIATIVE_ISSUE_ADDED'
  | 'INITIATIVE_ISSUE_COMPLETED'
  | 'INITIATIVE_UPDATE'
  | 'ISSUE_ASSIGNED'
  | 'ISSUE_BLOCKED'
  | 'ISSUE_DUE'
  | 'ISSUE_PRIORITY_RAISED'
  | 'ISSUE_STATUS_CHANGED'
  | 'MENTION'
  | 'PROJECT_ISSUE_ADDED'
  | 'PROJECT_ISSUE_COMPLETED'
  | 'PROJECT_UPDATE'
  | 'PULSE_DIGEST'
  | 'SUB_ISSUE_COMPLETED'
  | 'VIEW_ISSUE_ADDED'
  | 'VIEW_ISSUE_COMPLETED';

/** Marking a whole inbox read is one mutation, not one per row — which is also what stops it minting one sync version per notification. */
export type NotificationsPayload = MutationResult & {
  notifications: Array<Notification>;
  version: Scalars['Int']['output'];
};

export type OauthAuthorizationPayload = {
  /** The registered redirect URI with code and state appended. The client navigates here. */
  redirectUri: Scalars['String']['output'];
};

/**
 * A third-party OAuth application owned by this workspace.
 *
 * The client secret is not on this type: it exists in the create/rotate response and as a
 * SHA-256 in the database, and nowhere a listing can see it. Applications are not replicated.
 */
export type OauthClient = {
  allowedScopes: Array<Scalars['String']['output']>;
  archivedAt?: Maybe<Scalars['Time']['output']>;
  clientCredentialsEnabled: Scalars['Boolean']['output'];
  clientId: Scalars['String']['output'];
  createdAt: Scalars['Time']['output'];
  creatorId: Scalars['UUID']['output'];
  description?: Maybe<Scalars['String']['output']>;
  developer?: Maybe<Scalars['String']['output']>;
  developerUrl?: Maybe<Scalars['String']['output']>;
  id: Scalars['UUID']['output'];
  imageUrl?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  publicEnabled: Scalars['Boolean']['output'];
  redirectUris: Array<Scalars['String']['output']>;
  updatedAt: Scalars['Time']['output'];
  webhookUrl?: Maybe<Scalars['String']['output']>;
  workspaceId: Scalars['UUID']['output'];
};

export type OauthClientCreatePayload = MutationResult & {
  created: OauthClientCreated;
  version: Scalars['Int']['output'];
};

export type OauthClientCreated = {
  /** Shown once. Not recoverable — only its SHA-256 is stored. */
  clientSecret: Scalars['String']['output'];
  oauthClient: OauthClient;
};

/** Public metadata for the consent screen. Secret and redirect URIs are never returned. */
export type OauthClientInfo = {
  allowedScopes: Array<Scalars['String']['output']>;
  clientId: Scalars['String']['output'];
  description?: Maybe<Scalars['String']['output']>;
  developer?: Maybe<Scalars['String']['output']>;
  developerUrl?: Maybe<Scalars['String']['output']>;
  imageUrl?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
};

export type OauthClientPayload = MutationResult & {
  oauthClient: OauthClient;
  version: Scalars['Int']['output'];
};

export type OauthClientSecretPayload = MutationResult & {
  clientSecret: Scalars['String']['output'];
  oauthClient: OauthClient;
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
  projectTemplateId?: Maybe<Scalars['UUID']['output']>;
  sortOrder: Scalars['String']['output'];
  startDate?: Maybe<Scalars['String']['output']>;
  startDateGranularity?: Maybe<TimeframeGranularity>;
  status: ProjectStatus;
  statusId: Scalars['UUID']['output'];
  summary?: Maybe<Scalars['String']['output']>;
  targetDate?: Maybe<Scalars['String']['output']>;
  targetDateGranularity?: Maybe<TimeframeGranularity>;
  teams: Array<ProjectTeam>;
  updateReminderHour?: Maybe<Scalars['Int']['output']>;
  updateReminderIntervalDays?: Maybe<Scalars['Int']['output']>;
  updateReminderWeekday?: Maybe<Scalars['Int']['output']>;
  /** Workspace default, custom cadence, or never expect updates. */
  updateSchedule: ProjectUpdateSchedule;
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

/** An end→start dependency: the blocking project must finish before the blocked may start. */
export type ProjectDependency = {
  blockedProject?: Maybe<Project>;
  blockedProjectId: Scalars['UUID']['output'];
  blockingProject?: Maybe<Project>;
  blockingProjectId: Scalars['UUID']['output'];
  createdAt: Scalars['Time']['output'];
  id: Scalars['UUID']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type ProjectDependencyPayload = MutationResult & {
  projectDependency: ProjectDependency;
  version: Scalars['Int']['output'];
};

/** Workspace taxonomy for labelling projects — separate from issue labels. */
export type ProjectLabel = {
  archivedAt?: Maybe<Scalars['Time']['output']>;
  color: Scalars['String']['output'];
  createdAt: Scalars['Time']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['UUID']['output'];
  isGroup: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  parentId?: Maybe<Scalars['UUID']['output']>;
  position: Scalars['String']['output'];
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

/** One project label applied to one project. */
export type ProjectLabelLink = {
  createdAt: Scalars['Time']['output'];
  createdBy?: Maybe<Scalars['UUID']['output']>;
  groupId?: Maybe<Scalars['UUID']['output']>;
  id: Scalars['UUID']['output'];
  labelId: Scalars['UUID']['output'];
  projectId: Scalars['UUID']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type ProjectLabelLinkPayload = MutationResult & {
  projectLabelLink: ProjectLabelLink;
  version: Scalars['Int']['output'];
};

export type ProjectLabelPayload = MutationResult & {
  projectLabel: ProjectLabel;
  version: Scalars['Int']['output'];
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

/**
 * Personal watch on a project. Slack-channel subscriptions are a different row of this
 * type: they need a Slack install. Self-triggered changes do not notify — that rule is
 * the fan-out's, not a column here.
 */
export type ProjectSubscription = {
  createdAt: Scalars['Time']['output'];
  id: Scalars['UUID']['output'];
  /** Notify when a newly created issue is in the project. */
  issuesAdded: Scalars['Boolean']['output'];
  /** Notify when an issue in the project is completed or canceled. */
  issuesCompleted: Scalars['Boolean']['output'];
  projectId: Scalars['UUID']['output'];
  updatedAt: Scalars['Time']['output'];
  /** Notify when a new project update is posted. */
  updates: Scalars['Boolean']['output'];
  userId: Scalars['UUID']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type ProjectSubscriptionPayload = MutationResult & {
  projectSubscription: ProjectSubscription;
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

/** Prefilled project with milestones and starter issues. Workspace or team scoped. */
export type ProjectTemplate = {
  archivedAt?: Maybe<Scalars['Time']['output']>;
  body: Scalars['String']['output'];
  createdAt: Scalars['Time']['output'];
  createdBy?: Maybe<Scalars['UUID']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['UUID']['output'];
  name: Scalars['String']['output'];
  position: Scalars['String']['output'];
  /** Keys match createProject: statusId, priority, leadId, color, icon, teamIds, memberIds, dates, initiativeIds. */
  properties: Scalars['JSON']['output'];
  summary: Scalars['String']['output'];
  /** Null means the template is offered in every team. */
  teamId?: Maybe<Scalars['UUID']['output']>;
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type ProjectTemplateIssue = {
  createdAt: Scalars['Time']['output'];
  description: Scalars['String']['output'];
  id: Scalars['UUID']['output'];
  parentId?: Maybe<Scalars['UUID']['output']>;
  projectTemplateId: Scalars['UUID']['output'];
  /** Keys match createIssue property names, plus teamId and templateId. */
  properties: Scalars['JSON']['output'];
  sortOrder: Scalars['String']['output'];
  title: Scalars['String']['output'];
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type ProjectTemplateIssuePayload = MutationResult & {
  issue: ProjectTemplateIssue;
  version: Scalars['Int']['output'];
};

export type ProjectTemplateMilestone = {
  createdAt: Scalars['Time']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['UUID']['output'];
  name: Scalars['String']['output'];
  projectTemplateId: Scalars['UUID']['output'];
  sortOrder: Scalars['String']['output'];
  targetDate?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type ProjectTemplateMilestonePayload = MutationResult & {
  milestone: ProjectTemplateMilestone;
  version: Scalars['Int']['output'];
};

export type ProjectTemplatePayload = MutationResult & {
  template: ProjectTemplate;
  version: Scalars['Int']['output'];
};

/** A status post on a project — health plus narrative markdown. */
export type ProjectUpdate = {
  author?: Maybe<User>;
  authorId: Scalars['UUID']['output'];
  body: Scalars['String']['output'];
  createdAt: Scalars['Time']['output'];
  deletedAt?: Maybe<Scalars['Time']['output']>;
  editedAt?: Maybe<Scalars['Time']['output']>;
  health: ProjectUpdateHealth;
  id: Scalars['UUID']['output'];
  project?: Maybe<Project>;
  projectId: Scalars['UUID']['output'];
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type ProjectUpdateHealth =
  | 'AT_RISK'
  | 'OFF_TRACK'
  | 'ON_TRACK';

export type ProjectUpdatePayload = MutationResult & {
  projectUpdate: ProjectUpdate;
  version: Scalars['Int']['output'];
};

export type ProjectUpdateSchedule =
  | 'custom'
  | 'default'
  | 'never';

/** How often Pulse writes a morning inbox summary of project updates. */
export type PulseDigestCadence =
  | 'DAILY'
  | 'OFF'
  | 'WEEKLY';

/**
 * One person's named Pulse feed. A subset of project updates, scoped to the owner
 * the way an inbox row is. Popular is replica-derived and is not a row here.
 */
export type PulseFeed = {
  createdAt: Scalars['Time']['output'];
  id: Scalars['UUID']['output'];
  name: Scalars['String']['output'];
  projectIds: Array<Scalars['UUID']['output']>;
  updatedAt: Scalars['Time']['output'];
  userId: Scalars['UUID']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type PulseFeedPayload = MutationResult & {
  pulseFeed: PulseFeed;
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
  /** The caller's own live sessions. Never anybody else's, and never the tokens. */
  accountSessions: Array<AccountSession>;
  /** The caller's own keys. Never anybody else's, and never the tokens. */
  apiKeys: Array<ApiKey>;
  archivedCycles: Array<Cycle>;
  /** Archived issues, cycles and projects for one team. Loaded on demand, never replicated. */
  archivedIssues: Array<Issue>;
  archivedProjects: Array<Project>;
  /** Every live attachment in this workspace that carries this exact URL. */
  attachmentsForURL: Array<Attachment>;
  /**
   * The workspace's audit log, newest first. Admins only, and an Enterprise feature: on a
   * plan without it this refuses with PLAN_LIMIT rather than returning an empty list.
   *
   * `after` is the id of the last entry you already have — pass it to get the next page.
   * Keyset rather than offset: the table is appended to while somebody reads it, and an
   * offset would silently repeat and skip rows on the one screen where that is unacceptable.
   */
  auditLog: Array<AuditLogEntry>;
  /**
   * Third-party applications this person has authorised in this workspace. Never anybody
   * else's, and never the tokens.
   */
  authorisedOauthApps: Array<AuthorisedOauthApp>;
  comments: Array<Comment>;
  customer?: Maybe<Customer>;
  customerRequest?: Maybe<CustomerRequest>;
  customers: Array<Customer>;
  cycle?: Maybe<Cycle>;
  /** The viewer's ICS subscription for this team, if they have minted one. Token is on cycleCalendarFeedURL. */
  cycleCalendarFeed?: Maybe<CycleCalendarFeed>;
  /** The HTTPS feed URL for this team's cycle calendar. Null until ensureCycleCalendarFeed has run. */
  cycleCalendarFeedURL?: Maybe<CycleCalendarFeedUrl>;
  cycles: Array<Cycle>;
  /**
   * Issues deleted within the restore window, so a mistaken delete is recoverable without a
   * support ticket.
   */
  deletedIssues: Array<Issue>;
  /**
   * Teams deleted within the restore window. Loaded on demand, never replicated — the sync
   * stream carries a delete for a removed team rather than the row.
   */
  deletedTeams: Array<Team>;
  document?: Maybe<Document>;
  /**
   * The caller's saved drafts. Local composer restore never appears here — only drafts
   * saved across devices, still inside the six-month window.
   */
  drafts: Array<Draft>;
  favorites: Array<Favorite>;
  formTemplate?: Maybe<FormTemplate>;
  formTemplateFields: Array<FormTemplateField>;
  formTemplates: Array<FormTemplate>;
  /** Admin-only. The URL and secret to paste into GitHub for commit linking. */
  githubCommitWebhook?: Maybe<GitHubCommitWebhook>;
  /** The workspace GitHub install, if any. Secrets are on githubCommitWebhook, not here. */
  githubConnection?: Maybe<GitHubConnection>;
  /** Whether this install has GitHub OAuth app credentials in its environment. */
  githubOAuthConfigured: Scalars['Boolean']['output'];
  /** Per-team GitHub PR status automations. Unconfigured teams use the product defaults. */
  githubTeamAutomation: GitHubTeamAutomation;
  /** The caller's linked GitHub account, if they have connected one. */
  githubUserLink?: Maybe<GitHubUserLink>;
  /** The workspace GitLab instance, if any. Secrets are on gitlabWebhook, not here. */
  gitlabConnection?: Maybe<GitLabConnection>;
  /** Per-team GitLab MR status automations. Unconfigured teams use the product defaults. */
  gitlabTeamAutomation: GitLabTeamAutomation;
  /** The caller's linked GitLab account, if they have connected one. */
  gitlabUserLink?: Maybe<GitLabUserLink>;
  /** Admin-only. The URL and token to paste into GitLab as a Group or Project webhook. */
  gitlabWebhook?: Maybe<GitLabWebhook>;
  initiative?: Maybe<Initiative>;
  initiativeLabel?: Maybe<InitiativeLabel>;
  initiativeLabels: Array<InitiativeLabel>;
  initiativeUpdate?: Maybe<InitiativeUpdate>;
  initiativeUpdates: Array<InitiativeUpdate>;
  initiatives: Array<Initiative>;
  /** Proposals to list a third-party integration. Members; not replicated. */
  integrationSubmissions: Array<IntegrationSubmission>;
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
  oauthClient?: Maybe<OauthClient>;
  /** Public metadata for the consent screen. Any signed-in member may read it. */
  oauthClientInfo: OauthClientInfo;
  /** OAuth applications this workspace owns. Admins only; the secret is never returned. */
  oauthClients: Array<OauthClient>;
  project?: Maybe<Project>;
  projectDependenciesBlockedBy: Array<ProjectDependency>;
  projectDependenciesBlocking: Array<ProjectDependency>;
  projectLabel?: Maybe<ProjectLabel>;
  /** Every project label in the workspace. */
  projectLabels: Array<ProjectLabel>;
  projectStatuses: Array<ProjectStatus>;
  projectTemplate?: Maybe<ProjectTemplate>;
  projectTemplateIssues: Array<ProjectTemplateIssue>;
  projectTemplateMilestones: Array<ProjectTemplateMilestone>;
  projectTemplates: Array<ProjectTemplate>;
  projectUpdate?: Maybe<ProjectUpdate>;
  projectUpdates: Array<ProjectUpdate>;
  projects: Array<Project>;
  recurringIssue?: Maybe<RecurringIssue>;
  recurringIssues: Array<RecurringIssue>;
  search: SearchResults;
  /** The workspace Sentry install, if any. Secrets are on sentryWebhook, not here. */
  sentryConnection?: Maybe<SentryConnection>;
  /** Admin-only. The URL and secret to paste into a Sentry alert webhook or internal integration. */
  sentryWebhook?: Maybe<SentryWebhook>;
  slaRule?: Maybe<SlaRule>;
  slaRules: Array<SlaRule>;
  /** The workspace Slack install, if any. Credentials are on slackInbound, not here. */
  slackConnection?: Maybe<SlackConnection>;
  /** Admin-only. Inbound Slack URLs and whether env credentials / a webhook URL are set. */
  slackInbound?: Maybe<SlackInbound>;
  team?: Maybe<Team>;
  teamByKey?: Maybe<Team>;
  teams: Array<Team>;
  unreadNotificationCount: Scalars['Int']['output'];
  user?: Maybe<User>;
  /**
   * The workspace directory. A guest receives only their own row: the directory is
   * workspace-scoped and the sync bootstrap does not hand it to guests either.
   */
  users: Array<User>;
  view?: Maybe<View>;
  viewPreferences: Array<ViewPreference>;
  /** Everything the client needs to render its shell. */
  viewer: Viewer;
  /** Saved views the caller can see: shared ones in scope, plus their own private ones. */
  views: Array<View>;
  webhookDeliveries: Array<WebhookDelivery>;
  /** Workspace webhooks. Admins only; the signing secret is never returned. */
  webhooks: Array<Webhook>;
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


export type QueryAttachmentsForUrlArgs = {
  url: Scalars['String']['input'];
};


export type QueryAuditLogArgs = {
  after?: InputMaybe<Scalars['UUID']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryCommentsArgs = {
  issueId: Scalars['UUID']['input'];
};


export type QueryCustomerArgs = {
  id: Scalars['UUID']['input'];
};


export type QueryCustomerRequestArgs = {
  id: Scalars['UUID']['input'];
};


export type QueryCycleArgs = {
  id: Scalars['UUID']['input'];
};


export type QueryCycleCalendarFeedArgs = {
  teamId: Scalars['UUID']['input'];
};


export type QueryCycleCalendarFeedUrlArgs = {
  teamId: Scalars['UUID']['input'];
};


export type QueryCyclesArgs = {
  teamId: Scalars['UUID']['input'];
};


export type QueryDocumentArgs = {
  id: Scalars['UUID']['input'];
};


export type QueryFormTemplateArgs = {
  id: Scalars['UUID']['input'];
};


export type QueryFormTemplateFieldsArgs = {
  formTemplateId: Scalars['UUID']['input'];
};


export type QueryFormTemplatesArgs = {
  teamId?: InputMaybe<Scalars['UUID']['input']>;
};


export type QueryGithubTeamAutomationArgs = {
  teamId: Scalars['UUID']['input'];
};


export type QueryGitlabTeamAutomationArgs = {
  teamId: Scalars['UUID']['input'];
};


export type QueryInitiativeArgs = {
  id: Scalars['UUID']['input'];
};


export type QueryInitiativeLabelArgs = {
  id: Scalars['UUID']['input'];
};


export type QueryInitiativeUpdateArgs = {
  id: Scalars['UUID']['input'];
};


export type QueryInitiativeUpdatesArgs = {
  initiativeId: Scalars['UUID']['input'];
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


export type QueryOauthClientArgs = {
  id: Scalars['UUID']['input'];
};


export type QueryOauthClientInfoArgs = {
  clientId: Scalars['String']['input'];
};


export type QueryProjectArgs = {
  id: Scalars['UUID']['input'];
};


export type QueryProjectDependenciesBlockedByArgs = {
  projectId: Scalars['UUID']['input'];
};


export type QueryProjectDependenciesBlockingArgs = {
  projectId: Scalars['UUID']['input'];
};


export type QueryProjectLabelArgs = {
  id: Scalars['UUID']['input'];
};


export type QueryProjectTemplateArgs = {
  id: Scalars['UUID']['input'];
};


export type QueryProjectTemplateIssuesArgs = {
  projectTemplateId: Scalars['UUID']['input'];
};


export type QueryProjectTemplateMilestonesArgs = {
  projectTemplateId: Scalars['UUID']['input'];
};


export type QueryProjectTemplatesArgs = {
  teamId?: InputMaybe<Scalars['UUID']['input']>;
};


export type QueryProjectUpdateArgs = {
  id: Scalars['UUID']['input'];
};


export type QueryProjectUpdatesArgs = {
  projectId: Scalars['UUID']['input'];
};


export type QueryRecurringIssueArgs = {
  id: Scalars['UUID']['input'];
};


export type QueryRecurringIssuesArgs = {
  teamId: Scalars['UUID']['input'];
};


export type QuerySearchArgs = {
  input: SearchInput;
};


export type QuerySlaRuleArgs = {
  id: Scalars['UUID']['input'];
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


export type QueryWebhookDeliveriesArgs = {
  first?: InputMaybe<Scalars['Int']['input']>;
  webhookId: Scalars['UUID']['input'];
};


export type QueryWorkflowStatesArgs = {
  teamId: Scalars['UUID']['input'];
};

/**
 * One person's emoji on one comment.
 *
 * The smallest entity in the product: no body, no edit, no soft delete. Adding is an insert
 * and removing is a delete, so there is nothing to reconcile and no updatedAt to carry.
 */
export type Reaction = {
  commentId: Scalars['UUID']['output'];
  createdAt: Scalars['Time']['output'];
  /** The character itself, not a shortcode — that is what is rendered and what is compared. */
  emoji: Scalars['String']['output'];
  id: Scalars['UUID']['output'];
  userId: Scalars['UUID']['output'];
  workspaceId: Scalars['UUID']['output'];
};

/**
 * A reaction that was added.
 *
 * `version` is 0 when the reaction was already there: nothing was written, so there is no
 * delta coming and the client should stop holding its optimistic state.
 */
export type ReactionPayload = MutationResult & {
  reaction: Reaction;
  version: Scalars['Int']['output'];
};

export type RecurringCadence =
  | 'BIWEEKLY'
  | 'DAILY'
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'WEEKLY'
  | 'YEARLY';

/**
 * A schedule that mints issues on a cadence.
 *
 * title, body and properties are a snapshot taken when the schedule was created. Editing
 * a source template afterwards does not change them. nextDueDate is the due date of the
 * current occurrence; the next issue is filed after that day has passed, at 00:01 in the
 * team's timezone.
 */
export type RecurringIssue = {
  archivedAt?: Maybe<Scalars['Time']['output']>;
  body: Scalars['String']['output'];
  cadence: RecurringCadence;
  createdAt: Scalars['Time']['output'];
  createdBy?: Maybe<Scalars['UUID']['output']>;
  id: Scalars['UUID']['output'];
  lastCreatedAt?: Maybe<Scalars['Time']['output']>;
  /** Calendar day, `2006-01-02`. The due date of the current occurrence. */
  nextDueDate: Scalars['String']['output'];
  /** Keys are the same names createIssue takes. */
  properties: Scalars['JSON']['output'];
  teamId: Scalars['UUID']['output'];
  /** Provenance only. Null when the schedule was written by hand or converted from an issue. */
  templateId?: Maybe<Scalars['UUID']['output']>;
  title: Scalars['String']['output'];
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type RecurringIssuePayload = MutationResult & {
  recurringIssue: RecurringIssue;
  version: Scalars['Int']['output'];
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
 * Workspace Sentry install. The webhook secret is not on this type: the replica
 * carries the default team a client needs to render settings, and nothing that
 * could be a credential. One Sentry organization per workspace; cloud only.
 */
export type SentryConnection = {
  connectedAt?: Maybe<Scalars['Time']['output']>;
  createdAt: Scalars['Time']['output'];
  creatorId: Scalars['UUID']['output'];
  defaultTeamId: Scalars['UUID']['output'];
  enabled: Scalars['Boolean']['output'];
  id: Scalars['UUID']['output'];
  organizationSlug?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type SentryConnectionPayload = MutationResult & {
  sentryConnection: SentryConnection;
  version: Scalars['Int']['output'];
};

export type SentryLinkPayload = MutationResult & {
  attachment: Attachment;
  issue: Issue;
  version: Scalars['Int']['output'];
};

export type SentryWebhook = {
  secret: Scalars['String']['output'];
  url: Scalars['String']['output'];
};

export type SetCustomerSubscriptionInput = {
  customerId: Scalars['UUID']['input'];
  requestAdded: Scalars['Boolean']['input'];
  requestCompleted: Scalars['Boolean']['input'];
  requestImportant: Scalars['Boolean']['input'];
};

export type SetInitiativeSubscriptionInput = {
  initiativeId: Scalars['UUID']['input'];
  issuesAdded: Scalars['Boolean']['input'];
  issuesCompleted: Scalars['Boolean']['input'];
  updates: Scalars['Boolean']['input'];
};

export type SetIssueSlaInput = {
  durationMinutes: Scalars['Int']['input'];
  issueId: Scalars['UUID']['input'];
};

export type SetProjectSubscriptionInput = {
  issuesAdded: Scalars['Boolean']['input'];
  issuesCompleted: Scalars['Boolean']['input'];
  projectId: Scalars['UUID']['input'];
  updates: Scalars['Boolean']['input'];
};

export type SetViewSubscriptionInput = {
  /** Notify when a newly created issue matches the view. */
  added: Scalars['Boolean']['input'];
  /** Notify when an issue that matches the view is completed or canceled. */
  completed: Scalars['Boolean']['input'];
  viewId: Scalars['UUID']['input'];
};

export type SlaAction =
  | 'APPLY'
  | 'REMOVE';

/**
 * A workspace policy for issue due dates. Rules are ordered by position; first match wins.
 * Applying one sets dueDate and dueDateSource=sla. Removing one clears an SLA-owned date.
 */
export type SlaRule = {
  action: SlaAction;
  createdAt: Scalars['Time']['output'];
  durationMinutes?: Maybe<Scalars['Int']['output']>;
  filter: Scalars['JSON']['output'];
  id: Scalars['UUID']['output'];
  position: Scalars['String']['output'];
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type SlaRulePayload = MutationResult & {
  slaRule: SlaRule;
  version: Scalars['Int']['output'];
};

/**
 * Workspace Slack install. The incoming-webhook URL is not on this type: the replica
 * carries the default team and notify toggles a client needs to render settings.
 * One Slack connection per workspace.
 */
export type SlackConnection = {
  /** When true, `/asks` and a leading 🎫 in Slack file a triage issue. */
  asksEnabled: Scalars['Boolean']['output'];
  channelName?: Maybe<Scalars['String']['output']>;
  connectedAt?: Maybe<Scalars['Time']['output']>;
  createdAt: Scalars['Time']['output'];
  creatorId: Scalars['UUID']['output'];
  defaultTeamId: Scalars['UUID']['output'];
  enabled: Scalars['Boolean']['output'];
  id: Scalars['UUID']['output'];
  notifyComments: Scalars['Boolean']['output'];
  notifyIssues: Scalars['Boolean']['output'];
  updatedAt: Scalars['Time']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type SlackConnectionPayload = MutationResult & {
  slackConnection: SlackConnection;
  version: Scalars['Int']['output'];
};

export type SlackInbound = {
  botTokenConfigured: Scalars['Boolean']['output'];
  commandUrl: Scalars['String']['output'];
  eventsUrl: Scalars['String']['output'];
  signingSecretConfigured: Scalars['Boolean']['output'];
  webhookConfigured: Scalars['Boolean']['output'];
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

export type SubmitIntegrationInput = {
  name: Scalars['String']['input'];
  summary: Scalars['String']['input'];
  website: Scalars['String']['input'];
};

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
  /** Applied to new issues filed by members of this team, when they pick no template. */
  defaultTemplateForMembersId?: Maybe<Scalars['UUID']['output']>;
  /** Applied to new issues filed by everyone else. Form templates (later) may only be this one. */
  defaultTemplateForNonMembersId?: Maybe<Scalars['UUID']['output']>;
  /**
   * When the team was deleted. Only ever set on a row `deletedTeams` returned: the sync stream
   * carries a delete rather than the row, so a client holding a team with this set is holding
   * something it should already have dropped.
   */
  deletedAt?: Maybe<Scalars['Time']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  /** The address that creates issues. Null until intake is enabled. */
  emailIntakeAddress?: Maybe<Scalars['String']['output']>;
  /** Off by default. Turning it on mints a unique intake address for this team. */
  emailIntakeEnabled: Scalars['Boolean']['output'];
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
  recurringIssues: Array<RecurringIssue>;
  retiredAt?: Maybe<Scalars['Time']['output']>;
  states: Array<WorkflowState>;
  /** Direct child teams, in key order. */
  subTeams: Array<Team>;
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

/** A child the template files under the new issue. Titles only — nested templates stay later. */
export type TemplateSubIssue = {
  title: Scalars['String']['output'];
};

export type TemplateSubIssueInput = {
  title: Scalars['String']['input'];
};

export type TimeframeGranularity =
  | 'DAY'
  | 'HALF'
  | 'MONTH'
  | 'QUARTER'
  | 'YEAR';

export type UpdateAskFormInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['UUID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateAttachmentInput = {
  iconUrl?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['UUID']['input'];
  metadata?: InputMaybe<Scalars['JSON']['input']>;
  subtitle?: InputMaybe<Scalars['String']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateCustomerInput = {
  clearOwner?: InputMaybe<Scalars['Boolean']['input']>;
  clearRevenue?: InputMaybe<Scalars['Boolean']['input']>;
  clearSize?: InputMaybe<Scalars['Boolean']['input']>;
  clearTier?: InputMaybe<Scalars['Boolean']['input']>;
  domains?: InputMaybe<Array<Scalars['String']['input']>>;
  id: Scalars['UUID']['input'];
  logoUrl?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  ownerId?: InputMaybe<Scalars['UUID']['input']>;
  revenue?: InputMaybe<Scalars['Int']['input']>;
  size?: InputMaybe<Scalars['Int']['input']>;
  status?: InputMaybe<CustomerStatus>;
  tier?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateCustomerRequestInput = {
  body?: InputMaybe<Scalars['String']['input']>;
  clearCustomer?: InputMaybe<Scalars['Boolean']['input']>;
  customerId?: InputMaybe<Scalars['UUID']['input']>;
  id: Scalars['UUID']['input'];
  important?: InputMaybe<Scalars['Boolean']['input']>;
  issueId?: InputMaybe<Scalars['UUID']['input']>;
  projectId?: InputMaybe<Scalars['UUID']['input']>;
};

export type UpdateCycleInput = {
  clearDescription?: InputMaybe<Scalars['Boolean']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  /** Current and upcoming cycles. Past ends are immutable. */
  endsAt?: InputMaybe<Scalars['Time']['input']>;
  id: Scalars['UUID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  /** Upcoming cycles only. Past and current starts are immutable. */
  startsAt?: InputMaybe<Scalars['Time']['input']>;
};

export type UpdateDashboardInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<Scalars['JSON']['input']>;
  id: Scalars['UUID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateDashboardTileInput = {
  display?: InputMaybe<DashboardTileDisplay>;
  filter?: InputMaybe<Scalars['JSON']['input']>;
  id: Scalars['UUID']['input'];
  measure?: InputMaybe<DashboardMeasure>;
  slice?: InputMaybe<DashboardSlice>;
  title?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateDocumentInput = {
  body?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['UUID']['input'];
  title?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateDraftInput = {
  id: Scalars['UUID']['input'];
  payload: Scalars['JSON']['input'];
};

export type UpdateFormTemplateFieldInput = {
  config?: InputMaybe<Scalars['JSON']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  fieldType?: InputMaybe<FormTemplateFieldType>;
  id: Scalars['UUID']['input'];
  label?: InputMaybe<Scalars['String']['input']>;
  required?: InputMaybe<Scalars['Boolean']['input']>;
  sortOrder?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateFormTemplateInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['UUID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  properties?: InputMaybe<Scalars['JSON']['input']>;
};

export type UpdateGitHubConnectionInput = {
  branchNameFormat?: InputMaybe<Scalars['String']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  linkCommits?: InputMaybe<Scalars['Boolean']['input']>;
  linkbacks?: InputMaybe<Scalars['Boolean']['input']>;
  orgLogin?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateGitHubTeamAutomationInput = {
  draftedStateId?: InputMaybe<Scalars['UUID']['input']>;
  mergedStateId?: InputMaybe<Scalars['UUID']['input']>;
  openedStateId?: InputMaybe<Scalars['UUID']['input']>;
  readyForMergeStateId?: InputMaybe<Scalars['UUID']['input']>;
  reviewRequestedStateId?: InputMaybe<Scalars['UUID']['input']>;
  teamId: Scalars['UUID']['input'];
};

export type UpdateGitLabConnectionInput = {
  accessToken?: InputMaybe<Scalars['String']['input']>;
  branchNameFormat?: InputMaybe<Scalars['String']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  instanceUrl?: InputMaybe<Scalars['String']['input']>;
  linkCommits?: InputMaybe<Scalars['Boolean']['input']>;
  linkbacks?: InputMaybe<Scalars['Boolean']['input']>;
};

export type UpdateGitLabTeamAutomationInput = {
  draftedStateId?: InputMaybe<Scalars['UUID']['input']>;
  mergedStateId?: InputMaybe<Scalars['UUID']['input']>;
  openedStateId?: InputMaybe<Scalars['UUID']['input']>;
  readyForMergeStateId?: InputMaybe<Scalars['UUID']['input']>;
  reviewRequestedStateId?: InputMaybe<Scalars['UUID']['input']>;
  teamId: Scalars['UUID']['input'];
};

export type UpdateInitiativeInput = {
  clearLeadTeam?: InputMaybe<Scalars['Boolean']['input']>;
  clearOwner?: InputMaybe<Scalars['Boolean']['input']>;
  clearTarget?: InputMaybe<Scalars['Boolean']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['UUID']['input'];
  leadTeamId?: InputMaybe<Scalars['UUID']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  ownerId?: InputMaybe<Scalars['UUID']['input']>;
  priority?: InputMaybe<Scalars['Int']['input']>;
  status?: InputMaybe<InitiativeStatus>;
  targetDate?: InputMaybe<Scalars['String']['input']>;
  targetDateGranularity?: InputMaybe<TimeframeGranularity>;
};

export type UpdateInitiativeLabelInput = {
  afterLabelId?: InputMaybe<Scalars['UUID']['input']>;
  clearParent?: InputMaybe<Scalars['Boolean']['input']>;
  color?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['UUID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  parentId?: InputMaybe<Scalars['UUID']['input']>;
};

export type UpdateInitiativeUpdateInput = {
  body?: InputMaybe<Scalars['String']['input']>;
  health?: InputMaybe<ProjectUpdateHealth>;
  id: Scalars['UUID']['input'];
};

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

export type UpdateIssueTemplateEmailIntakeInput = {
  enabled: Scalars['Boolean']['input'];
  templateId: Scalars['UUID']['input'];
};

export type UpdateIssueTemplateInput = {
  body?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['UUID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  properties?: InputMaybe<Scalars['JSON']['input']>;
  /** Sent whole, like properties. Omitted leaves the stored list alone. */
  subIssues?: InputMaybe<Array<TemplateSubIssueInput>>;
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

export type UpdateOauthClientInput = {
  allowedScopes?: InputMaybe<Array<Scalars['String']['input']>>;
  clientCredentialsEnabled?: InputMaybe<Scalars['Boolean']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  developer?: InputMaybe<Scalars['String']['input']>;
  developerUrl?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['UUID']['input'];
  imageUrl?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  publicEnabled?: InputMaybe<Scalars['Boolean']['input']>;
  redirectUris?: InputMaybe<Array<Scalars['String']['input']>>;
  webhookUrl?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateProfileInput = {
  avatarUrl?: InputMaybe<Scalars['String']['input']>;
  displayName?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  timezone?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateProjectInput = {
  /** Place directly below this project in the same priority group. Omit to append. */
  afterProjectId?: InputMaybe<Scalars['UUID']['input']>;
  clearLead?: InputMaybe<Scalars['Boolean']['input']>;
  clearStart?: InputMaybe<Scalars['Boolean']['input']>;
  clearTarget?: InputMaybe<Scalars['Boolean']['input']>;
  color?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  icon?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['UUID']['input'];
  leadId?: InputMaybe<Scalars['UUID']['input']>;
  moveToTop?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  priority?: InputMaybe<Scalars['Int']['input']>;
  startDate?: InputMaybe<Scalars['String']['input']>;
  startDateGranularity?: InputMaybe<TimeframeGranularity>;
  statusId?: InputMaybe<Scalars['UUID']['input']>;
  summary?: InputMaybe<Scalars['String']['input']>;
  targetDate?: InputMaybe<Scalars['String']['input']>;
  targetDateGranularity?: InputMaybe<TimeframeGranularity>;
  updateReminderHour?: InputMaybe<Scalars['Int']['input']>;
  updateReminderIntervalDays?: InputMaybe<Scalars['Int']['input']>;
  updateReminderWeekday?: InputMaybe<Scalars['Int']['input']>;
  updateSchedule?: InputMaybe<ProjectUpdateSchedule>;
};

export type UpdateProjectLabelInput = {
  afterLabelId?: InputMaybe<Scalars['UUID']['input']>;
  clearParent?: InputMaybe<Scalars['Boolean']['input']>;
  color?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['UUID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  parentId?: InputMaybe<Scalars['UUID']['input']>;
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

export type UpdateProjectTemplateInput = {
  body?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['UUID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  properties?: InputMaybe<Scalars['JSON']['input']>;
  summary?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateProjectTemplateIssueInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['UUID']['input'];
  parentId?: InputMaybe<Scalars['UUID']['input']>;
  properties?: InputMaybe<Scalars['JSON']['input']>;
  sortOrder?: InputMaybe<Scalars['String']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateProjectTemplateMilestoneInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['UUID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  sortOrder?: InputMaybe<Scalars['String']['input']>;
  targetDate?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateProjectUpdateInput = {
  body?: InputMaybe<Scalars['String']['input']>;
  health?: InputMaybe<ProjectUpdateHealth>;
  id: Scalars['UUID']['input'];
};

export type UpdatePulseFeedInput = {
  id: Scalars['UUID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  projectIds?: InputMaybe<Array<Scalars['UUID']['input']>>;
};

export type UpdateRecurringIssueInput = {
  body?: InputMaybe<Scalars['String']['input']>;
  cadence?: InputMaybe<RecurringCadence>;
  id: Scalars['UUID']['input'];
  /** Calendar day, `2006-01-02`. The due date of the current occurrence. */
  nextDueDate?: InputMaybe<Scalars['String']['input']>;
  properties?: InputMaybe<Scalars['JSON']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateSentryConnectionInput = {
  defaultTeamId?: InputMaybe<Scalars['UUID']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  organizationSlug?: InputMaybe<Scalars['String']['input']>;
  /** Replace the generated webhook secret with Sentry's client secret (HMAC). */
  webhookSecret?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateSlaRuleInput = {
  action?: InputMaybe<SlaAction>;
  afterId?: InputMaybe<Scalars['UUID']['input']>;
  durationMinutes?: InputMaybe<Scalars['Int']['input']>;
  filter?: InputMaybe<Scalars['JSON']['input']>;
  id: Scalars['UUID']['input'];
};

export type UpdateSlackConnectionInput = {
  asksEnabled?: InputMaybe<Scalars['Boolean']['input']>;
  channelName?: InputMaybe<Scalars['String']['input']>;
  defaultTeamId?: InputMaybe<Scalars['UUID']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  notifyComments?: InputMaybe<Scalars['Boolean']['input']>;
  notifyIssues?: InputMaybe<Scalars['Boolean']['input']>;
  webhookUrl?: InputMaybe<Scalars['String']['input']>;
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

export type UpdateTeamEmailIntakeInput = {
  enabled: Scalars['Boolean']['input'];
  teamId: Scalars['UUID']['input'];
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

export type UpdateTeamTemplatesInput = {
  clearDefaultTemplateForMembers?: InputMaybe<Scalars['Boolean']['input']>;
  clearDefaultTemplateForNonMembers?: InputMaybe<Scalars['Boolean']['input']>;
  defaultTemplateForMembersId?: InputMaybe<Scalars['UUID']['input']>;
  defaultTemplateForNonMembersId?: InputMaybe<Scalars['UUID']['input']>;
  teamId: Scalars['UUID']['input'];
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
  /**
   * True keeps the view to its owner. False shares it with everyone who can see its
   * scope. Omit to leave sharing unchanged.
   *
   * Sharing is a visibility change: the old scope is told to forget the row, then the
   * new scope is told to take it. That is why this is a dedicated flag rather than an
   * owner id — a caller may only ever make a view private to themselves.
   */
  private?: InputMaybe<Scalars['Boolean']['input']>;
};

export type UpdateWebhookInput = {
  enabled: Scalars['Boolean']['input'];
  id: Scalars['UUID']['input'];
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
  clearCustomerDefaultTeam?: InputMaybe<Scalars['Boolean']['input']>;
  customerDefaultTeamId?: InputMaybe<Scalars['UUID']['input']>;
  customerRequestsEnabled?: InputMaybe<Scalars['Boolean']['input']>;
  customerRevenueUnit?: InputMaybe<Scalars['String']['input']>;
  customerTiers?: InputMaybe<Array<Scalars['String']['input']>>;
  logoUrl?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  projectUpdateReminderHour?: InputMaybe<Scalars['Int']['input']>;
  projectUpdateReminderIntervalDays?: InputMaybe<Scalars['Int']['input']>;
  projectUpdateReminderWeekday?: InputMaybe<Scalars['Int']['input']>;
  pulseDigestCadence?: InputMaybe<PulseDigestCadence>;
  pulseEnabled?: InputMaybe<Scalars['Boolean']['input']>;
  /** The address segment. The previous value stays reserved so bookmarks still resolve. */
  urlKey?: InputMaybe<Scalars['String']['input']>;
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
  /** Set means the view is attached as a tab on this project. */
  projectId?: Maybe<Scalars['UUID']['output']>;
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

/**
 * A personal subscription to a saved view.
 *
 * One person, one view, two independent event flags. Slack-channel subscriptions stay out
 * of this type: they need a Slack install. Self-triggered changes do not notify — that
 * rule is the fan-out's, not a column here.
 */
export type ViewSubscription = {
  /** Notify when a newly created issue matches the view. */
  added: Scalars['Boolean']['output'];
  /** Notify when an issue that matches the view is completed or canceled. */
  completed: Scalars['Boolean']['output'];
  createdAt: Scalars['Time']['output'];
  id: Scalars['UUID']['output'];
  updatedAt: Scalars['Time']['output'];
  userId: Scalars['UUID']['output'];
  viewId: Scalars['UUID']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type ViewSubscriptionPayload = MutationResult & {
  version: Scalars['Int']['output'];
  viewSubscription: ViewSubscription;
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

/**
 * An outbound webhook. The signing secret is not on this type: it exists in the create
 * response and in the column the delivery path reads, and nowhere a listing can see it.
 */
export type Webhook = {
  allPublicTeams: Scalars['Boolean']['output'];
  consecutiveFailures: Scalars['Int']['output'];
  createdAt: Scalars['Time']['output'];
  creatorId: Scalars['UUID']['output'];
  disabledAt?: Maybe<Scalars['Time']['output']>;
  enabled: Scalars['Boolean']['output'];
  id: Scalars['UUID']['output'];
  resourceTypes: Array<Scalars['String']['output']>;
  teamId?: Maybe<Scalars['UUID']['output']>;
  updatedAt: Scalars['Time']['output'];
  url: Scalars['String']['output'];
  workspaceId: Scalars['UUID']['output'];
};

export type WebhookCreatePayload = MutationResult & {
  created: WebhookCreated;
  version: Scalars['Int']['output'];
};

export type WebhookCreated = {
  /** Shown once. Used to HMAC the raw body. Not recoverable afterwards. */
  secret: Scalars['String']['output'];
  webhook: Webhook;
};

/** One delivery attempt, so an admin can self-diagnose a failing consumer. */
export type WebhookDelivery = {
  attempt: Scalars['Int']['output'];
  changeVersion: Scalars['Int']['output'];
  createdAt: Scalars['Time']['output'];
  deliveredAt?: Maybe<Scalars['Time']['output']>;
  entityType: Scalars['String']['output'];
  id: Scalars['UUID']['output'];
  lastDurationMs?: Maybe<Scalars['Int']['output']>;
  lastError?: Maybe<Scalars['String']['output']>;
  lastStatus?: Maybe<Scalars['Int']['output']>;
  webhookId: Scalars['UUID']['output'];
};

export type WebhookPayload = MutationResult & {
  version: Scalars['Int']['output'];
  webhook: Webhook;
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
  /** Public team issues created from a customer page should land in. Null means the creator picks. */
  customerDefaultTeamId?: Maybe<Scalars['UUID']['output']>;
  /** When false, customer pages and request writes are off. */
  customerRequestsEnabled: Scalars['Boolean']['output'];
  /** Label for the revenue number, e.g. USD or seats. */
  customerRevenueUnit: Scalars['String']['output'];
  /** Named plans shown when attributing a customer. customer.tier matches one of these. */
  customerTiers: Array<Scalars['String']['output']>;
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
  /** Hour of day in the lead's timezone when reminders would send (0–23). */
  projectUpdateReminderHour: Scalars['Int']['output'];
  /** Default cadence for project update reminders (staleness + future delivery). */
  projectUpdateReminderIntervalDays: Scalars['Int']['output'];
  /** 0 = Sunday through 6 = Saturday. */
  projectUpdateReminderWeekday: Scalars['Int']['output'];
  /** Default inbox digest cadence. Summaries land around 06:00 in each member's timezone. */
  pulseDigestCadence: PulseDigestCadence;
  /** When false, Pulse is hidden and the morning digest does not send. */
  pulseEnabled: Scalars['Boolean']['output'];
  /** Overrides the plan's default seat count. Null means whatever the plan says. */
  seatLimit?: Maybe<Scalars['Int']['output']>;
  teams: Array<Team>;
  updatedAt: Scalars['Time']['output'];
  /** The address segment: /<urlKey>/issue/ENG-1. */
  urlKey: Scalars['String']['output'];
  /** The workspace directory. A guest receives only their own row — see Query.users. */
  users: Array<User>;
};

export type WorkspacePayload = MutationResult & {
  version: Scalars['Int']['output'];
  workspace: Workspace;
};

export type EnterpriseAuditLogQueryVariables = Exact<{
  first?: InputMaybe<Scalars['Int']['input']>;
  after?: InputMaybe<Scalars['UUID']['input']>;
}>;


export type EnterpriseAuditLogQuery = { auditLog: Array<{ id: string, actorUserId?: string | null, actorType: string, actorLabel: string, action: string, targetType?: string | null, targetId?: string | null, targetLabel?: string | null, ip?: string | null, userAgent?: string | null, createdAt: string }> };

export type EntitlementsQueryVariables = Exact<{ [key: string]: never; }>;


export type EntitlementsQuery = { workspace: { id: string, name: string, plan: string, planExpiresAt?: string | null, planLapsedAt?: string | null, seatLimit?: number | null, entitlements: { plan: string, seatLimit?: number | null, seatsUsed: number, teamLimit?: number | null, historyDays?: number | null, privateTeams: boolean, subTeams: boolean, multiLevelSubTeams: boolean, customViews: boolean, apiKeys: boolean, sso: boolean, auditLog: boolean, slas: boolean, slack: boolean, lapsed: boolean } } };

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


export type ArchivedIssuesQuery = { archivedIssues: Array<{ id: string, workspaceId: string, teamId: string, number: number, identifier: string, title: string, description: string, stateId: string, assigneeId?: string | null, creatorId?: string | null, priority: number, sortOrder: string, estimate?: number | null, dueDate?: string | null, dueDateSource: DueDateSource, parentId?: string | null, subIssueSortOrder?: string | null, templateId?: string | null, formTemplateId?: string | null, recurringIssueId?: string | null, projectId?: string | null, projectMilestoneId?: string | null, cycleId?: string | null, snoozedUntil?: string | null, autoClosedAt?: string | null, startedAt?: string | null, completedAt?: string | null, canceledAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string }> };

export type ArchivedCyclesQueryVariables = Exact<{
  teamId: Scalars['UUID']['input'];
}>;


export type ArchivedCyclesQuery = { archivedCycles: Array<{ id: string, workspaceId: string, teamId: string, number: number, name: string, description?: string | null, startsAt: string, endsAt: string, completedAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string }> };

export type ArchivedProjectsQueryVariables = Exact<{
  teamId: Scalars['UUID']['input'];
}>;


export type ArchivedProjectsQuery = { archivedProjects: Array<{ id: string, workspaceId: string, name: string, summary?: string | null, description: string, icon?: string | null, color: string, statusId: string, priority: number, leadId?: string | null, creatorId?: string | null, sortOrder: string, startDate?: string | null, startDateGranularity?: TimeframeGranularity | null, targetDate?: string | null, targetDateGranularity?: TimeframeGranularity | null, updateSchedule: ProjectUpdateSchedule, updateReminderIntervalDays?: number | null, updateReminderWeekday?: number | null, updateReminderHour?: number | null, archivedAt?: string | null, deletedAt?: string | null, deletedBy?: string | null, projectTemplateId?: string | null, createdAt: string, updatedAt: string }> };

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

export type AskFormFieldsFragment = { id: string, workspaceId: string, teamId: string, name: string, description: string, token: string, creatorId?: string | null, archivedAt?: string | null, deletedAt?: string | null, createdAt: string, updatedAt: string };

export type CreateAskFormMutationVariables = Exact<{
  input: CreateAskFormInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateAskFormMutation = { createAskForm: { version: number, askForm: { id: string, workspaceId: string, teamId: string, name: string, description: string, token: string, creatorId?: string | null, archivedAt?: string | null, deletedAt?: string | null, createdAt: string, updatedAt: string } } };

export type UpdateAskFormMutationVariables = Exact<{
  input: UpdateAskFormInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type UpdateAskFormMutation = { updateAskForm: { version: number, askForm: { id: string, workspaceId: string, teamId: string, name: string, description: string, token: string, creatorId?: string | null, archivedAt?: string | null, deletedAt?: string | null, createdAt: string, updatedAt: string } } };

export type ArchiveAskFormMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  archived: Scalars['Boolean']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type ArchiveAskFormMutation = { archiveAskForm: { version: number, id: string } };

export type DeleteAskFormMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type DeleteAskFormMutation = { deleteAskForm: { version: number, id: string } };

export type AuthorisedOauthAppFieldsFragment = { id: string, name: string, clientId: string, imageUrl?: string | null, developer?: string | null, scopes: Array<string>, lastUsedAt?: string | null, createdAt: string };

export type AuthorisedOauthAppsQueryVariables = Exact<{ [key: string]: never; }>;


export type AuthorisedOauthAppsQuery = { authorisedOauthApps: Array<{ id: string, name: string, clientId: string, imageUrl?: string | null, developer?: string | null, scopes: Array<string>, lastUsedAt?: string | null, createdAt: string }> };

export type RevokeAuthorisedOauthAppMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
}>;


export type RevokeAuthorisedOauthAppMutation = { revokeAuthorisedOauthApp: { version: number, id: string } };

export type LeaveWorkspaceMutationVariables = Exact<{ [key: string]: never; }>;


export type LeaveWorkspaceMutation = { leaveWorkspace: { version: number, id: string } };

export type CustomerFieldsFragment = { id: string, workspaceId: string, name: string, domains: Array<string>, revenue?: number | null, size?: number | null, tier?: string | null, status: CustomerStatus, ownerId?: string | null, logoUrl: string, creatorId?: string | null, sortOrder: string, archivedAt?: string | null, deletedAt?: string | null, deletedBy?: string | null, createdAt: string, updatedAt: string };

export type CustomerRequestFieldsFragment = { id: string, workspaceId: string, customerId?: string | null, issueId?: string | null, projectId?: string | null, body: string, important: boolean, creatorId?: string | null, createdAt: string, updatedAt: string };

export type CreateCustomerMutationVariables = Exact<{
  input: CreateCustomerInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateCustomerMutation = { createCustomer: { version: number, customer: { id: string, workspaceId: string, name: string, domains: Array<string>, revenue?: number | null, size?: number | null, tier?: string | null, status: CustomerStatus, ownerId?: string | null, logoUrl: string, creatorId?: string | null, sortOrder: string, archivedAt?: string | null, deletedAt?: string | null, deletedBy?: string | null, createdAt: string, updatedAt: string } } };

export type UpdateCustomerMutationVariables = Exact<{
  input: UpdateCustomerInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type UpdateCustomerMutation = { updateCustomer: { version: number, customer: { id: string, workspaceId: string, name: string, domains: Array<string>, revenue?: number | null, size?: number | null, tier?: string | null, status: CustomerStatus, ownerId?: string | null, logoUrl: string, creatorId?: string | null, sortOrder: string, archivedAt?: string | null, deletedAt?: string | null, deletedBy?: string | null, createdAt: string, updatedAt: string } } };

export type CreateCustomerRequestMutationVariables = Exact<{
  input: CreateCustomerRequestInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateCustomerRequestMutation = { createCustomerRequest: { version: number, customerRequest: { id: string, workspaceId: string, customerId?: string | null, issueId?: string | null, projectId?: string | null, body: string, important: boolean, creatorId?: string | null, createdAt: string, updatedAt: string } } };

export type UpdateCustomerRequestMutationVariables = Exact<{
  input: UpdateCustomerRequestInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type UpdateCustomerRequestMutation = { updateCustomerRequest: { version: number, customerRequest: { id: string, workspaceId: string, customerId?: string | null, issueId?: string | null, projectId?: string | null, body: string, important: boolean, creatorId?: string | null, createdAt: string, updatedAt: string } } };

export type DeleteCustomerRequestMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type DeleteCustomerRequestMutation = { deleteCustomerRequest: { version: number, id: string } };

export type ArchiveCustomerMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  archived: Scalars['Boolean']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type ArchiveCustomerMutation = { archiveCustomer: { version: number, id: string } };

export type MergeCustomersMutationVariables = Exact<{
  sourceId: Scalars['UUID']['input'];
  intoId: Scalars['UUID']['input'];
}>;


export type MergeCustomersMutation = { mergeCustomers: { version: number, customer: { id: string, workspaceId: string, name: string, domains: Array<string>, revenue?: number | null, size?: number | null, tier?: string | null, status: CustomerStatus, ownerId?: string | null, logoUrl: string, creatorId?: string | null, sortOrder: string, archivedAt?: string | null, deletedAt?: string | null, deletedBy?: string | null, createdAt: string, updatedAt: string } } };

export type EnsureCycleCalendarFeedMutationVariables = Exact<{
  teamId: Scalars['UUID']['input'];
}>;


export type EnsureCycleCalendarFeedMutation = { ensureCycleCalendarFeed: { version: number, url: string, cycleCalendarFeed: { id: string, workspaceId: string, teamId: string, userId: string, createdAt: string, updatedAt: string } } };

export type RotateCycleCalendarFeedMutationVariables = Exact<{
  teamId: Scalars['UUID']['input'];
}>;


export type RotateCycleCalendarFeedMutation = { rotateCycleCalendarFeed: { version: number, url: string, cycleCalendarFeed: { id: string, workspaceId: string, teamId: string, userId: string, createdAt: string, updatedAt: string } } };

export type UpdateCycleMutationVariables = Exact<{
  input: UpdateCycleInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type UpdateCycleMutation = { updateCycle: { version: number, cycle: { id: string, workspaceId: string, teamId: string, number: number, name: string, description?: string | null, startsAt: string, endsAt: string, completedAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string } } };

export type StartCycleTodayMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type StartCycleTodayMutation = { startCycleToday: { version: number, cycle: { id: string, workspaceId: string, teamId: string, number: number, name: string, description?: string | null, startsAt: string, endsAt: string, completedAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string } } };

export type DashboardFieldsFragment = { id: string, workspaceId: string, teamId?: string | null, ownerId?: string | null, name: string, description: string, filter: unknown, creatorId?: string | null, sortOrder: string, archivedAt?: string | null, deletedAt?: string | null, deletedBy?: string | null, createdAt: string, updatedAt: string };

export type DashboardTileFieldsFragment = { id: string, workspaceId: string, dashboardId: string, title: string, measure: DashboardMeasure, slice: DashboardSlice, display: DashboardTileDisplay, filter: unknown, sortOrder: string, createdAt: string, updatedAt: string };

export type CreateDashboardMutationVariables = Exact<{
  input: CreateDashboardInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateDashboardMutation = { createDashboard: { version: number, dashboard: { id: string, workspaceId: string, teamId?: string | null, ownerId?: string | null, name: string, description: string, filter: unknown, creatorId?: string | null, sortOrder: string, archivedAt?: string | null, deletedAt?: string | null, deletedBy?: string | null, createdAt: string, updatedAt: string } } };

export type UpdateDashboardMutationVariables = Exact<{
  input: UpdateDashboardInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type UpdateDashboardMutation = { updateDashboard: { version: number, dashboard: { id: string, workspaceId: string, teamId?: string | null, ownerId?: string | null, name: string, description: string, filter: unknown, creatorId?: string | null, sortOrder: string, archivedAt?: string | null, deletedAt?: string | null, deletedBy?: string | null, createdAt: string, updatedAt: string } } };

export type DeleteDashboardMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type DeleteDashboardMutation = { deleteDashboard: { version: number, id: string } };

export type CreateDashboardTileMutationVariables = Exact<{
  input: CreateDashboardTileInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateDashboardTileMutation = { createDashboardTile: { version: number, dashboardTile: { id: string, workspaceId: string, dashboardId: string, title: string, measure: DashboardMeasure, slice: DashboardSlice, display: DashboardTileDisplay, filter: unknown, sortOrder: string, createdAt: string, updatedAt: string } } };

export type UpdateDashboardTileMutationVariables = Exact<{
  input: UpdateDashboardTileInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type UpdateDashboardTileMutation = { updateDashboardTile: { version: number, dashboardTile: { id: string, workspaceId: string, dashboardId: string, title: string, measure: DashboardMeasure, slice: DashboardSlice, display: DashboardTileDisplay, filter: unknown, sortOrder: string, createdAt: string, updatedAt: string } } };

export type DeleteDashboardTileMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type DeleteDashboardTileMutation = { deleteDashboardTile: { version: number, id: string } };

export type DocumentFieldsFragment = { id: string, workspaceId: string, teamId: string, projectId?: string | null, title: string, body: string, sortOrder: string, creatorId?: string | null, updatedBy?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null, deletedAt?: string | null };

export type CreateDocumentMutationVariables = Exact<{
  input: CreateDocumentInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateDocumentMutation = { createDocument: { version: number, document: { id: string, workspaceId: string, teamId: string, projectId?: string | null, title: string, body: string, sortOrder: string, creatorId?: string | null, updatedBy?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null, deletedAt?: string | null } } };

export type UpdateDocumentMutationVariables = Exact<{
  input: UpdateDocumentInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type UpdateDocumentMutation = { updateDocument: { version: number, document: { id: string, workspaceId: string, teamId: string, projectId?: string | null, title: string, body: string, sortOrder: string, creatorId?: string | null, updatedBy?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null, deletedAt?: string | null } } };

export type ArchiveDocumentMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  archived: Scalars['Boolean']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type ArchiveDocumentMutation = { archiveDocument: { version: number, id: string } };

export type DeleteDocumentMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type DeleteDocumentMutation = { deleteDocument: { version: number, id: string } };

export type DraftFieldsFragment = { id: string, workspaceId: string, userId: string, kind: DraftKind, payload: unknown, createdAt: string, updatedAt: string };

export type DraftsQueryVariables = Exact<{ [key: string]: never; }>;


export type DraftsQuery = { drafts: Array<{ id: string, workspaceId: string, userId: string, kind: DraftKind, payload: unknown, createdAt: string, updatedAt: string }> };

export type CreateDraftMutationVariables = Exact<{
  input: CreateDraftInput;
}>;


export type CreateDraftMutation = { createDraft: { version: number, draft: { id: string, workspaceId: string, userId: string, kind: DraftKind, payload: unknown, createdAt: string, updatedAt: string } } };

export type UpdateDraftMutationVariables = Exact<{
  input: UpdateDraftInput;
}>;


export type UpdateDraftMutation = { updateDraft: { version: number, draft: { id: string, workspaceId: string, userId: string, kind: DraftKind, payload: unknown, createdAt: string, updatedAt: string } } };

export type DeleteDraftMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
}>;


export type DeleteDraftMutation = { deleteDraft: { version: number, id: string } };

export type FormTemplateFieldsFragment = { id: string, workspaceId: string, teamId?: string | null, name: string, description?: string | null, properties: unknown, position: string, createdBy?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null };

export type FormTemplateFieldFieldsFragment = { id: string, workspaceId: string, formTemplateId: string, fieldType: FormTemplateFieldType, label: string, description?: string | null, required: boolean, sortOrder: string, config: unknown, createdAt: string, updatedAt: string };

export type CreateFormTemplateMutationVariables = Exact<{
  input: CreateFormTemplateInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateFormTemplateMutation = { createFormTemplate: { version: number, template: { id: string, workspaceId: string, teamId?: string | null, name: string, description?: string | null, properties: unknown, position: string, createdBy?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

export type UpdateFormTemplateMutationVariables = Exact<{
  input: UpdateFormTemplateInput;
}>;


export type UpdateFormTemplateMutation = { updateFormTemplate: { version: number, template: { id: string, workspaceId: string, teamId?: string | null, name: string, description?: string | null, properties: unknown, position: string, createdBy?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

export type ArchiveFormTemplateMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  archived: Scalars['Boolean']['input'];
}>;


export type ArchiveFormTemplateMutation = { archiveFormTemplate: { version: number, id: string } };

export type CreateFormTemplateFieldMutationVariables = Exact<{
  input: CreateFormTemplateFieldInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateFormTemplateFieldMutation = { createFormTemplateField: { version: number, field: { id: string, workspaceId: string, formTemplateId: string, fieldType: FormTemplateFieldType, label: string, description?: string | null, required: boolean, sortOrder: string, config: unknown, createdAt: string, updatedAt: string } } };

export type UpdateFormTemplateFieldMutationVariables = Exact<{
  input: UpdateFormTemplateFieldInput;
}>;


export type UpdateFormTemplateFieldMutation = { updateFormTemplateField: { version: number, field: { id: string, workspaceId: string, formTemplateId: string, fieldType: FormTemplateFieldType, label: string, description?: string | null, required: boolean, sortOrder: string, config: unknown, createdAt: string, updatedAt: string } } };

export type DeleteFormTemplateFieldMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
}>;


export type DeleteFormTemplateFieldMutation = { deleteFormTemplateField: { version: number, id: string } };

export type GitHubConnectionFieldsFragment = { id: string, workspaceId: string, creatorId: string, enabled: boolean, orgLogin?: string | null, branchNameFormat: string, linkCommits: boolean, linkbacks: boolean, connectedAt?: string | null, createdAt: string, updatedAt: string };

export type GitHubUserLinkFieldsFragment = { id: string, workspaceId: string, userId: string, githubLogin: string, createdAt: string, updatedAt: string };

export type GitHubSettingsQueryVariables = Exact<{ [key: string]: never; }>;


export type GitHubSettingsQuery = { githubOAuthConfigured: boolean, githubCommitWebhook?: { url: string, secret: string } | null };

export type CreateGitHubConnectionMutationVariables = Exact<{
  input: CreateGitHubConnectionInput;
}>;


export type CreateGitHubConnectionMutation = { createGitHubConnection: { version: number, githubConnection: { id: string, workspaceId: string, creatorId: string, enabled: boolean, orgLogin?: string | null, branchNameFormat: string, linkCommits: boolean, linkbacks: boolean, connectedAt?: string | null, createdAt: string, updatedAt: string } } };

export type UpdateGitHubConnectionMutationVariables = Exact<{
  input: UpdateGitHubConnectionInput;
}>;


export type UpdateGitHubConnectionMutation = { updateGitHubConnection: { version: number, githubConnection: { id: string, workspaceId: string, creatorId: string, enabled: boolean, orgLogin?: string | null, branchNameFormat: string, linkCommits: boolean, linkbacks: boolean, connectedAt?: string | null, createdAt: string, updatedAt: string } } };

export type DeleteGitHubConnectionMutationVariables = Exact<{ [key: string]: never; }>;


export type DeleteGitHubConnectionMutation = { deleteGitHubConnection: { version: number, id: string } };

export type CreateGitHubUserLinkMutationVariables = Exact<{
  input: CreateGitHubUserLinkInput;
}>;


export type CreateGitHubUserLinkMutation = { createGitHubUserLink: { version: number, githubUserLink: { id: string, workspaceId: string, userId: string, githubLogin: string, createdAt: string, updatedAt: string } } };

export type DeleteGitHubUserLinkMutationVariables = Exact<{ [key: string]: never; }>;


export type DeleteGitHubUserLinkMutation = { deleteGitHubUserLink: { version: number, id: string } };

export type GitHubTeamAutomationFieldsFragment = { teamId: string, configured: boolean, draftedStateId?: string | null, openedStateId?: string | null, reviewRequestedStateId?: string | null, readyForMergeStateId?: string | null, mergedStateId?: string | null };

export type GitHubTeamAutomationQueryVariables = Exact<{
  teamId: Scalars['UUID']['input'];
}>;


export type GitHubTeamAutomationQuery = { githubTeamAutomation: { teamId: string, configured: boolean, draftedStateId?: string | null, openedStateId?: string | null, reviewRequestedStateId?: string | null, readyForMergeStateId?: string | null, mergedStateId?: string | null } };

export type UpdateGitHubTeamAutomationMutationVariables = Exact<{
  input: UpdateGitHubTeamAutomationInput;
}>;


export type UpdateGitHubTeamAutomationMutation = { updateGitHubTeamAutomation: { githubTeamAutomation: { teamId: string, configured: boolean, draftedStateId?: string | null, openedStateId?: string | null, reviewRequestedStateId?: string | null, readyForMergeStateId?: string | null, mergedStateId?: string | null } } };

export type DeleteGitHubTeamAutomationMutationVariables = Exact<{
  teamId: Scalars['UUID']['input'];
}>;


export type DeleteGitHubTeamAutomationMutation = { deleteGitHubTeamAutomation: { githubTeamAutomation: { teamId: string, configured: boolean, draftedStateId?: string | null, openedStateId?: string | null, reviewRequestedStateId?: string | null, readyForMergeStateId?: string | null, mergedStateId?: string | null } } };

export type GitLabConnectionFieldsFragment = { id: string, workspaceId: string, creatorId: string, enabled: boolean, instanceUrl: string, branchNameFormat: string, linkCommits: boolean, linkbacks: boolean, connectedAt?: string | null, createdAt: string, updatedAt: string };

export type GitLabUserLinkFieldsFragment = { id: string, workspaceId: string, userId: string, gitlabUsername: string, createdAt: string, updatedAt: string };

export type GitLabSettingsQueryVariables = Exact<{ [key: string]: never; }>;


export type GitLabSettingsQuery = { gitlabWebhook?: { url: string, secret: string } | null };

export type CreateGitLabConnectionMutationVariables = Exact<{
  input: CreateGitLabConnectionInput;
}>;


export type CreateGitLabConnectionMutation = { createGitLabConnection: { version: number, gitlabConnection: { id: string, workspaceId: string, creatorId: string, enabled: boolean, instanceUrl: string, branchNameFormat: string, linkCommits: boolean, linkbacks: boolean, connectedAt?: string | null, createdAt: string, updatedAt: string } } };

export type UpdateGitLabConnectionMutationVariables = Exact<{
  input: UpdateGitLabConnectionInput;
}>;


export type UpdateGitLabConnectionMutation = { updateGitLabConnection: { version: number, gitlabConnection: { id: string, workspaceId: string, creatorId: string, enabled: boolean, instanceUrl: string, branchNameFormat: string, linkCommits: boolean, linkbacks: boolean, connectedAt?: string | null, createdAt: string, updatedAt: string } } };

export type DeleteGitLabConnectionMutationVariables = Exact<{ [key: string]: never; }>;


export type DeleteGitLabConnectionMutation = { deleteGitLabConnection: { version: number, id: string } };

export type CreateGitLabUserLinkMutationVariables = Exact<{
  input: CreateGitLabUserLinkInput;
}>;


export type CreateGitLabUserLinkMutation = { createGitLabUserLink: { version: number, gitlabUserLink: { id: string, workspaceId: string, userId: string, gitlabUsername: string, createdAt: string, updatedAt: string } } };

export type DeleteGitLabUserLinkMutationVariables = Exact<{ [key: string]: never; }>;


export type DeleteGitLabUserLinkMutation = { deleteGitLabUserLink: { version: number, id: string } };

export type GitLabTeamAutomationFieldsFragment = { teamId: string, configured: boolean, draftedStateId?: string | null, openedStateId?: string | null, reviewRequestedStateId?: string | null, readyForMergeStateId?: string | null, mergedStateId?: string | null };

export type GitLabTeamAutomationQueryVariables = Exact<{
  teamId: Scalars['UUID']['input'];
}>;


export type GitLabTeamAutomationQuery = { gitlabTeamAutomation: { teamId: string, configured: boolean, draftedStateId?: string | null, openedStateId?: string | null, reviewRequestedStateId?: string | null, readyForMergeStateId?: string | null, mergedStateId?: string | null } };

export type UpdateGitLabTeamAutomationMutationVariables = Exact<{
  input: UpdateGitLabTeamAutomationInput;
}>;


export type UpdateGitLabTeamAutomationMutation = { updateGitLabTeamAutomation: { gitlabTeamAutomation: { teamId: string, configured: boolean, draftedStateId?: string | null, openedStateId?: string | null, reviewRequestedStateId?: string | null, readyForMergeStateId?: string | null, mergedStateId?: string | null } } };

export type DeleteGitLabTeamAutomationMutationVariables = Exact<{
  teamId: Scalars['UUID']['input'];
}>;


export type DeleteGitLabTeamAutomationMutation = { deleteGitLabTeamAutomation: { gitlabTeamAutomation: { teamId: string, configured: boolean, draftedStateId?: string | null, openedStateId?: string | null, reviewRequestedStateId?: string | null, readyForMergeStateId?: string | null, mergedStateId?: string | null } } };

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

export type InitiativeLabelFieldsFragment = { id: string, workspaceId: string, parentId?: string | null, isGroup: boolean, name: string, description?: string | null, color: string, position: string, createdAt: string, updatedAt: string, archivedAt?: string | null };

export type InitiativeLabelLinkFieldsFragment = { id: string, workspaceId: string, initiativeId: string, labelId: string, groupId?: string | null, createdBy?: string | null, createdAt: string };

export type CreateInitiativeLabelMutationVariables = Exact<{
  input: CreateInitiativeLabelInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateInitiativeLabelMutation = { createInitiativeLabel: { version: number, initiativeLabel: { id: string, workspaceId: string, parentId?: string | null, isGroup: boolean, name: string, description?: string | null, color: string, position: string, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

export type UpdateInitiativeLabelMutationVariables = Exact<{
  input: UpdateInitiativeLabelInput;
}>;


export type UpdateInitiativeLabelMutation = { updateInitiativeLabel: { version: number, initiativeLabel: { id: string, workspaceId: string, parentId?: string | null, isGroup: boolean, name: string, description?: string | null, color: string, position: string, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

export type ArchiveInitiativeLabelMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  archived: Scalars['Boolean']['input'];
}>;


export type ArchiveInitiativeLabelMutation = { archiveInitiativeLabel: { version: number, id: string } };

export type AddInitiativeLabelMutationVariables = Exact<{
  initiativeId: Scalars['UUID']['input'];
  labelId: Scalars['UUID']['input'];
}>;


export type AddInitiativeLabelMutation = { addInitiativeLabel: { version: number, initiativeLabelLink: { id: string, workspaceId: string, initiativeId: string, labelId: string, groupId?: string | null, createdBy?: string | null, createdAt: string } } };

export type RemoveInitiativeLabelMutationVariables = Exact<{
  initiativeId: Scalars['UUID']['input'];
  labelId: Scalars['UUID']['input'];
}>;


export type RemoveInitiativeLabelMutation = { removeInitiativeLabel: { version: number, id: string } };

export type InitiativeUpdateFieldsFragment = { id: string, workspaceId: string, initiativeId: string, health: ProjectUpdateHealth, body: string, authorId: string, editedAt?: string | null, deletedAt?: string | null, createdAt: string, updatedAt: string };

export type CreateInitiativeUpdateMutationVariables = Exact<{
  input: CreateInitiativeUpdateInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateInitiativeUpdateMutation = { createInitiativeUpdate: { version: number, initiativeUpdate: { id: string, workspaceId: string, initiativeId: string, health: ProjectUpdateHealth, body: string, authorId: string, editedAt?: string | null, deletedAt?: string | null, createdAt: string, updatedAt: string } } };

export type UpdateInitiativeUpdateMutationVariables = Exact<{
  input: UpdateInitiativeUpdateInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type UpdateInitiativeUpdateMutation = { updateInitiativeUpdate: { version: number, initiativeUpdate: { id: string, workspaceId: string, initiativeId: string, health: ProjectUpdateHealth, body: string, authorId: string, editedAt?: string | null, deletedAt?: string | null, createdAt: string, updatedAt: string } } };

export type DeleteInitiativeUpdateMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type DeleteInitiativeUpdateMutation = { deleteInitiativeUpdate: { version: number, id: string } };

export type InitiativeFieldsFragment = { id: string, workspaceId: string, name: string, description: string, status: InitiativeStatus, priority: number, ownerId?: string | null, leadTeamId?: string | null, sortOrder: string, targetDate?: string | null, targetDateGranularity?: TimeframeGranularity | null, creatorId?: string | null, archivedAt?: string | null, deletedAt?: string | null, deletedBy?: string | null, createdAt: string, updatedAt: string };

export type InitiativeProjectFieldsFragment = { id: string, workspaceId: string, initiativeId: string, projectId: string, createdAt: string };

export type CreateInitiativeMutationVariables = Exact<{
  input: CreateInitiativeInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateInitiativeMutation = { createInitiative: { version: number, initiative: { id: string, workspaceId: string, name: string, description: string, status: InitiativeStatus, priority: number, ownerId?: string | null, leadTeamId?: string | null, sortOrder: string, targetDate?: string | null, targetDateGranularity?: TimeframeGranularity | null, creatorId?: string | null, archivedAt?: string | null, deletedAt?: string | null, deletedBy?: string | null, createdAt: string, updatedAt: string } } };

export type UpdateInitiativeMutationVariables = Exact<{
  input: UpdateInitiativeInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type UpdateInitiativeMutation = { updateInitiative: { version: number, initiative: { id: string, workspaceId: string, name: string, description: string, status: InitiativeStatus, priority: number, ownerId?: string | null, leadTeamId?: string | null, sortOrder: string, targetDate?: string | null, targetDateGranularity?: TimeframeGranularity | null, creatorId?: string | null, archivedAt?: string | null, deletedAt?: string | null, deletedBy?: string | null, createdAt: string, updatedAt: string } } };

export type AddInitiativeProjectMutationVariables = Exact<{
  initiativeId: Scalars['UUID']['input'];
  projectId: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type AddInitiativeProjectMutation = { addInitiativeProject: { version: number, initiativeProject: { id: string, workspaceId: string, initiativeId: string, projectId: string, createdAt: string } } };

export type RemoveInitiativeProjectMutationVariables = Exact<{
  initiativeId: Scalars['UUID']['input'];
  projectId: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type RemoveInitiativeProjectMutation = { removeInitiativeProject: { version: number, id: string } };

export type ArchiveInitiativeMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  archived: Scalars['Boolean']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type ArchiveInitiativeMutation = { archiveInitiative: { version: number, id: string } };

export type InitiativeRelationFieldsFragment = { id: string, workspaceId: string, parentInitiativeId: string, childInitiativeId: string, sortOrder: string, createdBy?: string | null, createdAt: string };

export type AddInitiativeRelationMutationVariables = Exact<{
  parentInitiativeId: Scalars['UUID']['input'];
  childInitiativeId: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type AddInitiativeRelationMutation = { addInitiativeRelation: { version: number, initiativeRelation: { id: string, workspaceId: string, parentInitiativeId: string, childInitiativeId: string, sortOrder: string, createdBy?: string | null, createdAt: string } } };

export type RemoveInitiativeRelationMutationVariables = Exact<{
  parentInitiativeId: Scalars['UUID']['input'];
  childInitiativeId: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type RemoveInitiativeRelationMutation = { removeInitiativeRelation: { version: number, id: string } };

export type IntegrationSubmissionsQueryVariables = Exact<{ [key: string]: never; }>;


export type IntegrationSubmissionsQuery = { integrationSubmissions: Array<{ id: string, workspaceId: string, submittedBy: string, name: string, website: string, summary: string, createdAt: string, updatedAt: string }> };

export type SubmitIntegrationMutationVariables = Exact<{
  input: SubmitIntegrationInput;
}>;


export type SubmitIntegrationMutation = { submitIntegration: { submission: { id: string, workspaceId: string, submittedBy: string, name: string, website: string, summary: string, createdAt: string, updatedAt: string } } };

export type SubIssueFieldsFragment = { id: string, workspaceId: string, teamId: string, number: number, identifier: string, title: string, description: string, stateId: string, assigneeId?: string | null, creatorId?: string | null, priority: number, sortOrder: string, estimate?: number | null, dueDate?: string | null, dueDateSource: DueDateSource, parentId?: string | null, subIssueSortOrder?: string | null, templateId?: string | null, formTemplateId?: string | null, recurringIssueId?: string | null, projectId?: string | null, projectMilestoneId?: string | null, cycleId?: string | null, snoozedUntil?: string | null, autoClosedAt?: string | null, startedAt?: string | null, completedAt?: string | null, canceledAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string };

export type RelationFieldsFragment = { id: string, workspaceId: string, issueId: string, relatedIssueId: string, type: RelationType, teamId: string, relatedTeamId: string, createdBy?: string | null, createdAt: string };

export type SubscriptionFieldsFragment = { id: string, workspaceId: string, issueId: string, userId: string, reason: SubscriptionReason, unsubscribed: boolean, createdAt: string, updatedAt: string };

export type CreateSubIssueMutationVariables = Exact<{
  input: CreateIssueInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateSubIssueMutation = { createIssue: { version: number, issue: { id: string, workspaceId: string, teamId: string, number: number, identifier: string, title: string, description: string, stateId: string, assigneeId?: string | null, creatorId?: string | null, priority: number, sortOrder: string, estimate?: number | null, dueDate?: string | null, dueDateSource: DueDateSource, parentId?: string | null, subIssueSortOrder?: string | null, templateId?: string | null, formTemplateId?: string | null, recurringIssueId?: string | null, projectId?: string | null, projectMilestoneId?: string | null, cycleId?: string | null, snoozedUntil?: string | null, autoClosedAt?: string | null, startedAt?: string | null, completedAt?: string | null, canceledAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string } } };

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

export type BulkUpdateIssuesMutationVariables = Exact<{
  input: BulkUpdateIssuesInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type BulkUpdateIssuesMutation = { bulkUpdateIssues: { version: number, skipped: Array<{ id: string, reason: string }> } };

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

export type MergeLabelsMutationVariables = Exact<{
  sourceId: Scalars['UUID']['input'];
  intoId: Scalars['UUID']['input'];
}>;


export type MergeLabelsMutation = { mergeLabels: { version: number, label: { id: string, workspaceId: string, teamId?: string | null, parentId?: string | null, isGroup: boolean, name: string, description?: string | null, color: string, position: string, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

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

export type OauthClientFieldsFragment = { id: string, workspaceId: string, creatorId: string, clientId: string, name: string, description?: string | null, developer?: string | null, developerUrl?: string | null, imageUrl?: string | null, redirectUris: Array<string>, allowedScopes: Array<string>, publicEnabled: boolean, clientCredentialsEnabled: boolean, webhookUrl?: string | null, createdAt: string, updatedAt: string };

export type OauthClientsQueryVariables = Exact<{ [key: string]: never; }>;


export type OauthClientsQuery = { oauthClients: Array<{ id: string, workspaceId: string, creatorId: string, clientId: string, name: string, description?: string | null, developer?: string | null, developerUrl?: string | null, imageUrl?: string | null, redirectUris: Array<string>, allowedScopes: Array<string>, publicEnabled: boolean, clientCredentialsEnabled: boolean, webhookUrl?: string | null, createdAt: string, updatedAt: string }> };

export type OauthClientInfoQueryVariables = Exact<{
  clientId: Scalars['String']['input'];
}>;


export type OauthClientInfoQuery = { oauthClientInfo: { clientId: string, name: string, description?: string | null, developer?: string | null, developerUrl?: string | null, imageUrl?: string | null, allowedScopes: Array<string> } };

export type CreateOauthClientMutationVariables = Exact<{
  input: CreateOauthClientInput;
}>;


export type CreateOauthClientMutation = { createOauthClient: { version: number, created: { clientSecret: string, oauthClient: { id: string, workspaceId: string, creatorId: string, clientId: string, name: string, description?: string | null, developer?: string | null, developerUrl?: string | null, imageUrl?: string | null, redirectUris: Array<string>, allowedScopes: Array<string>, publicEnabled: boolean, clientCredentialsEnabled: boolean, webhookUrl?: string | null, createdAt: string, updatedAt: string } } } };

export type UpdateOauthClientMutationVariables = Exact<{
  input: UpdateOauthClientInput;
}>;


export type UpdateOauthClientMutation = { updateOauthClient: { version: number, oauthClient: { id: string, workspaceId: string, creatorId: string, clientId: string, name: string, description?: string | null, developer?: string | null, developerUrl?: string | null, imageUrl?: string | null, redirectUris: Array<string>, allowedScopes: Array<string>, publicEnabled: boolean, clientCredentialsEnabled: boolean, webhookUrl?: string | null, createdAt: string, updatedAt: string } } };

export type RotateOauthClientSecretMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
}>;


export type RotateOauthClientSecretMutation = { rotateOauthClientSecret: { version: number, clientSecret: string, oauthClient: { id: string, workspaceId: string, creatorId: string, clientId: string, name: string, description?: string | null, developer?: string | null, developerUrl?: string | null, imageUrl?: string | null, redirectUris: Array<string>, allowedScopes: Array<string>, publicEnabled: boolean, clientCredentialsEnabled: boolean, webhookUrl?: string | null, createdAt: string, updatedAt: string } } };

export type DeleteOauthClientMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
}>;


export type DeleteOauthClientMutation = { deleteOauthClient: { version: number, id: string } };

export type CreateOauthAuthorizationMutationVariables = Exact<{
  input: CreateOauthAuthorizationInput;
}>;


export type CreateOauthAuthorizationMutation = { createOauthAuthorization: { redirectUri: string } };

export type ProjectLabelFieldsFragment = { id: string, workspaceId: string, parentId?: string | null, isGroup: boolean, name: string, description?: string | null, color: string, position: string, createdAt: string, updatedAt: string, archivedAt?: string | null };

export type ProjectLabelLinkFieldsFragment = { id: string, workspaceId: string, projectId: string, labelId: string, groupId?: string | null, createdBy?: string | null, createdAt: string };

export type CreateProjectLabelMutationVariables = Exact<{
  input: CreateProjectLabelInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateProjectLabelMutation = { createProjectLabel: { version: number, projectLabel: { id: string, workspaceId: string, parentId?: string | null, isGroup: boolean, name: string, description?: string | null, color: string, position: string, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

export type UpdateProjectLabelMutationVariables = Exact<{
  input: UpdateProjectLabelInput;
}>;


export type UpdateProjectLabelMutation = { updateProjectLabel: { version: number, projectLabel: { id: string, workspaceId: string, parentId?: string | null, isGroup: boolean, name: string, description?: string | null, color: string, position: string, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

export type ArchiveProjectLabelMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  archived: Scalars['Boolean']['input'];
}>;


export type ArchiveProjectLabelMutation = { archiveProjectLabel: { version: number, id: string } };

export type AddProjectLabelMutationVariables = Exact<{
  projectId: Scalars['UUID']['input'];
  labelId: Scalars['UUID']['input'];
}>;


export type AddProjectLabelMutation = { addProjectLabel: { version: number, projectLabelLink: { id: string, workspaceId: string, projectId: string, labelId: string, groupId?: string | null, createdBy?: string | null, createdAt: string } } };

export type RemoveProjectLabelMutationVariables = Exact<{
  projectId: Scalars['UUID']['input'];
  labelId: Scalars['UUID']['input'];
}>;


export type RemoveProjectLabelMutation = { removeProjectLabel: { version: number, id: string } };

export type ProjectTemplateFieldsFragment = { id: string, workspaceId: string, teamId?: string | null, name: string, description?: string | null, summary: string, body: string, properties: unknown, position: string, createdBy?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null };

export type ProjectTemplateMilestoneFieldsFragment = { id: string, workspaceId: string, projectTemplateId: string, name: string, description?: string | null, targetDate?: string | null, sortOrder: string, createdAt: string, updatedAt: string };

export type ProjectTemplateIssueFieldsFragment = { id: string, workspaceId: string, projectTemplateId: string, parentId?: string | null, title: string, description: string, properties: unknown, sortOrder: string, createdAt: string, updatedAt: string };

export type CreateProjectTemplateMutationVariables = Exact<{
  input: CreateProjectTemplateInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateProjectTemplateMutation = { createProjectTemplate: { version: number, template: { id: string, workspaceId: string, teamId?: string | null, name: string, description?: string | null, summary: string, body: string, properties: unknown, position: string, createdBy?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

export type UpdateProjectTemplateMutationVariables = Exact<{
  input: UpdateProjectTemplateInput;
}>;


export type UpdateProjectTemplateMutation = { updateProjectTemplate: { version: number, template: { id: string, workspaceId: string, teamId?: string | null, name: string, description?: string | null, summary: string, body: string, properties: unknown, position: string, createdBy?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

export type ArchiveProjectTemplateMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  archived: Scalars['Boolean']['input'];
}>;


export type ArchiveProjectTemplateMutation = { archiveProjectTemplate: { version: number, id: string } };

export type CreateProjectTemplateMilestoneMutationVariables = Exact<{
  input: CreateProjectTemplateMilestoneInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateProjectTemplateMilestoneMutation = { createProjectTemplateMilestone: { version: number, milestone: { id: string, workspaceId: string, projectTemplateId: string, name: string, description?: string | null, targetDate?: string | null, sortOrder: string, createdAt: string, updatedAt: string } } };

export type UpdateProjectTemplateMilestoneMutationVariables = Exact<{
  input: UpdateProjectTemplateMilestoneInput;
}>;


export type UpdateProjectTemplateMilestoneMutation = { updateProjectTemplateMilestone: { version: number, milestone: { id: string, workspaceId: string, projectTemplateId: string, name: string, description?: string | null, targetDate?: string | null, sortOrder: string, createdAt: string, updatedAt: string } } };

export type DeleteProjectTemplateMilestoneMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
}>;


export type DeleteProjectTemplateMilestoneMutation = { deleteProjectTemplateMilestone: { version: number, id: string } };

export type CreateProjectTemplateIssueMutationVariables = Exact<{
  input: CreateProjectTemplateIssueInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateProjectTemplateIssueMutation = { createProjectTemplateIssue: { version: number, issue: { id: string, workspaceId: string, projectTemplateId: string, parentId?: string | null, title: string, description: string, properties: unknown, sortOrder: string, createdAt: string, updatedAt: string } } };

export type UpdateProjectTemplateIssueMutationVariables = Exact<{
  input: UpdateProjectTemplateIssueInput;
}>;


export type UpdateProjectTemplateIssueMutation = { updateProjectTemplateIssue: { version: number, issue: { id: string, workspaceId: string, projectTemplateId: string, parentId?: string | null, title: string, description: string, properties: unknown, sortOrder: string, createdAt: string, updatedAt: string } } };

export type DeleteProjectTemplateIssueMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
}>;


export type DeleteProjectTemplateIssueMutation = { deleteProjectTemplateIssue: { version: number, id: string } };

export type ProjectUpdateFieldsFragment = { id: string, workspaceId: string, projectId: string, health: ProjectUpdateHealth, body: string, authorId: string, editedAt?: string | null, deletedAt?: string | null, createdAt: string, updatedAt: string };

export type CreateProjectUpdateMutationVariables = Exact<{
  input: CreateProjectUpdateInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateProjectUpdateMutation = { createProjectUpdate: { version: number, projectUpdate: { id: string, workspaceId: string, projectId: string, health: ProjectUpdateHealth, body: string, authorId: string, editedAt?: string | null, deletedAt?: string | null, createdAt: string, updatedAt: string } } };

export type UpdateProjectUpdateMutationVariables = Exact<{
  input: UpdateProjectUpdateInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type UpdateProjectUpdateMutation = { updateProjectUpdate: { version: number, projectUpdate: { id: string, workspaceId: string, projectId: string, health: ProjectUpdateHealth, body: string, authorId: string, editedAt?: string | null, deletedAt?: string | null, createdAt: string, updatedAt: string } } };

export type DeleteProjectUpdateMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type DeleteProjectUpdateMutation = { deleteProjectUpdate: { version: number, id: string } };

export type ProjectStatusFieldsFragment = { id: string, workspaceId: string, name: string, description?: string | null, color: string, category: ProjectStatusCategory, position: string, isDefault: boolean, createdAt: string, updatedAt: string, archivedAt?: string | null };

export type ProjectFieldsFragment = { id: string, workspaceId: string, name: string, summary?: string | null, description: string, icon?: string | null, color: string, statusId: string, priority: number, leadId?: string | null, creatorId?: string | null, sortOrder: string, startDate?: string | null, startDateGranularity?: TimeframeGranularity | null, targetDate?: string | null, targetDateGranularity?: TimeframeGranularity | null, updateSchedule: ProjectUpdateSchedule, updateReminderIntervalDays?: number | null, updateReminderWeekday?: number | null, updateReminderHour?: number | null, archivedAt?: string | null, deletedAt?: string | null, deletedBy?: string | null, projectTemplateId?: string | null, createdAt: string, updatedAt: string };

export type ProjectTeamFieldsFragment = { id: string, workspaceId: string, projectId: string, teamId: string, createdAt: string };

export type ProjectMemberFieldsFragment = { id: string, workspaceId: string, projectId: string, userId: string, createdAt: string };

export type ProjectMilestoneFieldsFragment = { id: string, workspaceId: string, projectId: string, name: string, description?: string | null, targetDate?: string | null, sortOrder: string, createdAt: string, updatedAt: string, archivedAt?: string | null };

export type CreateProjectMutationVariables = Exact<{
  input: CreateProjectInput;
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  opId?: InputMaybe<Scalars['UUID']['input']>;
}>;


export type CreateProjectMutation = { createProject: { version: number, project: { id: string, workspaceId: string, name: string, summary?: string | null, description: string, icon?: string | null, color: string, statusId: string, priority: number, leadId?: string | null, creatorId?: string | null, sortOrder: string, startDate?: string | null, startDateGranularity?: TimeframeGranularity | null, targetDate?: string | null, targetDateGranularity?: TimeframeGranularity | null, updateSchedule: ProjectUpdateSchedule, updateReminderIntervalDays?: number | null, updateReminderWeekday?: number | null, updateReminderHour?: number | null, archivedAt?: string | null, deletedAt?: string | null, deletedBy?: string | null, projectTemplateId?: string | null, createdAt: string, updatedAt: string } } };

export type UpdateProjectMutationVariables = Exact<{
  input: UpdateProjectInput;
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  opId?: InputMaybe<Scalars['UUID']['input']>;
}>;


export type UpdateProjectMutation = { updateProject: { version: number, project: { id: string, workspaceId: string, name: string, summary?: string | null, description: string, icon?: string | null, color: string, statusId: string, priority: number, leadId?: string | null, creatorId?: string | null, sortOrder: string, startDate?: string | null, startDateGranularity?: TimeframeGranularity | null, targetDate?: string | null, targetDateGranularity?: TimeframeGranularity | null, updateSchedule: ProjectUpdateSchedule, updateReminderIntervalDays?: number | null, updateReminderWeekday?: number | null, updateReminderHour?: number | null, archivedAt?: string | null, deletedAt?: string | null, deletedBy?: string | null, projectTemplateId?: string | null, createdAt: string, updatedAt: string } } };

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

export type ProjectDependencyFieldsFragment = { id: string, workspaceId: string, blockingProjectId: string, blockedProjectId: string, createdAt: string };

export type AddProjectDependencyMutationVariables = Exact<{
  blockingProjectId: Scalars['UUID']['input'];
  blockedProjectId: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type AddProjectDependencyMutation = { addProjectDependency: { version: number, projectDependency: { id: string, workspaceId: string, blockingProjectId: string, blockedProjectId: string, createdAt: string } } };

export type RemoveProjectDependencyMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type RemoveProjectDependencyMutation = { removeProjectDependency: { version: number, id: string } };

export type CreateProjectStatusMutationVariables = Exact<{
  input: CreateProjectStatusInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateProjectStatusMutation = { createProjectStatus: { version: number, status: { id: string, workspaceId: string, name: string, description?: string | null, color: string, category: ProjectStatusCategory, position: string, isDefault: boolean, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

export type UpdateProjectStatusMutationVariables = Exact<{
  input: UpdateProjectStatusInput;
}>;


export type UpdateProjectStatusMutation = { updateProjectStatus: { version: number, status: { id: string, workspaceId: string, name: string, description?: string | null, color: string, category: ProjectStatusCategory, position: string, isDefault: boolean, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

export type ArchiveProjectStatusMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  archived: Scalars['Boolean']['input'];
}>;


export type ArchiveProjectStatusMutation = { archiveProjectStatus: { version: number, id: string } };

export type CreateProjectMilestoneMutationVariables = Exact<{
  input: CreateProjectMilestoneInput;
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  opId?: InputMaybe<Scalars['UUID']['input']>;
}>;


export type CreateProjectMilestoneMutation = { createProjectMilestone: { version: number, milestone: { id: string, workspaceId: string, projectId: string, name: string, description?: string | null, targetDate?: string | null, sortOrder: string, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

export type UpdateProjectMilestoneMutationVariables = Exact<{
  input: UpdateProjectMilestoneInput;
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  opId?: InputMaybe<Scalars['UUID']['input']>;
}>;


export type UpdateProjectMilestoneMutation = { updateProjectMilestone: { version: number, milestone: { id: string, workspaceId: string, projectId: string, name: string, description?: string | null, targetDate?: string | null, sortOrder: string, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

export type DeleteProjectMilestoneMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  clientId?: InputMaybe<Scalars['UUID']['input']>;
  opId?: InputMaybe<Scalars['UUID']['input']>;
}>;


export type DeleteProjectMilestoneMutation = { deleteProjectMilestone: { version: number, id: string } };

export type PulseFeedFieldsFragment = { id: string, workspaceId: string, userId: string, name: string, projectIds: Array<string>, createdAt: string, updatedAt: string };

export type CreatePulseFeedMutationVariables = Exact<{
  input: CreatePulseFeedInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreatePulseFeedMutation = { createPulseFeed: { version: number, pulseFeed: { id: string, workspaceId: string, userId: string, name: string, projectIds: Array<string>, createdAt: string, updatedAt: string } } };

export type UpdatePulseFeedMutationVariables = Exact<{
  input: UpdatePulseFeedInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type UpdatePulseFeedMutation = { updatePulseFeed: { version: number, pulseFeed: { id: string, workspaceId: string, userId: string, name: string, projectIds: Array<string>, createdAt: string, updatedAt: string } } };

export type DeletePulseFeedMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type DeletePulseFeedMutation = { deletePulseFeed: { version: number, id: string } };

export type RecurringIssueFieldsFragment = { id: string, workspaceId: string, teamId: string, title: string, body: string, properties: unknown, templateId?: string | null, cadence: RecurringCadence, nextDueDate: string, lastCreatedAt?: string | null, createdBy?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null };

export type CreateRecurringIssueMutationVariables = Exact<{
  input: CreateRecurringIssueInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateRecurringIssueMutation = { createRecurringIssue: { version: number, recurringIssue: { id: string, workspaceId: string, teamId: string, title: string, body: string, properties: unknown, templateId?: string | null, cadence: RecurringCadence, nextDueDate: string, lastCreatedAt?: string | null, createdBy?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

export type UpdateRecurringIssueMutationVariables = Exact<{
  input: UpdateRecurringIssueInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type UpdateRecurringIssueMutation = { updateRecurringIssue: { version: number, recurringIssue: { id: string, workspaceId: string, teamId: string, title: string, body: string, properties: unknown, templateId?: string | null, cadence: RecurringCadence, nextDueDate: string, lastCreatedAt?: string | null, createdBy?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

export type ArchiveRecurringIssueMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  archived: Scalars['Boolean']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type ArchiveRecurringIssueMutation = { archiveRecurringIssue: { version: number, id: string } };

export type SearchQueryVariables = Exact<{
  input: SearchInput;
}>;


export type SearchQuery = { search: { issueCount: number, issues: Array<{ id: string, identifier: string, title: string, priority: number, state: { id: string, name: string, category: StateCategory, color: string }, assignee?: { id: string, displayName: string, avatarUrl?: string | null } | null }>, comments: Array<{ id: string, issueId: string, body: string, createdAt: string }> } };

export type SentryConnectionFieldsFragment = { id: string, workspaceId: string, creatorId: string, enabled: boolean, defaultTeamId: string, organizationSlug?: string | null, connectedAt?: string | null, createdAt: string, updatedAt: string };

export type SentrySettingsQueryVariables = Exact<{ [key: string]: never; }>;


export type SentrySettingsQuery = { sentryWebhook?: { url: string, secret: string } | null };

export type CreateSentryConnectionMutationVariables = Exact<{
  input: CreateSentryConnectionInput;
}>;


export type CreateSentryConnectionMutation = { createSentryConnection: { version: number, sentryConnection: { id: string, workspaceId: string, creatorId: string, enabled: boolean, defaultTeamId: string, organizationSlug?: string | null, connectedAt?: string | null, createdAt: string, updatedAt: string } } };

export type UpdateSentryConnectionMutationVariables = Exact<{
  input: UpdateSentryConnectionInput;
}>;


export type UpdateSentryConnectionMutation = { updateSentryConnection: { version: number, sentryConnection: { id: string, workspaceId: string, creatorId: string, enabled: boolean, defaultTeamId: string, organizationSlug?: string | null, connectedAt?: string | null, createdAt: string, updatedAt: string } } };

export type DeleteSentryConnectionMutationVariables = Exact<{ [key: string]: never; }>;


export type DeleteSentryConnectionMutation = { deleteSentryConnection: { version: number, id: string } };

export type AccountSessionFieldsFragment = { id: string, label: string, userAgent?: string | null, ip?: string | null, country?: string | null, current: boolean, lastSeenAt: string, createdAt: string, expiresAt: string };

export type AccountSessionsQueryVariables = Exact<{ [key: string]: never; }>;


export type AccountSessionsQuery = { accountSessions: Array<{ id: string, label: string, userAgent?: string | null, ip?: string | null, country?: string | null, current: boolean, lastSeenAt: string, createdAt: string, expiresAt: string }> };

export type RevokeAccountSessionMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
}>;


export type RevokeAccountSessionMutation = { revokeAccountSession: { version: number, id: string } };

export type RevokeOtherSessionsMutationVariables = Exact<{ [key: string]: never; }>;


export type RevokeOtherSessionsMutation = { revokeOtherSessions: { version: number, id: string } };

export type SlackConnectionFieldsFragment = { id: string, workspaceId: string, creatorId: string, enabled: boolean, defaultTeamId: string, channelName?: string | null, notifyIssues: boolean, notifyComments: boolean, asksEnabled: boolean, connectedAt?: string | null, createdAt: string, updatedAt: string };

export type SlackInboundQueryVariables = Exact<{ [key: string]: never; }>;


export type SlackInboundQuery = { slackInbound?: { commandUrl: string, eventsUrl: string, webhookConfigured: boolean, signingSecretConfigured: boolean, botTokenConfigured: boolean } | null };

export type CreateSlackConnectionMutationVariables = Exact<{
  input: CreateSlackConnectionInput;
}>;


export type CreateSlackConnectionMutation = { createSlackConnection: { version: number, slackConnection: { id: string, workspaceId: string, creatorId: string, enabled: boolean, defaultTeamId: string, channelName?: string | null, notifyIssues: boolean, notifyComments: boolean, asksEnabled: boolean, connectedAt?: string | null, createdAt: string, updatedAt: string } } };

export type UpdateSlackConnectionMutationVariables = Exact<{
  input: UpdateSlackConnectionInput;
}>;


export type UpdateSlackConnectionMutation = { updateSlackConnection: { version: number, slackConnection: { id: string, workspaceId: string, creatorId: string, enabled: boolean, defaultTeamId: string, channelName?: string | null, notifyIssues: boolean, notifyComments: boolean, asksEnabled: boolean, connectedAt?: string | null, createdAt: string, updatedAt: string } } };

export type DeleteSlackConnectionMutationVariables = Exact<{ [key: string]: never; }>;


export type DeleteSlackConnectionMutation = { deleteSlackConnection: { version: number, id: string } };

export type SlaRuleFieldsFragment = { id: string, workspaceId: string, position: string, filter: unknown, action: SlaAction, durationMinutes?: number | null, createdAt: string, updatedAt: string };

export type CreateSlaRuleMutationVariables = Exact<{
  input: CreateSlaRuleInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateSlaRuleMutation = { createSlaRule: { version: number, slaRule: { id: string, workspaceId: string, position: string, filter: unknown, action: SlaAction, durationMinutes?: number | null, createdAt: string, updatedAt: string } } };

export type UpdateSlaRuleMutationVariables = Exact<{
  input: UpdateSlaRuleInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type UpdateSlaRuleMutation = { updateSlaRule: { version: number, slaRule: { id: string, workspaceId: string, position: string, filter: unknown, action: SlaAction, durationMinutes?: number | null, createdAt: string, updatedAt: string } } };

export type DeleteSlaRuleMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type DeleteSlaRuleMutation = { deleteSlaRule: { version: number, id: string } };

export type SetIssueSlaMutationVariables = Exact<{
  input: SetIssueSlaInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type SetIssueSlaMutation = { setIssueSla: { version: number, issue: { id: string, workspaceId: string, teamId: string, number: number, identifier: string, title: string, description: string, stateId: string, assigneeId?: string | null, creatorId?: string | null, priority: number, sortOrder: string, estimate?: number | null, dueDate?: string | null, dueDateSource: DueDateSource, parentId?: string | null, subIssueSortOrder?: string | null, templateId?: string | null, formTemplateId?: string | null, recurringIssueId?: string | null, projectId?: string | null, projectMilestoneId?: string | null, cycleId?: string | null, snoozedUntil?: string | null, autoClosedAt?: string | null, startedAt?: string | null, completedAt?: string | null, canceledAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string } } };

export type ClearIssueSlaMutationVariables = Exact<{
  issueId: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type ClearIssueSlaMutation = { clearIssueSla: { version: number, issue: { id: string, workspaceId: string, teamId: string, number: number, identifier: string, title: string, description: string, stateId: string, assigneeId?: string | null, creatorId?: string | null, priority: number, sortOrder: string, estimate?: number | null, dueDate?: string | null, dueDateSource: DueDateSource, parentId?: string | null, subIssueSortOrder?: string | null, templateId?: string | null, formTemplateId?: string | null, recurringIssueId?: string | null, projectId?: string | null, projectMilestoneId?: string | null, cycleId?: string | null, snoozedUntil?: string | null, autoClosedAt?: string | null, startedAt?: string | null, completedAt?: string | null, canceledAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string } } };

export type ProjectSubscriptionFieldsFragment = { id: string, workspaceId: string, projectId: string, userId: string, issuesAdded: boolean, issuesCompleted: boolean, updates: boolean, createdAt: string, updatedAt: string };

export type SetProjectSubscriptionMutationVariables = Exact<{
  input: SetProjectSubscriptionInput;
}>;


export type SetProjectSubscriptionMutation = { setProjectSubscription: { version: number, projectSubscription: { id: string, workspaceId: string, projectId: string, userId: string, issuesAdded: boolean, issuesCompleted: boolean, updates: boolean, createdAt: string, updatedAt: string } } };

export type DeleteProjectSubscriptionMutationVariables = Exact<{
  projectId: Scalars['UUID']['input'];
}>;


export type DeleteProjectSubscriptionMutation = { deleteProjectSubscription: { version: number, id: string } };

export type InitiativeSubscriptionFieldsFragment = { id: string, workspaceId: string, initiativeId: string, userId: string, issuesAdded: boolean, issuesCompleted: boolean, updates: boolean, createdAt: string, updatedAt: string };

export type SetInitiativeSubscriptionMutationVariables = Exact<{
  input: SetInitiativeSubscriptionInput;
}>;


export type SetInitiativeSubscriptionMutation = { setInitiativeSubscription: { version: number, initiativeSubscription: { id: string, workspaceId: string, initiativeId: string, userId: string, issuesAdded: boolean, issuesCompleted: boolean, updates: boolean, createdAt: string, updatedAt: string } } };

export type DeleteInitiativeSubscriptionMutationVariables = Exact<{
  initiativeId: Scalars['UUID']['input'];
}>;


export type DeleteInitiativeSubscriptionMutation = { deleteInitiativeSubscription: { version: number, id: string } };

export type CustomerSubscriptionFieldsFragment = { id: string, workspaceId: string, customerId: string, userId: string, requestAdded: boolean, requestImportant: boolean, requestCompleted: boolean, createdAt: string, updatedAt: string };

export type SetCustomerSubscriptionMutationVariables = Exact<{
  input: SetCustomerSubscriptionInput;
}>;


export type SetCustomerSubscriptionMutation = { setCustomerSubscription: { version: number, customerSubscription: { id: string, workspaceId: string, customerId: string, userId: string, requestAdded: boolean, requestImportant: boolean, requestCompleted: boolean, createdAt: string, updatedAt: string } } };

export type DeleteCustomerSubscriptionMutationVariables = Exact<{
  customerId: Scalars['UUID']['input'];
}>;


export type DeleteCustomerSubscriptionMutation = { deleteCustomerSubscription: { version: number, id: string } };

export type DeletedTeamsQueryVariables = Exact<{ [key: string]: never; }>;


export type DeletedTeamsQuery = { deletedTeams: Array<{ deletedAt?: string | null, id: string, workspaceId: string, key: string, name: string, description?: string | null, icon?: string | null, color?: string | null, timezone: string, parentTeamId?: string | null, private: boolean, estimateScale: EstimateScale, estimateAllowZero: boolean, estimateExtended: boolean, cyclesEnabled: boolean, cycleDurationWeeks: number, cycleCooldownWeeks: number, cycleStartDay: string, cycleUpcomingCount: number, cycleAutoAddStarted: boolean, cycleAutoAddCompleted: boolean, triageEnabled: boolean, triageRequirePriority: boolean, autoCloseDays: number, autoArchiveDays: number, autoCloseParent: boolean, autoCloseChildren: boolean, defaultTemplateForMembersId?: string | null, defaultTemplateForNonMembersId?: string | null, emailIntakeEnabled: boolean, emailIntakeAddress?: string | null, createdAt: string, updatedAt: string, retiredAt?: string | null, archivedAt?: string | null }> };

export type RetireTeamMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type RetireTeamMutation = { retireTeam: { version: number, team: { id: string, workspaceId: string, key: string, name: string, description?: string | null, icon?: string | null, color?: string | null, timezone: string, parentTeamId?: string | null, private: boolean, estimateScale: EstimateScale, estimateAllowZero: boolean, estimateExtended: boolean, cyclesEnabled: boolean, cycleDurationWeeks: number, cycleCooldownWeeks: number, cycleStartDay: string, cycleUpcomingCount: number, cycleAutoAddStarted: boolean, cycleAutoAddCompleted: boolean, triageEnabled: boolean, triageRequirePriority: boolean, autoCloseDays: number, autoArchiveDays: number, autoCloseParent: boolean, autoCloseChildren: boolean, defaultTemplateForMembersId?: string | null, defaultTemplateForNonMembersId?: string | null, emailIntakeEnabled: boolean, emailIntakeAddress?: string | null, createdAt: string, updatedAt: string, retiredAt?: string | null, archivedAt?: string | null } } };

export type UnretireTeamMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type UnretireTeamMutation = { unretireTeam: { version: number, team: { id: string, workspaceId: string, key: string, name: string, description?: string | null, icon?: string | null, color?: string | null, timezone: string, parentTeamId?: string | null, private: boolean, estimateScale: EstimateScale, estimateAllowZero: boolean, estimateExtended: boolean, cyclesEnabled: boolean, cycleDurationWeeks: number, cycleCooldownWeeks: number, cycleStartDay: string, cycleUpcomingCount: number, cycleAutoAddStarted: boolean, cycleAutoAddCompleted: boolean, triageEnabled: boolean, triageRequirePriority: boolean, autoCloseDays: number, autoArchiveDays: number, autoCloseParent: boolean, autoCloseChildren: boolean, defaultTemplateForMembersId?: string | null, defaultTemplateForNonMembersId?: string | null, emailIntakeEnabled: boolean, emailIntakeAddress?: string | null, createdAt: string, updatedAt: string, retiredAt?: string | null, archivedAt?: string | null } } };

export type DeleteTeamMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type DeleteTeamMutation = { deleteTeam: { version: number, id: string } };

export type RestoreTeamMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type RestoreTeamMutation = { restoreTeam: { version: number, team: { id: string, workspaceId: string, key: string, name: string, description?: string | null, icon?: string | null, color?: string | null, timezone: string, parentTeamId?: string | null, private: boolean, estimateScale: EstimateScale, estimateAllowZero: boolean, estimateExtended: boolean, cyclesEnabled: boolean, cycleDurationWeeks: number, cycleCooldownWeeks: number, cycleStartDay: string, cycleUpcomingCount: number, cycleAutoAddStarted: boolean, cycleAutoAddCompleted: boolean, triageEnabled: boolean, triageRequirePriority: boolean, autoCloseDays: number, autoArchiveDays: number, autoCloseParent: boolean, autoCloseChildren: boolean, defaultTemplateForMembersId?: string | null, defaultTemplateForNonMembersId?: string | null, emailIntakeEnabled: boolean, emailIntakeAddress?: string | null, createdAt: string, updatedAt: string, retiredAt?: string | null, archivedAt?: string | null } } };

export type MoveTeamMutationVariables = Exact<{
  teamId: Scalars['UUID']['input'];
  parentTeamId?: InputMaybe<Scalars['UUID']['input']>;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type MoveTeamMutation = { moveTeam: { version: number, team: { id: string, workspaceId: string, key: string, name: string, description?: string | null, icon?: string | null, color?: string | null, timezone: string, parentTeamId?: string | null, private: boolean, estimateScale: EstimateScale, estimateAllowZero: boolean, estimateExtended: boolean, cyclesEnabled: boolean, cycleDurationWeeks: number, cycleCooldownWeeks: number, cycleStartDay: string, cycleUpcomingCount: number, cycleAutoAddStarted: boolean, cycleAutoAddCompleted: boolean, triageEnabled: boolean, triageRequirePriority: boolean, autoCloseDays: number, autoArchiveDays: number, autoCloseParent: boolean, autoCloseChildren: boolean, defaultTemplateForMembersId?: string | null, defaultTemplateForNonMembersId?: string | null, emailIntakeEnabled: boolean, emailIntakeAddress?: string | null, createdAt: string, updatedAt: string, retiredAt?: string | null, archivedAt?: string | null } } };

export type AddTeamMemberMutationVariables = Exact<{
  teamId: Scalars['UUID']['input'];
  userId: Scalars['UUID']['input'];
  role?: InputMaybe<TeamRole>;
}>;


export type AddTeamMemberMutation = { addTeamMember: { version: number, membership: { id: string, workspaceId: string, teamId: string, userId: string, role: TeamRole, createdAt: string, updatedAt: string } } };

export type RemoveTeamMemberMutationVariables = Exact<{
  teamId: Scalars['UUID']['input'];
  userId: Scalars['UUID']['input'];
}>;


export type RemoveTeamMemberMutation = { removeTeamMember: { version: number, id: string } };

export type IssueTemplateFieldsFragment = { id: string, workspaceId: string, teamId?: string | null, name: string, description?: string | null, title: string, body: string, properties: unknown, position: string, createdBy?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null, emailIntakeEnabled: boolean, emailIntakeAddress?: string | null, subIssues: Array<{ title: string }> };

export type CreateIssueTemplateMutationVariables = Exact<{
  input: CreateIssueTemplateInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateIssueTemplateMutation = { createIssueTemplate: { version: number, template: { id: string, workspaceId: string, teamId?: string | null, name: string, description?: string | null, title: string, body: string, properties: unknown, position: string, createdBy?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null, emailIntakeEnabled: boolean, emailIntakeAddress?: string | null, subIssues: Array<{ title: string }> } } };

export type UpdateIssueTemplateMutationVariables = Exact<{
  input: UpdateIssueTemplateInput;
}>;


export type UpdateIssueTemplateMutation = { updateIssueTemplate: { version: number, template: { id: string, workspaceId: string, teamId?: string | null, name: string, description?: string | null, title: string, body: string, properties: unknown, position: string, createdBy?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null, emailIntakeEnabled: boolean, emailIntakeAddress?: string | null, subIssues: Array<{ title: string }> } } };

export type ArchiveIssueTemplateMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  archived: Scalars['Boolean']['input'];
}>;


export type ArchiveIssueTemplateMutation = { archiveIssueTemplate: { version: number, id: string } };

export type UpdateIssueTemplateEmailIntakeMutationVariables = Exact<{
  input: UpdateIssueTemplateEmailIntakeInput;
}>;


export type UpdateIssueTemplateEmailIntakeMutation = { updateIssueTemplateEmailIntake: { version: number, template: { id: string, workspaceId: string, teamId?: string | null, name: string, description?: string | null, title: string, body: string, properties: unknown, position: string, createdBy?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null, emailIntakeEnabled: boolean, emailIntakeAddress?: string | null, subIssues: Array<{ title: string }> } } };

export type DeletedIssuesQueryVariables = Exact<{ [key: string]: never; }>;


export type DeletedIssuesQuery = { deletedIssues: Array<{ deletedAt?: string | null, deletedBy?: string | null, id: string, workspaceId: string, teamId: string, number: number, identifier: string, title: string, description: string, stateId: string, assigneeId?: string | null, creatorId?: string | null, priority: number, sortOrder: string, estimate?: number | null, dueDate?: string | null, dueDateSource: DueDateSource, parentId?: string | null, subIssueSortOrder?: string | null, templateId?: string | null, formTemplateId?: string | null, recurringIssueId?: string | null, projectId?: string | null, projectMilestoneId?: string | null, cycleId?: string | null, snoozedUntil?: string | null, autoClosedAt?: string | null, startedAt?: string | null, completedAt?: string | null, canceledAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string }> };

export type RestoreIssueMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type RestoreIssueMutation = { restoreIssue: { version: number, issue: { id: string, workspaceId: string, teamId: string, number: number, identifier: string, title: string, description: string, stateId: string, assigneeId?: string | null, creatorId?: string | null, priority: number, sortOrder: string, estimate?: number | null, dueDate?: string | null, dueDateSource: DueDateSource, parentId?: string | null, subIssueSortOrder?: string | null, templateId?: string | null, formTemplateId?: string | null, recurringIssueId?: string | null, projectId?: string | null, projectMilestoneId?: string | null, cycleId?: string | null, snoozedUntil?: string | null, autoClosedAt?: string | null, startedAt?: string | null, completedAt?: string | null, canceledAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string } } };

export type ViewFieldsFragment = { id: string, workspaceId: string, teamId?: string | null, projectId?: string | null, ownerId?: string | null, name: string, description?: string | null, icon?: string | null, color?: string | null, filter: unknown, display: unknown, position: string, createdBy?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null };

export type ViewPreferenceFieldsFragment = { id: string, workspaceId: string, userId: string, viewKey: string, display: unknown, createdAt: string, updatedAt: string };

export type FavoriteFieldsFragment = { id: string, workspaceId: string, userId: string, kind: FavoriteKind, targetId: string, folderId?: string | null, name?: string | null, position: string, createdAt: string, updatedAt: string };

export type CreateViewMutationVariables = Exact<{
  input: CreateViewInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateViewMutation = { createView: { version: number, view: { id: string, workspaceId: string, teamId?: string | null, projectId?: string | null, ownerId?: string | null, name: string, description?: string | null, icon?: string | null, color?: string | null, filter: unknown, display: unknown, position: string, createdBy?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

export type UpdateViewMutationVariables = Exact<{
  input: UpdateViewInput;
}>;


export type UpdateViewMutation = { updateView: { version: number, view: { id: string, workspaceId: string, teamId?: string | null, projectId?: string | null, ownerId?: string | null, name: string, description?: string | null, icon?: string | null, color?: string | null, filter: unknown, display: unknown, position: string, createdBy?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

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


export type AddFavoriteMutation = { addFavorite: { version: number, favorite: { id: string, workspaceId: string, userId: string, kind: FavoriteKind, targetId: string, folderId?: string | null, name?: string | null, position: string, createdAt: string, updatedAt: string } } };

export type RemoveFavoriteMutationVariables = Exact<{
  kind: FavoriteKind;
  targetId: Scalars['UUID']['input'];
}>;


export type RemoveFavoriteMutation = { removeFavorite: { version: number, id: string } };

export type CreateFavoriteFolderMutationVariables = Exact<{
  name: Scalars['String']['input'];
  afterFavoriteId?: InputMaybe<Scalars['UUID']['input']>;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateFavoriteFolderMutation = { createFavoriteFolder: { version: number, favorite: { id: string, workspaceId: string, userId: string, kind: FavoriteKind, targetId: string, folderId?: string | null, name?: string | null, position: string, createdAt: string, updatedAt: string } } };

export type UpdateFavoriteFolderMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  name: Scalars['String']['input'];
}>;


export type UpdateFavoriteFolderMutation = { updateFavoriteFolder: { version: number, favorite: { id: string, workspaceId: string, userId: string, kind: FavoriteKind, targetId: string, folderId?: string | null, name?: string | null, position: string, createdAt: string, updatedAt: string } } };

export type MoveFavoriteMutationVariables = Exact<{
  input: MoveFavoriteInput;
}>;


export type MoveFavoriteMutation = { moveFavorite: { version: number, favorite: { id: string, workspaceId: string, userId: string, kind: FavoriteKind, targetId: string, folderId?: string | null, name?: string | null, position: string, createdAt: string, updatedAt: string } } };

export type ViewSubscriptionFieldsFragment = { id: string, workspaceId: string, viewId: string, userId: string, added: boolean, completed: boolean, createdAt: string, updatedAt: string };

export type SetViewSubscriptionMutationVariables = Exact<{
  input: SetViewSubscriptionInput;
}>;


export type SetViewSubscriptionMutation = { setViewSubscription: { version: number, viewSubscription: { id: string, workspaceId: string, viewId: string, userId: string, added: boolean, completed: boolean, createdAt: string, updatedAt: string } } };

export type DeleteViewSubscriptionMutationVariables = Exact<{
  viewId: Scalars['UUID']['input'];
}>;


export type DeleteViewSubscriptionMutation = { deleteViewSubscription: { version: number, id: string } };

export type WebhookSummaryFragment = { id: string, url: string, enabled: boolean, allPublicTeams: boolean, teamId?: string | null, resourceTypes: Array<string>, consecutiveFailures: number, disabledAt?: string | null, createdAt: string };

export type WebhooksQueryVariables = Exact<{ [key: string]: never; }>;


export type WebhooksQuery = { webhooks: Array<{ id: string, url: string, enabled: boolean, allPublicTeams: boolean, teamId?: string | null, resourceTypes: Array<string>, consecutiveFailures: number, disabledAt?: string | null, createdAt: string }> };

export type WebhookDeliveriesQueryVariables = Exact<{
  webhookId: Scalars['UUID']['input'];
}>;


export type WebhookDeliveriesQuery = { webhookDeliveries: Array<{ id: string, attempt: number, lastStatus?: number | null, lastError?: string | null, deliveredAt?: string | null, createdAt: string, entityType: string }> };

export type CreateWebhookMutationVariables = Exact<{
  input: CreateWebhookInput;
}>;


export type CreateWebhookMutation = { createWebhook: { version: number, created: { secret: string, webhook: { id: string, url: string, enabled: boolean, allPublicTeams: boolean, teamId?: string | null, resourceTypes: Array<string>, consecutiveFailures: number, disabledAt?: string | null, createdAt: string } } } };

export type UpdateWebhookMutationVariables = Exact<{
  input: UpdateWebhookInput;
}>;


export type UpdateWebhookMutation = { updateWebhook: { version: number, webhook: { id: string, url: string, enabled: boolean, allPublicTeams: boolean, teamId?: string | null, resourceTypes: Array<string>, consecutiveFailures: number, disabledAt?: string | null, createdAt: string } } };

export type DeleteWebhookMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
}>;


export type DeleteWebhookMutation = { deleteWebhook: { version: number, id: string } };

export type WorkspaceFieldsFragment = { id: string, name: string, urlKey: string, logoUrl?: string | null, plan: string, planExpiresAt?: string | null, planLapsedAt?: string | null, seatLimit?: number | null, projectUpdateReminderIntervalDays: number, projectUpdateReminderWeekday: number, projectUpdateReminderHour: number, pulseEnabled: boolean, pulseDigestCadence: PulseDigestCadence, customerRequestsEnabled: boolean, customerDefaultTeamId?: string | null, customerRevenueUnit: string, customerTiers: Array<string>, createdAt: string, updatedAt: string, archivedAt?: string | null };

export type UpdateWorkspaceMutationVariables = Exact<{
  input: UpdateWorkspaceInput;
}>;


export type UpdateWorkspaceMutation = { updateWorkspace: { version: number, workspace: { id: string, name: string, urlKey: string, logoUrl?: string | null, plan: string, planExpiresAt?: string | null, planLapsedAt?: string | null, seatLimit?: number | null, projectUpdateReminderIntervalDays: number, projectUpdateReminderWeekday: number, projectUpdateReminderHour: number, pulseEnabled: boolean, pulseDigestCadence: PulseDigestCadence, customerRequestsEnabled: boolean, customerDefaultTeamId?: string | null, customerRevenueUnit: string, customerTiers: Array<string>, createdAt: string, updatedAt: string, archivedAt?: string | null } } };

export type IssueFieldsFragment = { id: string, workspaceId: string, teamId: string, number: number, identifier: string, title: string, description: string, stateId: string, assigneeId?: string | null, creatorId?: string | null, priority: number, sortOrder: string, estimate?: number | null, dueDate?: string | null, dueDateSource: DueDateSource, parentId?: string | null, subIssueSortOrder?: string | null, templateId?: string | null, formTemplateId?: string | null, recurringIssueId?: string | null, projectId?: string | null, projectMilestoneId?: string | null, cycleId?: string | null, snoozedUntil?: string | null, autoClosedAt?: string | null, startedAt?: string | null, completedAt?: string | null, canceledAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string };

export type TeamFieldsFragment = { id: string, workspaceId: string, key: string, name: string, description?: string | null, icon?: string | null, color?: string | null, timezone: string, parentTeamId?: string | null, private: boolean, estimateScale: EstimateScale, estimateAllowZero: boolean, estimateExtended: boolean, cyclesEnabled: boolean, cycleDurationWeeks: number, cycleCooldownWeeks: number, cycleStartDay: string, cycleUpcomingCount: number, cycleAutoAddStarted: boolean, cycleAutoAddCompleted: boolean, triageEnabled: boolean, triageRequirePriority: boolean, autoCloseDays: number, autoArchiveDays: number, autoCloseParent: boolean, autoCloseChildren: boolean, defaultTemplateForMembersId?: string | null, defaultTemplateForNonMembersId?: string | null, emailIntakeEnabled: boolean, emailIntakeAddress?: string | null, createdAt: string, updatedAt: string, retiredAt?: string | null, archivedAt?: string | null };

export type StateFieldsFragment = { id: string, workspaceId: string, teamId: string, name: string, description?: string | null, color: string, category: StateCategory, position: string, isDefault: boolean, isSystem: boolean, createdAt: string, updatedAt: string, archivedAt?: string | null };

export type UserFieldsFragment = { id: string, workspaceId: string, name: string, displayName: string, avatarUrl?: string | null, timezone: string, role: UserRole, status: UserStatus, kind: UserKind, email?: string | null, notificationPrefs?: unknown | null, lastSeenAt?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null };

export type CommentFieldsFragment = { id: string, workspaceId: string, issueId: string, parentId?: string | null, body: string, editedAt?: string | null, resolvedAt?: string | null, resolvedBy?: string | null, anchorStart?: number | null, anchorEnd?: number | null, quote?: string | null, createdAt: string, updatedAt: string, actor: { type: ActorType, id?: string | null } };

export type ReactionFieldsFragment = { id: string, workspaceId: string, commentId: string, userId: string, emoji: string, createdAt: string };

export type AddReactionMutationVariables = Exact<{
  commentId: Scalars['UUID']['input'];
  emoji: Scalars['String']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type AddReactionMutation = { addReaction: { version: number, reaction: { id: string, workspaceId: string, commentId: string, userId: string, emoji: string, createdAt: string } } };

export type RemoveReactionMutationVariables = Exact<{
  commentId: Scalars['UUID']['input'];
  emoji: Scalars['String']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type RemoveReactionMutation = { removeReaction: { version: number, id: string } };

export type AttachmentFieldsFragment = { id: string, workspaceId: string, issueId: string, teamId: string, url: string, title: string, subtitle?: string | null, iconUrl?: string | null, metadata?: unknown | null, creatorId?: string | null, createdAt: string, updatedAt: string };

export type ViewerQueryVariables = Exact<{ [key: string]: never; }>;


export type ViewerQuery = { viewer: { syncVersion: number, user: { id: string, workspaceId: string, name: string, displayName: string, avatarUrl?: string | null, timezone: string, role: UserRole, status: UserStatus, kind: UserKind, email?: string | null, notificationPrefs?: unknown | null, lastSeenAt?: string | null, createdAt: string, updatedAt: string, archivedAt?: string | null }, workspace: { id: string, name: string, urlKey: string, logoUrl?: string | null, plan: string, createdAt: string, updatedAt: string }, workspaces: Array<{ id: string, name: string, urlKey: string, logoUrl?: string | null, plan: string, createdAt: string, updatedAt: string }> } };

export type IssueDetailQueryVariables = Exact<{
  id: Scalars['UUID']['input'];
}>;


export type IssueDetailQuery = { comments: Array<{ id: string, workspaceId: string, issueId: string, parentId?: string | null, body: string, editedAt?: string | null, resolvedAt?: string | null, resolvedBy?: string | null, anchorStart?: number | null, anchorEnd?: number | null, quote?: string | null, createdAt: string, updatedAt: string, actor: { type: ActorType, id?: string | null } }>, issueHistory: Array<{ id: string, issueId: string, kind: string, fromValue?: unknown | null, toValue?: unknown | null, createdAt: string, actor: { type: ActorType, id?: string | null } }> };

export type CreateIssueMutationVariables = Exact<{
  input: CreateIssueInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateIssueMutation = { createIssue: { version: number, issue: { id: string, workspaceId: string, teamId: string, number: number, identifier: string, title: string, description: string, stateId: string, assigneeId?: string | null, creatorId?: string | null, priority: number, sortOrder: string, estimate?: number | null, dueDate?: string | null, dueDateSource: DueDateSource, parentId?: string | null, subIssueSortOrder?: string | null, templateId?: string | null, formTemplateId?: string | null, recurringIssueId?: string | null, projectId?: string | null, projectMilestoneId?: string | null, cycleId?: string | null, snoozedUntil?: string | null, autoClosedAt?: string | null, startedAt?: string | null, completedAt?: string | null, canceledAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string } } };

export type UpdateIssueMutationVariables = Exact<{
  input: UpdateIssueInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type UpdateIssueMutation = { updateIssue: { version: number, issue: { id: string, workspaceId: string, teamId: string, number: number, identifier: string, title: string, description: string, stateId: string, assigneeId?: string | null, creatorId?: string | null, priority: number, sortOrder: string, estimate?: number | null, dueDate?: string | null, dueDateSource: DueDateSource, parentId?: string | null, subIssueSortOrder?: string | null, templateId?: string | null, formTemplateId?: string | null, recurringIssueId?: string | null, projectId?: string | null, projectMilestoneId?: string | null, cycleId?: string | null, snoozedUntil?: string | null, autoClosedAt?: string | null, startedAt?: string | null, completedAt?: string | null, canceledAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string } } };

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


export type CreateCommentMutation = { createComment: { version: number, comment: { id: string, workspaceId: string, issueId: string, parentId?: string | null, body: string, editedAt?: string | null, resolvedAt?: string | null, resolvedBy?: string | null, anchorStart?: number | null, anchorEnd?: number | null, quote?: string | null, createdAt: string, updatedAt: string, actor: { type: ActorType, id?: string | null } } } };

export type UpdateCommentMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  body: Scalars['String']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type UpdateCommentMutation = { updateComment: { version: number, comment: { id: string, workspaceId: string, issueId: string, parentId?: string | null, body: string, editedAt?: string | null, resolvedAt?: string | null, resolvedBy?: string | null, anchorStart?: number | null, anchorEnd?: number | null, quote?: string | null, createdAt: string, updatedAt: string, actor: { type: ActorType, id?: string | null } } } };

export type DeleteCommentMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type DeleteCommentMutation = { deleteComment: { version: number, id: string } };

export type ResolveCommentMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  resolved: Scalars['Boolean']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type ResolveCommentMutation = { resolveComment: { version: number, comment: { id: string, workspaceId: string, issueId: string, parentId?: string | null, body: string, editedAt?: string | null, resolvedAt?: string | null, resolvedBy?: string | null, anchorStart?: number | null, anchorEnd?: number | null, quote?: string | null, createdAt: string, updatedAt: string, actor: { type: ActorType, id?: string | null } } } };

export type CreateAttachmentMutationVariables = Exact<{
  input: CreateAttachmentInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateAttachmentMutation = { createAttachment: { version: number, attachment: { id: string, workspaceId: string, issueId: string, teamId: string, url: string, title: string, subtitle?: string | null, iconUrl?: string | null, metadata?: unknown | null, creatorId?: string | null, createdAt: string, updatedAt: string } } };

export type UpdateAttachmentMutationVariables = Exact<{
  input: UpdateAttachmentInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type UpdateAttachmentMutation = { updateAttachment: { version: number, attachment: { id: string, workspaceId: string, issueId: string, teamId: string, url: string, title: string, subtitle?: string | null, iconUrl?: string | null, metadata?: unknown | null, creatorId?: string | null, createdAt: string, updatedAt: string } } };

export type DeleteAttachmentMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type DeleteAttachmentMutation = { deleteAttachment: { version: number, id: string } };

export type CreateTeamMutationVariables = Exact<{
  input: CreateTeamInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type CreateTeamMutation = { createTeam: { version: number, team: { id: string, workspaceId: string, key: string, name: string, description?: string | null, icon?: string | null, color?: string | null, timezone: string, parentTeamId?: string | null, private: boolean, estimateScale: EstimateScale, estimateAllowZero: boolean, estimateExtended: boolean, cyclesEnabled: boolean, cycleDurationWeeks: number, cycleCooldownWeeks: number, cycleStartDay: string, cycleUpcomingCount: number, cycleAutoAddStarted: boolean, cycleAutoAddCompleted: boolean, triageEnabled: boolean, triageRequirePriority: boolean, autoCloseDays: number, autoArchiveDays: number, autoCloseParent: boolean, autoCloseChildren: boolean, defaultTemplateForMembersId?: string | null, defaultTemplateForNonMembersId?: string | null, emailIntakeEnabled: boolean, emailIntakeAddress?: string | null, createdAt: string, updatedAt: string, retiredAt?: string | null, archivedAt?: string | null, states: Array<{ id: string, workspaceId: string, teamId: string, name: string, description?: string | null, color: string, category: StateCategory, position: string, isDefault: boolean, isSystem: boolean, createdAt: string, updatedAt: string, archivedAt?: string | null }> } } };

export type UpdateTeamMutationVariables = Exact<{
  input: UpdateTeamInput;
}>;


export type UpdateTeamMutation = { updateTeam: { version: number, team: { id: string, workspaceId: string, key: string, name: string, description?: string | null, icon?: string | null, color?: string | null, timezone: string, parentTeamId?: string | null, private: boolean, estimateScale: EstimateScale, estimateAllowZero: boolean, estimateExtended: boolean, cyclesEnabled: boolean, cycleDurationWeeks: number, cycleCooldownWeeks: number, cycleStartDay: string, cycleUpcomingCount: number, cycleAutoAddStarted: boolean, cycleAutoAddCompleted: boolean, triageEnabled: boolean, triageRequirePriority: boolean, autoCloseDays: number, autoArchiveDays: number, autoCloseParent: boolean, autoCloseChildren: boolean, defaultTemplateForMembersId?: string | null, defaultTemplateForNonMembersId?: string | null, emailIntakeEnabled: boolean, emailIntakeAddress?: string | null, createdAt: string, updatedAt: string, retiredAt?: string | null, archivedAt?: string | null } } };

export type CycleFieldsFragment = { id: string, workspaceId: string, teamId: string, number: number, name: string, description?: string | null, startsAt: string, endsAt: string, completedAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string };

export type UpdateTeamCyclesMutationVariables = Exact<{
  input: UpdateTeamCyclesInput;
}>;


export type UpdateTeamCyclesMutation = { updateTeamCycles: { version: number, team: { id: string, workspaceId: string, key: string, name: string, description?: string | null, icon?: string | null, color?: string | null, timezone: string, parentTeamId?: string | null, private: boolean, estimateScale: EstimateScale, estimateAllowZero: boolean, estimateExtended: boolean, cyclesEnabled: boolean, cycleDurationWeeks: number, cycleCooldownWeeks: number, cycleStartDay: string, cycleUpcomingCount: number, cycleAutoAddStarted: boolean, cycleAutoAddCompleted: boolean, triageEnabled: boolean, triageRequirePriority: boolean, autoCloseDays: number, autoArchiveDays: number, autoCloseParent: boolean, autoCloseChildren: boolean, defaultTemplateForMembersId?: string | null, defaultTemplateForNonMembersId?: string | null, emailIntakeEnabled: boolean, emailIntakeAddress?: string | null, createdAt: string, updatedAt: string, retiredAt?: string | null, archivedAt?: string | null } } };

export type UpdateTeamTriageMutationVariables = Exact<{
  input: UpdateTeamTriageInput;
}>;


export type UpdateTeamTriageMutation = { updateTeamTriage: { version: number, team: { id: string, workspaceId: string, key: string, name: string, description?: string | null, icon?: string | null, color?: string | null, timezone: string, parentTeamId?: string | null, private: boolean, estimateScale: EstimateScale, estimateAllowZero: boolean, estimateExtended: boolean, cyclesEnabled: boolean, cycleDurationWeeks: number, cycleCooldownWeeks: number, cycleStartDay: string, cycleUpcomingCount: number, cycleAutoAddStarted: boolean, cycleAutoAddCompleted: boolean, triageEnabled: boolean, triageRequirePriority: boolean, autoCloseDays: number, autoArchiveDays: number, autoCloseParent: boolean, autoCloseChildren: boolean, defaultTemplateForMembersId?: string | null, defaultTemplateForNonMembersId?: string | null, emailIntakeEnabled: boolean, emailIntakeAddress?: string | null, createdAt: string, updatedAt: string, retiredAt?: string | null, archivedAt?: string | null } } };

export type UpdateTeamEmailIntakeMutationVariables = Exact<{
  input: UpdateTeamEmailIntakeInput;
}>;


export type UpdateTeamEmailIntakeMutation = { updateTeamEmailIntake: { version: number, team: { id: string, workspaceId: string, key: string, name: string, description?: string | null, icon?: string | null, color?: string | null, timezone: string, parentTeamId?: string | null, private: boolean, estimateScale: EstimateScale, estimateAllowZero: boolean, estimateExtended: boolean, cyclesEnabled: boolean, cycleDurationWeeks: number, cycleCooldownWeeks: number, cycleStartDay: string, cycleUpcomingCount: number, cycleAutoAddStarted: boolean, cycleAutoAddCompleted: boolean, triageEnabled: boolean, triageRequirePriority: boolean, autoCloseDays: number, autoArchiveDays: number, autoCloseParent: boolean, autoCloseChildren: boolean, defaultTemplateForMembersId?: string | null, defaultTemplateForNonMembersId?: string | null, emailIntakeEnabled: boolean, emailIntakeAddress?: string | null, createdAt: string, updatedAt: string, retiredAt?: string | null, archivedAt?: string | null } } };

export type UpdateTeamArchiveMutationVariables = Exact<{
  input: UpdateTeamArchiveInput;
}>;


export type UpdateTeamArchiveMutation = { updateTeamArchive: { version: number, team: { id: string, workspaceId: string, key: string, name: string, description?: string | null, icon?: string | null, color?: string | null, timezone: string, parentTeamId?: string | null, private: boolean, estimateScale: EstimateScale, estimateAllowZero: boolean, estimateExtended: boolean, cyclesEnabled: boolean, cycleDurationWeeks: number, cycleCooldownWeeks: number, cycleStartDay: string, cycleUpcomingCount: number, cycleAutoAddStarted: boolean, cycleAutoAddCompleted: boolean, triageEnabled: boolean, triageRequirePriority: boolean, autoCloseDays: number, autoArchiveDays: number, autoCloseParent: boolean, autoCloseChildren: boolean, defaultTemplateForMembersId?: string | null, defaultTemplateForNonMembersId?: string | null, emailIntakeEnabled: boolean, emailIntakeAddress?: string | null, createdAt: string, updatedAt: string, retiredAt?: string | null, archivedAt?: string | null } } };

export type UpdateTeamTemplatesMutationVariables = Exact<{
  input: UpdateTeamTemplatesInput;
}>;


export type UpdateTeamTemplatesMutation = { updateTeamTemplates: { version: number, team: { id: string, workspaceId: string, key: string, name: string, description?: string | null, icon?: string | null, color?: string | null, timezone: string, parentTeamId?: string | null, private: boolean, estimateScale: EstimateScale, estimateAllowZero: boolean, estimateExtended: boolean, cyclesEnabled: boolean, cycleDurationWeeks: number, cycleCooldownWeeks: number, cycleStartDay: string, cycleUpcomingCount: number, cycleAutoAddStarted: boolean, cycleAutoAddCompleted: boolean, triageEnabled: boolean, triageRequirePriority: boolean, autoCloseDays: number, autoArchiveDays: number, autoCloseParent: boolean, autoCloseChildren: boolean, defaultTemplateForMembersId?: string | null, defaultTemplateForNonMembersId?: string | null, emailIntakeEnabled: boolean, emailIntakeAddress?: string | null, createdAt: string, updatedAt: string, retiredAt?: string | null, archivedAt?: string | null } } };

export type AcceptTriageIssueMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type AcceptTriageIssueMutation = { acceptTriageIssue: { version: number, issue: { id: string, workspaceId: string, teamId: string, number: number, identifier: string, title: string, description: string, stateId: string, assigneeId?: string | null, creatorId?: string | null, priority: number, sortOrder: string, estimate?: number | null, dueDate?: string | null, dueDateSource: DueDateSource, parentId?: string | null, subIssueSortOrder?: string | null, templateId?: string | null, formTemplateId?: string | null, recurringIssueId?: string | null, projectId?: string | null, projectMilestoneId?: string | null, cycleId?: string | null, snoozedUntil?: string | null, autoClosedAt?: string | null, startedAt?: string | null, completedAt?: string | null, canceledAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string } } };

export type DeclineTriageIssueMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type DeclineTriageIssueMutation = { declineTriageIssue: { version: number, issue: { id: string, workspaceId: string, teamId: string, number: number, identifier: string, title: string, description: string, stateId: string, assigneeId?: string | null, creatorId?: string | null, priority: number, sortOrder: string, estimate?: number | null, dueDate?: string | null, dueDateSource: DueDateSource, parentId?: string | null, subIssueSortOrder?: string | null, templateId?: string | null, formTemplateId?: string | null, recurringIssueId?: string | null, projectId?: string | null, projectMilestoneId?: string | null, cycleId?: string | null, snoozedUntil?: string | null, autoClosedAt?: string | null, startedAt?: string | null, completedAt?: string | null, canceledAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string } } };

export type MarkIssueDuplicateMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  canonicalId: Scalars['UUID']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type MarkIssueDuplicateMutation = { markIssueDuplicate: { version: number, issue: { id: string, workspaceId: string, teamId: string, number: number, identifier: string, title: string, description: string, stateId: string, assigneeId?: string | null, creatorId?: string | null, priority: number, sortOrder: string, estimate?: number | null, dueDate?: string | null, dueDateSource: DueDateSource, parentId?: string | null, subIssueSortOrder?: string | null, templateId?: string | null, formTemplateId?: string | null, recurringIssueId?: string | null, projectId?: string | null, projectMilestoneId?: string | null, cycleId?: string | null, snoozedUntil?: string | null, autoClosedAt?: string | null, startedAt?: string | null, completedAt?: string | null, canceledAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string } } };

export type SnoozeIssueMutationVariables = Exact<{
  id: Scalars['UUID']['input'];
  until: Scalars['Time']['input'];
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
}>;


export type SnoozeIssueMutation = { snoozeIssue: { version: number, issue: { id: string, workspaceId: string, teamId: string, number: number, identifier: string, title: string, description: string, stateId: string, assigneeId?: string | null, creatorId?: string | null, priority: number, sortOrder: string, estimate?: number | null, dueDate?: string | null, dueDateSource: DueDateSource, parentId?: string | null, subIssueSortOrder?: string | null, templateId?: string | null, formTemplateId?: string | null, recurringIssueId?: string | null, projectId?: string | null, projectMilestoneId?: string | null, cycleId?: string | null, snoozedUntil?: string | null, autoClosedAt?: string | null, startedAt?: string | null, completedAt?: string | null, canceledAt?: string | null, archivedAt?: string | null, createdAt: string, updatedAt: string } } };

export type CreateWorkflowStateMutationVariables = Exact<{
  input: CreateWorkflowStateInput;
  clientId: Scalars['UUID']['input'];
  opId: Scalars['UUID']['input'];
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
export const AskFormFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AskFormFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AskForm"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"token"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<AskFormFieldsFragment, unknown>;
export const AuthorisedOauthAppFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AuthorisedOauthAppFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AuthorisedOauthApp"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"clientId"}},{"kind":"Field","name":{"kind":"Name","value":"imageUrl"}},{"kind":"Field","name":{"kind":"Name","value":"developer"}},{"kind":"Field","name":{"kind":"Name","value":"scopes"}},{"kind":"Field","name":{"kind":"Name","value":"lastUsedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<AuthorisedOauthAppFieldsFragment, unknown>;
export const CustomerFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CustomerFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Customer"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"domains"}},{"kind":"Field","name":{"kind":"Name","value":"revenue"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"tier"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"logoUrl"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CustomerFieldsFragment, unknown>;
export const CustomerRequestFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CustomerRequestFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"CustomerRequest"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"customerId"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"important"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CustomerRequestFieldsFragment, unknown>;
export const DashboardFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"DashboardFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Dashboard"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"filter"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<DashboardFieldsFragment, unknown>;
export const DashboardTileFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"DashboardTileFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"DashboardTile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"dashboardId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"measure"}},{"kind":"Field","name":{"kind":"Name","value":"slice"}},{"kind":"Field","name":{"kind":"Name","value":"display"}},{"kind":"Field","name":{"kind":"Name","value":"filter"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<DashboardTileFieldsFragment, unknown>;
export const DocumentFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"DocumentFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Document"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"updatedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}}]}}]} as unknown as DocumentNode<DocumentFieldsFragment, unknown>;
export const DraftFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"DraftFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Draft"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<DraftFieldsFragment, unknown>;
export const FormTemplateFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"FormTemplateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"FormTemplate"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"properties"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<FormTemplateFieldsFragment, unknown>;
export const FormTemplateFieldFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"FormTemplateFieldFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"FormTemplateField"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"formTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"fieldType"}},{"kind":"Field","name":{"kind":"Name","value":"label"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"required"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"config"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<FormTemplateFieldFieldsFragment, unknown>;
export const GitHubConnectionFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"GitHubConnectionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GitHubConnection"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"orgLogin"}},{"kind":"Field","name":{"kind":"Name","value":"branchNameFormat"}},{"kind":"Field","name":{"kind":"Name","value":"linkCommits"}},{"kind":"Field","name":{"kind":"Name","value":"linkbacks"}},{"kind":"Field","name":{"kind":"Name","value":"connectedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<GitHubConnectionFieldsFragment, unknown>;
export const GitHubUserLinkFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"GitHubUserLinkFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GitHubUserLink"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"githubLogin"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<GitHubUserLinkFieldsFragment, unknown>;
export const GitHubTeamAutomationFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"GitHubTeamAutomationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GitHubTeamAutomation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"configured"}},{"kind":"Field","name":{"kind":"Name","value":"draftedStateId"}},{"kind":"Field","name":{"kind":"Name","value":"openedStateId"}},{"kind":"Field","name":{"kind":"Name","value":"reviewRequestedStateId"}},{"kind":"Field","name":{"kind":"Name","value":"readyForMergeStateId"}},{"kind":"Field","name":{"kind":"Name","value":"mergedStateId"}}]}}]} as unknown as DocumentNode<GitHubTeamAutomationFieldsFragment, unknown>;
export const GitLabConnectionFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"GitLabConnectionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GitLabConnection"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"instanceUrl"}},{"kind":"Field","name":{"kind":"Name","value":"branchNameFormat"}},{"kind":"Field","name":{"kind":"Name","value":"linkCommits"}},{"kind":"Field","name":{"kind":"Name","value":"linkbacks"}},{"kind":"Field","name":{"kind":"Name","value":"connectedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<GitLabConnectionFieldsFragment, unknown>;
export const GitLabUserLinkFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"GitLabUserLinkFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GitLabUserLink"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"gitlabUsername"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<GitLabUserLinkFieldsFragment, unknown>;
export const GitLabTeamAutomationFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"GitLabTeamAutomationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GitLabTeamAutomation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"configured"}},{"kind":"Field","name":{"kind":"Name","value":"draftedStateId"}},{"kind":"Field","name":{"kind":"Name","value":"openedStateId"}},{"kind":"Field","name":{"kind":"Name","value":"reviewRequestedStateId"}},{"kind":"Field","name":{"kind":"Name","value":"readyForMergeStateId"}},{"kind":"Field","name":{"kind":"Name","value":"mergedStateId"}}]}}]} as unknown as DocumentNode<GitLabTeamAutomationFieldsFragment, unknown>;
export const NotificationFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"NotificationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Notification"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"commentId"}},{"kind":"Field","name":{"kind":"Name","value":"actor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"changeVersion"}},{"kind":"Field","name":{"kind":"Name","value":"groupKey"}},{"kind":"Field","name":{"kind":"Name","value":"count"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}},{"kind":"Field","name":{"kind":"Name","value":"readAt"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<NotificationFieldsFragment, unknown>;
export const InitiativeLabelFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"InitiativeLabelFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"InitiativeLabel"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"isGroup"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<InitiativeLabelFieldsFragment, unknown>;
export const InitiativeLabelLinkFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"InitiativeLabelLinkFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"InitiativeLabelLink"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"initiativeId"}},{"kind":"Field","name":{"kind":"Name","value":"labelId"}},{"kind":"Field","name":{"kind":"Name","value":"groupId"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<InitiativeLabelLinkFieldsFragment, unknown>;
export const InitiativeUpdateFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"InitiativeUpdateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"InitiativeUpdate"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"initiativeId"}},{"kind":"Field","name":{"kind":"Name","value":"health"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"authorId"}},{"kind":"Field","name":{"kind":"Name","value":"editedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<InitiativeUpdateFieldsFragment, unknown>;
export const InitiativeFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"InitiativeFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Initiative"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"leadTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"targetDate"}},{"kind":"Field","name":{"kind":"Name","value":"targetDateGranularity"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<InitiativeFieldsFragment, unknown>;
export const InitiativeProjectFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"InitiativeProjectFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"InitiativeProject"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"initiativeId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<InitiativeProjectFieldsFragment, unknown>;
export const InitiativeRelationFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"InitiativeRelationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"InitiativeRelation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"parentInitiativeId"}},{"kind":"Field","name":{"kind":"Name","value":"childInitiativeId"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<InitiativeRelationFieldsFragment, unknown>;
export const SubIssueFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SubIssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Issue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"stateId"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"estimate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDateSource"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"subIssueSortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"formTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"recurringIssueId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"projectMilestoneId"}},{"kind":"Field","name":{"kind":"Name","value":"cycleId"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"autoClosedAt"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"canceledAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<SubIssueFieldsFragment, unknown>;
export const RelationFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"RelationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IssueRelation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"relatedIssueId"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"relatedTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<RelationFieldsFragment, unknown>;
export const SubscriptionFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SubscriptionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IssueSubscription"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"reason"}},{"kind":"Field","name":{"kind":"Name","value":"unsubscribed"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<SubscriptionFieldsFragment, unknown>;
export const LabelFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"LabelFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Label"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"isGroup"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<LabelFieldsFragment, unknown>;
export const IssueLabelFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueLabelFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IssueLabel"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"labelId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"groupId"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<IssueLabelFieldsFragment, unknown>;
export const OauthClientFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"OauthClientFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"OauthClient"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"clientId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"developer"}},{"kind":"Field","name":{"kind":"Name","value":"developerUrl"}},{"kind":"Field","name":{"kind":"Name","value":"imageUrl"}},{"kind":"Field","name":{"kind":"Name","value":"redirectUris"}},{"kind":"Field","name":{"kind":"Name","value":"allowedScopes"}},{"kind":"Field","name":{"kind":"Name","value":"publicEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"clientCredentialsEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"webhookUrl"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<OauthClientFieldsFragment, unknown>;
export const ProjectLabelFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectLabelFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectLabel"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"isGroup"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<ProjectLabelFieldsFragment, unknown>;
export const ProjectLabelLinkFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectLabelLinkFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectLabelLink"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"labelId"}},{"kind":"Field","name":{"kind":"Name","value":"groupId"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<ProjectLabelLinkFieldsFragment, unknown>;
export const ProjectTemplateFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectTemplateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectTemplate"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"properties"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<ProjectTemplateFieldsFragment, unknown>;
export const ProjectTemplateMilestoneFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectTemplateMilestoneFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectTemplateMilestone"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"projectTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"targetDate"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<ProjectTemplateMilestoneFieldsFragment, unknown>;
export const ProjectTemplateIssueFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectTemplateIssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectTemplateIssue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"projectTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"properties"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<ProjectTemplateIssueFieldsFragment, unknown>;
export const ProjectUpdateFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectUpdateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectUpdate"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"health"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"authorId"}},{"kind":"Field","name":{"kind":"Name","value":"editedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<ProjectUpdateFieldsFragment, unknown>;
export const ProjectStatusFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectStatusFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectStatus"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"isDefault"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<ProjectStatusFieldsFragment, unknown>;
export const ProjectFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Project"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"statusId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"leadId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"startDate"}},{"kind":"Field","name":{"kind":"Name","value":"startDateGranularity"}},{"kind":"Field","name":{"kind":"Name","value":"targetDate"}},{"kind":"Field","name":{"kind":"Name","value":"targetDateGranularity"}},{"kind":"Field","name":{"kind":"Name","value":"updateSchedule"}},{"kind":"Field","name":{"kind":"Name","value":"updateReminderIntervalDays"}},{"kind":"Field","name":{"kind":"Name","value":"updateReminderWeekday"}},{"kind":"Field","name":{"kind":"Name","value":"updateReminderHour"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedBy"}},{"kind":"Field","name":{"kind":"Name","value":"projectTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<ProjectFieldsFragment, unknown>;
export const ProjectTeamFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectTeamFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectTeam"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<ProjectTeamFieldsFragment, unknown>;
export const ProjectMemberFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectMemberFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectMember"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<ProjectMemberFieldsFragment, unknown>;
export const ProjectMilestoneFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectMilestoneFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectMilestone"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"targetDate"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<ProjectMilestoneFieldsFragment, unknown>;
export const ProjectDependencyFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectDependencyFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectDependency"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"blockingProjectId"}},{"kind":"Field","name":{"kind":"Name","value":"blockedProjectId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<ProjectDependencyFieldsFragment, unknown>;
export const PulseFeedFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"PulseFeedFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"PulseFeed"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"projectIds"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<PulseFeedFieldsFragment, unknown>;
export const RecurringIssueFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"RecurringIssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RecurringIssue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"properties"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"cadence"}},{"kind":"Field","name":{"kind":"Name","value":"nextDueDate"}},{"kind":"Field","name":{"kind":"Name","value":"lastCreatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<RecurringIssueFieldsFragment, unknown>;
export const SentryConnectionFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SentryConnectionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SentryConnection"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"organizationSlug"}},{"kind":"Field","name":{"kind":"Name","value":"connectedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<SentryConnectionFieldsFragment, unknown>;
export const AccountSessionFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AccountSessionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AccountSession"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"label"}},{"kind":"Field","name":{"kind":"Name","value":"userAgent"}},{"kind":"Field","name":{"kind":"Name","value":"ip"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"current"}},{"kind":"Field","name":{"kind":"Name","value":"lastSeenAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}}]}}]} as unknown as DocumentNode<AccountSessionFieldsFragment, unknown>;
export const SlackConnectionFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SlackConnectionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SlackConnection"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"channelName"}},{"kind":"Field","name":{"kind":"Name","value":"notifyIssues"}},{"kind":"Field","name":{"kind":"Name","value":"notifyComments"}},{"kind":"Field","name":{"kind":"Name","value":"asksEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"connectedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<SlackConnectionFieldsFragment, unknown>;
export const SlaRuleFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SlaRuleFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SlaRule"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"filter"}},{"kind":"Field","name":{"kind":"Name","value":"action"}},{"kind":"Field","name":{"kind":"Name","value":"durationMinutes"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<SlaRuleFieldsFragment, unknown>;
export const ProjectSubscriptionFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectSubscriptionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectSubscription"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"issuesAdded"}},{"kind":"Field","name":{"kind":"Name","value":"issuesCompleted"}},{"kind":"Field","name":{"kind":"Name","value":"updates"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<ProjectSubscriptionFieldsFragment, unknown>;
export const InitiativeSubscriptionFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"InitiativeSubscriptionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"InitiativeSubscription"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"initiativeId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"issuesAdded"}},{"kind":"Field","name":{"kind":"Name","value":"issuesCompleted"}},{"kind":"Field","name":{"kind":"Name","value":"updates"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<InitiativeSubscriptionFieldsFragment, unknown>;
export const CustomerSubscriptionFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CustomerSubscriptionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"CustomerSubscription"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"customerId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"requestAdded"}},{"kind":"Field","name":{"kind":"Name","value":"requestImportant"}},{"kind":"Field","name":{"kind":"Name","value":"requestCompleted"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CustomerSubscriptionFieldsFragment, unknown>;
export const IssueTemplateFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueTemplateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IssueTemplate"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"properties"}},{"kind":"Field","name":{"kind":"Name","value":"subIssues"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"title"}}]}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeAddress"}}]}}]} as unknown as DocumentNode<IssueTemplateFieldsFragment, unknown>;
export const ViewFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ViewFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"View"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"filter"}},{"kind":"Field","name":{"kind":"Name","value":"display"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<ViewFieldsFragment, unknown>;
export const ViewPreferenceFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ViewPreferenceFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ViewPreference"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"viewKey"}},{"kind":"Field","name":{"kind":"Name","value":"display"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<ViewPreferenceFieldsFragment, unknown>;
export const FavoriteFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"FavoriteFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Favorite"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"targetId"}},{"kind":"Field","name":{"kind":"Name","value":"folderId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<FavoriteFieldsFragment, unknown>;
export const ViewSubscriptionFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ViewSubscriptionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ViewSubscription"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"viewId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"added"}},{"kind":"Field","name":{"kind":"Name","value":"completed"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<ViewSubscriptionFieldsFragment, unknown>;
export const WebhookSummaryFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WebhookSummary"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Webhook"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"allPublicTeams"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"resourceTypes"}},{"kind":"Field","name":{"kind":"Name","value":"consecutiveFailures"}},{"kind":"Field","name":{"kind":"Name","value":"disabledAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<WebhookSummaryFragment, unknown>;
export const WorkspaceFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkspaceFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Workspace"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"urlKey"}},{"kind":"Field","name":{"kind":"Name","value":"logoUrl"}},{"kind":"Field","name":{"kind":"Name","value":"plan"}},{"kind":"Field","name":{"kind":"Name","value":"planExpiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"planLapsedAt"}},{"kind":"Field","name":{"kind":"Name","value":"seatLimit"}},{"kind":"Field","name":{"kind":"Name","value":"projectUpdateReminderIntervalDays"}},{"kind":"Field","name":{"kind":"Name","value":"projectUpdateReminderWeekday"}},{"kind":"Field","name":{"kind":"Name","value":"projectUpdateReminderHour"}},{"kind":"Field","name":{"kind":"Name","value":"pulseEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"pulseDigestCadence"}},{"kind":"Field","name":{"kind":"Name","value":"customerRequestsEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"customerDefaultTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"customerRevenueUnit"}},{"kind":"Field","name":{"kind":"Name","value":"customerTiers"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<WorkspaceFieldsFragment, unknown>;
export const IssueFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Issue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"stateId"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"estimate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDateSource"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"subIssueSortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"formTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"recurringIssueId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"projectMilestoneId"}},{"kind":"Field","name":{"kind":"Name","value":"cycleId"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"autoClosedAt"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"canceledAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<IssueFieldsFragment, unknown>;
export const TeamFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TeamFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Team"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"parentTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"private"}},{"kind":"Field","name":{"kind":"Name","value":"estimateScale"}},{"kind":"Field","name":{"kind":"Name","value":"estimateAllowZero"}},{"kind":"Field","name":{"kind":"Name","value":"estimateExtended"}},{"kind":"Field","name":{"kind":"Name","value":"cyclesEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"cycleDurationWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleCooldownWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleStartDay"}},{"kind":"Field","name":{"kind":"Name","value":"cycleUpcomingCount"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddStarted"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddCompleted"}},{"kind":"Field","name":{"kind":"Name","value":"triageEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"triageRequirePriority"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoArchiveDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseParent"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseChildren"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTemplateForMembersId"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTemplateForNonMembersId"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeAddress"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"retiredAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<TeamFieldsFragment, unknown>;
export const StateFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"StateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkflowState"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"isDefault"}},{"kind":"Field","name":{"kind":"Name","value":"isSystem"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<StateFieldsFragment, unknown>;
export const UserFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"UserFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"User"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"notificationPrefs"}},{"kind":"Field","name":{"kind":"Name","value":"lastSeenAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UserFieldsFragment, unknown>;
export const CommentFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CommentFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Comment"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"actor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"editedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedBy"}},{"kind":"Field","name":{"kind":"Name","value":"anchorStart"}},{"kind":"Field","name":{"kind":"Name","value":"anchorEnd"}},{"kind":"Field","name":{"kind":"Name","value":"quote"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CommentFieldsFragment, unknown>;
export const ReactionFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ReactionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Reaction"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"commentId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"emoji"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<ReactionFieldsFragment, unknown>;
export const AttachmentFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AttachmentFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Attachment"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"subtitle"}},{"kind":"Field","name":{"kind":"Name","value":"iconUrl"}},{"kind":"Field","name":{"kind":"Name","value":"metadata"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<AttachmentFieldsFragment, unknown>;
export const CycleFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CycleFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Cycle"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"startsAt"}},{"kind":"Field","name":{"kind":"Name","value":"endsAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CycleFieldsFragment, unknown>;
export const EnterpriseAuditLogDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"EnterpriseAuditLog"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"first"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"after"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"auditLog"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"Variable","name":{"kind":"Name","value":"first"}}},{"kind":"Argument","name":{"kind":"Name","value":"after"},"value":{"kind":"Variable","name":{"kind":"Name","value":"after"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"actorUserId"}},{"kind":"Field","name":{"kind":"Name","value":"actorType"}},{"kind":"Field","name":{"kind":"Name","value":"actorLabel"}},{"kind":"Field","name":{"kind":"Name","value":"action"}},{"kind":"Field","name":{"kind":"Name","value":"targetType"}},{"kind":"Field","name":{"kind":"Name","value":"targetId"}},{"kind":"Field","name":{"kind":"Name","value":"targetLabel"}},{"kind":"Field","name":{"kind":"Name","value":"ip"}},{"kind":"Field","name":{"kind":"Name","value":"userAgent"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<EnterpriseAuditLogQuery, EnterpriseAuditLogQueryVariables>;
export const EntitlementsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Entitlements"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"workspace"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"plan"}},{"kind":"Field","name":{"kind":"Name","value":"planExpiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"planLapsedAt"}},{"kind":"Field","name":{"kind":"Name","value":"seatLimit"}},{"kind":"Field","name":{"kind":"Name","value":"entitlements"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"plan"}},{"kind":"Field","name":{"kind":"Name","value":"seatLimit"}},{"kind":"Field","name":{"kind":"Name","value":"seatsUsed"}},{"kind":"Field","name":{"kind":"Name","value":"teamLimit"}},{"kind":"Field","name":{"kind":"Name","value":"historyDays"}},{"kind":"Field","name":{"kind":"Name","value":"privateTeams"}},{"kind":"Field","name":{"kind":"Name","value":"subTeams"}},{"kind":"Field","name":{"kind":"Name","value":"multiLevelSubTeams"}},{"kind":"Field","name":{"kind":"Name","value":"customViews"}},{"kind":"Field","name":{"kind":"Name","value":"apiKeys"}},{"kind":"Field","name":{"kind":"Name","value":"sso"}},{"kind":"Field","name":{"kind":"Name","value":"auditLog"}},{"kind":"Field","name":{"kind":"Name","value":"slas"}},{"kind":"Field","name":{"kind":"Name","value":"slack"}},{"kind":"Field","name":{"kind":"Name","value":"lapsed"}}]}}]}}]}}]} as unknown as DocumentNode<EntitlementsQuery, EntitlementsQueryVariables>;
export const InvitesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Invites"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"invites"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"invitedBy"}},{"kind":"Field","name":{"kind":"Name","value":"teamIds"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<InvitesQuery, InvitesQueryVariables>;
export const InviteToWorkspaceDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"InviteToWorkspace"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"InviteInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"inviteToWorkspace"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"token"}}]}}]}}]} as unknown as DocumentNode<InviteToWorkspaceMutation, InviteToWorkspaceMutationVariables>;
export const RevokeInviteDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RevokeInvite"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"revokeInvite"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<RevokeInviteMutation, RevokeInviteMutationVariables>;
export const RemoveUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"userId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"userId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"userId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<RemoveUserMutation, RemoveUserMutationVariables>;
export const ApiKeysDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ApiKeys"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"apiKeys"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ApiKeyFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ApiKeyFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ApiKey"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"prefix"}},{"kind":"Field","name":{"kind":"Name","value":"scopes"}},{"kind":"Field","name":{"kind":"Name","value":"lastUsedAt"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"revokedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<ApiKeysQuery, ApiKeysQueryVariables>;
export const CreateApiKeyDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateApiKey"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateApiKeyInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createApiKey"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"created"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"token"}},{"kind":"Field","name":{"kind":"Name","value":"apiKey"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ApiKeyFields"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ApiKeyFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ApiKey"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"prefix"}},{"kind":"Field","name":{"kind":"Name","value":"scopes"}},{"kind":"Field","name":{"kind":"Name","value":"lastUsedAt"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"revokedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<CreateApiKeyMutation, CreateApiKeyMutationVariables>;
export const RevokeApiKeyDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RevokeApiKey"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"revokeApiKey"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<RevokeApiKeyMutation, RevokeApiKeyMutationVariables>;
export const ArchivedIssuesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ArchivedIssues"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"archivedIssues"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"teamId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IssueFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Issue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"stateId"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"estimate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDateSource"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"subIssueSortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"formTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"recurringIssueId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"projectMilestoneId"}},{"kind":"Field","name":{"kind":"Name","value":"cycleId"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"autoClosedAt"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"canceledAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<ArchivedIssuesQuery, ArchivedIssuesQueryVariables>;
export const ArchivedCyclesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ArchivedCycles"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"archivedCycles"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"teamId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CycleFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CycleFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Cycle"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"startsAt"}},{"kind":"Field","name":{"kind":"Name","value":"endsAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<ArchivedCyclesQuery, ArchivedCyclesQueryVariables>;
export const ArchivedProjectsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ArchivedProjects"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"archivedProjects"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"teamId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProjectFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Project"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"statusId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"leadId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"startDate"}},{"kind":"Field","name":{"kind":"Name","value":"startDateGranularity"}},{"kind":"Field","name":{"kind":"Name","value":"targetDate"}},{"kind":"Field","name":{"kind":"Name","value":"targetDateGranularity"}},{"kind":"Field","name":{"kind":"Name","value":"updateSchedule"}},{"kind":"Field","name":{"kind":"Name","value":"updateReminderIntervalDays"}},{"kind":"Field","name":{"kind":"Name","value":"updateReminderWeekday"}},{"kind":"Field","name":{"kind":"Name","value":"updateReminderHour"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedBy"}},{"kind":"Field","name":{"kind":"Name","value":"projectTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<ArchivedProjectsQuery, ArchivedProjectsQueryVariables>;
export const ArchiveCycleDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ArchiveCycle"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"archived"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"archiveCycle"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"archived"},"value":{"kind":"Variable","name":{"kind":"Name","value":"archived"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<ArchiveCycleMutation, ArchiveCycleMutationVariables>;
export const ArchiveProjectDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ArchiveProject"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"archived"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"archiveProject"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"archived"},"value":{"kind":"Variable","name":{"kind":"Name","value":"archived"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<ArchiveProjectMutation, ArchiveProjectMutationVariables>;
export const CreateAskFormDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateAskForm"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateAskFormInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createAskForm"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"askForm"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AskFormFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AskFormFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AskForm"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"token"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateAskFormMutation, CreateAskFormMutationVariables>;
export const UpdateAskFormDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateAskForm"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateAskFormInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateAskForm"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"askForm"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AskFormFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AskFormFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AskForm"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"token"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UpdateAskFormMutation, UpdateAskFormMutationVariables>;
export const ArchiveAskFormDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ArchiveAskForm"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"archived"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"archiveAskForm"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"archived"},"value":{"kind":"Variable","name":{"kind":"Name","value":"archived"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<ArchiveAskFormMutation, ArchiveAskFormMutationVariables>;
export const DeleteAskFormDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteAskForm"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteAskForm"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteAskFormMutation, DeleteAskFormMutationVariables>;
export const AuthorisedOauthAppsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AuthorisedOauthApps"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"authorisedOauthApps"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AuthorisedOauthAppFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AuthorisedOauthAppFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AuthorisedOauthApp"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"clientId"}},{"kind":"Field","name":{"kind":"Name","value":"imageUrl"}},{"kind":"Field","name":{"kind":"Name","value":"developer"}},{"kind":"Field","name":{"kind":"Name","value":"scopes"}},{"kind":"Field","name":{"kind":"Name","value":"lastUsedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<AuthorisedOauthAppsQuery, AuthorisedOauthAppsQueryVariables>;
export const RevokeAuthorisedOauthAppDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RevokeAuthorisedOauthApp"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"revokeAuthorisedOauthApp"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<RevokeAuthorisedOauthAppMutation, RevokeAuthorisedOauthAppMutationVariables>;
export const LeaveWorkspaceDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"LeaveWorkspace"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"leaveWorkspace"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<LeaveWorkspaceMutation, LeaveWorkspaceMutationVariables>;
export const CreateCustomerDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateCustomer"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateCustomerInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createCustomer"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"customer"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CustomerFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CustomerFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Customer"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"domains"}},{"kind":"Field","name":{"kind":"Name","value":"revenue"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"tier"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"logoUrl"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateCustomerMutation, CreateCustomerMutationVariables>;
export const UpdateCustomerDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateCustomer"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateCustomerInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateCustomer"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"customer"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CustomerFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CustomerFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Customer"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"domains"}},{"kind":"Field","name":{"kind":"Name","value":"revenue"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"tier"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"logoUrl"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UpdateCustomerMutation, UpdateCustomerMutationVariables>;
export const CreateCustomerRequestDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateCustomerRequest"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateCustomerRequestInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createCustomerRequest"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"customerRequest"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CustomerRequestFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CustomerRequestFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"CustomerRequest"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"customerId"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"important"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateCustomerRequestMutation, CreateCustomerRequestMutationVariables>;
export const UpdateCustomerRequestDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateCustomerRequest"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateCustomerRequestInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateCustomerRequest"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"customerRequest"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CustomerRequestFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CustomerRequestFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"CustomerRequest"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"customerId"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"important"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UpdateCustomerRequestMutation, UpdateCustomerRequestMutationVariables>;
export const DeleteCustomerRequestDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteCustomerRequest"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteCustomerRequest"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteCustomerRequestMutation, DeleteCustomerRequestMutationVariables>;
export const ArchiveCustomerDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ArchiveCustomer"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"archived"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"archiveCustomer"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"archived"},"value":{"kind":"Variable","name":{"kind":"Name","value":"archived"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<ArchiveCustomerMutation, ArchiveCustomerMutationVariables>;
export const MergeCustomersDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MergeCustomers"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sourceId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"intoId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mergeCustomers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"sourceId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sourceId"}}},{"kind":"Argument","name":{"kind":"Name","value":"intoId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"intoId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"customer"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CustomerFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CustomerFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Customer"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"domains"}},{"kind":"Field","name":{"kind":"Name","value":"revenue"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"tier"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"logoUrl"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<MergeCustomersMutation, MergeCustomersMutationVariables>;
export const EnsureCycleCalendarFeedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"EnsureCycleCalendarFeed"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ensureCycleCalendarFeed"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"teamId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"cycleCalendarFeed"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]}}]} as unknown as DocumentNode<EnsureCycleCalendarFeedMutation, EnsureCycleCalendarFeedMutationVariables>;
export const RotateCycleCalendarFeedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RotateCycleCalendarFeed"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"rotateCycleCalendarFeed"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"teamId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"cycleCalendarFeed"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]}}]} as unknown as DocumentNode<RotateCycleCalendarFeedMutation, RotateCycleCalendarFeedMutationVariables>;
export const UpdateCycleDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateCycle"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateCycleInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateCycle"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"cycle"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CycleFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CycleFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Cycle"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"startsAt"}},{"kind":"Field","name":{"kind":"Name","value":"endsAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UpdateCycleMutation, UpdateCycleMutationVariables>;
export const StartCycleTodayDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"StartCycleToday"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"startCycleToday"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"cycle"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CycleFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CycleFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Cycle"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"startsAt"}},{"kind":"Field","name":{"kind":"Name","value":"endsAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<StartCycleTodayMutation, StartCycleTodayMutationVariables>;
export const CreateDashboardDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateDashboard"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateDashboardInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createDashboard"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"dashboard"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"DashboardFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"DashboardFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Dashboard"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"filter"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateDashboardMutation, CreateDashboardMutationVariables>;
export const UpdateDashboardDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateDashboard"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateDashboardInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateDashboard"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"dashboard"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"DashboardFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"DashboardFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Dashboard"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"filter"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UpdateDashboardMutation, UpdateDashboardMutationVariables>;
export const DeleteDashboardDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteDashboard"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteDashboard"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteDashboardMutation, DeleteDashboardMutationVariables>;
export const CreateDashboardTileDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateDashboardTile"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateDashboardTileInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createDashboardTile"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"dashboardTile"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"DashboardTileFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"DashboardTileFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"DashboardTile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"dashboardId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"measure"}},{"kind":"Field","name":{"kind":"Name","value":"slice"}},{"kind":"Field","name":{"kind":"Name","value":"display"}},{"kind":"Field","name":{"kind":"Name","value":"filter"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateDashboardTileMutation, CreateDashboardTileMutationVariables>;
export const UpdateDashboardTileDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateDashboardTile"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateDashboardTileInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateDashboardTile"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"dashboardTile"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"DashboardTileFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"DashboardTileFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"DashboardTile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"dashboardId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"measure"}},{"kind":"Field","name":{"kind":"Name","value":"slice"}},{"kind":"Field","name":{"kind":"Name","value":"display"}},{"kind":"Field","name":{"kind":"Name","value":"filter"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UpdateDashboardTileMutation, UpdateDashboardTileMutationVariables>;
export const DeleteDashboardTileDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteDashboardTile"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteDashboardTile"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteDashboardTileMutation, DeleteDashboardTileMutationVariables>;
export const CreateDocumentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateDocument"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateDocumentInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createDocument"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"document"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"DocumentFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"DocumentFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Document"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"updatedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}}]}}]} as unknown as DocumentNode<CreateDocumentMutation, CreateDocumentMutationVariables>;
export const UpdateDocumentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateDocument"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateDocumentInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateDocument"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"document"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"DocumentFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"DocumentFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Document"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"updatedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}}]}}]} as unknown as DocumentNode<UpdateDocumentMutation, UpdateDocumentMutationVariables>;
export const ArchiveDocumentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ArchiveDocument"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"archived"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"archiveDocument"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"archived"},"value":{"kind":"Variable","name":{"kind":"Name","value":"archived"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<ArchiveDocumentMutation, ArchiveDocumentMutationVariables>;
export const DeleteDocumentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteDocument"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteDocument"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteDocumentMutation, DeleteDocumentMutationVariables>;
export const DraftsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Drafts"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"drafts"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"DraftFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"DraftFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Draft"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<DraftsQuery, DraftsQueryVariables>;
export const CreateDraftDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateDraft"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateDraftInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createDraft"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"draft"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"DraftFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"DraftFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Draft"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateDraftMutation, CreateDraftMutationVariables>;
export const UpdateDraftDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateDraft"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateDraftInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateDraft"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"draft"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"DraftFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"DraftFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Draft"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UpdateDraftMutation, UpdateDraftMutationVariables>;
export const DeleteDraftDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteDraft"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteDraft"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteDraftMutation, DeleteDraftMutationVariables>;
export const CreateFormTemplateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateFormTemplate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateFormTemplateInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createFormTemplate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"template"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"FormTemplateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"FormTemplateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"FormTemplate"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"properties"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<CreateFormTemplateMutation, CreateFormTemplateMutationVariables>;
export const UpdateFormTemplateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateFormTemplate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateFormTemplateInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateFormTemplate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"template"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"FormTemplateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"FormTemplateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"FormTemplate"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"properties"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UpdateFormTemplateMutation, UpdateFormTemplateMutationVariables>;
export const ArchiveFormTemplateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ArchiveFormTemplate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"archived"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"archiveFormTemplate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"archived"},"value":{"kind":"Variable","name":{"kind":"Name","value":"archived"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<ArchiveFormTemplateMutation, ArchiveFormTemplateMutationVariables>;
export const CreateFormTemplateFieldDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateFormTemplateField"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateFormTemplateFieldInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createFormTemplateField"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"field"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"FormTemplateFieldFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"FormTemplateFieldFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"FormTemplateField"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"formTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"fieldType"}},{"kind":"Field","name":{"kind":"Name","value":"label"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"required"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"config"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateFormTemplateFieldMutation, CreateFormTemplateFieldMutationVariables>;
export const UpdateFormTemplateFieldDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateFormTemplateField"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateFormTemplateFieldInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateFormTemplateField"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"field"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"FormTemplateFieldFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"FormTemplateFieldFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"FormTemplateField"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"formTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"fieldType"}},{"kind":"Field","name":{"kind":"Name","value":"label"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"required"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"config"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UpdateFormTemplateFieldMutation, UpdateFormTemplateFieldMutationVariables>;
export const DeleteFormTemplateFieldDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteFormTemplateField"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteFormTemplateField"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteFormTemplateFieldMutation, DeleteFormTemplateFieldMutationVariables>;
export const GitHubSettingsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GitHubSettings"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"githubOAuthConfigured"}},{"kind":"Field","name":{"kind":"Name","value":"githubCommitWebhook"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"secret"}}]}}]}}]} as unknown as DocumentNode<GitHubSettingsQuery, GitHubSettingsQueryVariables>;
export const CreateGitHubConnectionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateGitHubConnection"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateGitHubConnectionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createGitHubConnection"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"githubConnection"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"GitHubConnectionFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"GitHubConnectionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GitHubConnection"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"orgLogin"}},{"kind":"Field","name":{"kind":"Name","value":"branchNameFormat"}},{"kind":"Field","name":{"kind":"Name","value":"linkCommits"}},{"kind":"Field","name":{"kind":"Name","value":"linkbacks"}},{"kind":"Field","name":{"kind":"Name","value":"connectedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateGitHubConnectionMutation, CreateGitHubConnectionMutationVariables>;
export const UpdateGitHubConnectionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateGitHubConnection"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateGitHubConnectionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateGitHubConnection"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"githubConnection"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"GitHubConnectionFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"GitHubConnectionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GitHubConnection"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"orgLogin"}},{"kind":"Field","name":{"kind":"Name","value":"branchNameFormat"}},{"kind":"Field","name":{"kind":"Name","value":"linkCommits"}},{"kind":"Field","name":{"kind":"Name","value":"linkbacks"}},{"kind":"Field","name":{"kind":"Name","value":"connectedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UpdateGitHubConnectionMutation, UpdateGitHubConnectionMutationVariables>;
export const DeleteGitHubConnectionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteGitHubConnection"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteGitHubConnection"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteGitHubConnectionMutation, DeleteGitHubConnectionMutationVariables>;
export const CreateGitHubUserLinkDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateGitHubUserLink"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateGitHubUserLinkInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createGitHubUserLink"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"githubUserLink"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"GitHubUserLinkFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"GitHubUserLinkFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GitHubUserLink"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"githubLogin"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateGitHubUserLinkMutation, CreateGitHubUserLinkMutationVariables>;
export const DeleteGitHubUserLinkDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteGitHubUserLink"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteGitHubUserLink"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteGitHubUserLinkMutation, DeleteGitHubUserLinkMutationVariables>;
export const GitHubTeamAutomationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GitHubTeamAutomation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"githubTeamAutomation"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"teamId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"GitHubTeamAutomationFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"GitHubTeamAutomationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GitHubTeamAutomation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"configured"}},{"kind":"Field","name":{"kind":"Name","value":"draftedStateId"}},{"kind":"Field","name":{"kind":"Name","value":"openedStateId"}},{"kind":"Field","name":{"kind":"Name","value":"reviewRequestedStateId"}},{"kind":"Field","name":{"kind":"Name","value":"readyForMergeStateId"}},{"kind":"Field","name":{"kind":"Name","value":"mergedStateId"}}]}}]} as unknown as DocumentNode<GitHubTeamAutomationQuery, GitHubTeamAutomationQueryVariables>;
export const UpdateGitHubTeamAutomationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateGitHubTeamAutomation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateGitHubTeamAutomationInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateGitHubTeamAutomation"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"githubTeamAutomation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"GitHubTeamAutomationFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"GitHubTeamAutomationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GitHubTeamAutomation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"configured"}},{"kind":"Field","name":{"kind":"Name","value":"draftedStateId"}},{"kind":"Field","name":{"kind":"Name","value":"openedStateId"}},{"kind":"Field","name":{"kind":"Name","value":"reviewRequestedStateId"}},{"kind":"Field","name":{"kind":"Name","value":"readyForMergeStateId"}},{"kind":"Field","name":{"kind":"Name","value":"mergedStateId"}}]}}]} as unknown as DocumentNode<UpdateGitHubTeamAutomationMutation, UpdateGitHubTeamAutomationMutationVariables>;
export const DeleteGitHubTeamAutomationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteGitHubTeamAutomation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteGitHubTeamAutomation"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"teamId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"githubTeamAutomation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"GitHubTeamAutomationFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"GitHubTeamAutomationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GitHubTeamAutomation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"configured"}},{"kind":"Field","name":{"kind":"Name","value":"draftedStateId"}},{"kind":"Field","name":{"kind":"Name","value":"openedStateId"}},{"kind":"Field","name":{"kind":"Name","value":"reviewRequestedStateId"}},{"kind":"Field","name":{"kind":"Name","value":"readyForMergeStateId"}},{"kind":"Field","name":{"kind":"Name","value":"mergedStateId"}}]}}]} as unknown as DocumentNode<DeleteGitHubTeamAutomationMutation, DeleteGitHubTeamAutomationMutationVariables>;
export const GitLabSettingsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GitLabSettings"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"gitlabWebhook"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"secret"}}]}}]}}]} as unknown as DocumentNode<GitLabSettingsQuery, GitLabSettingsQueryVariables>;
export const CreateGitLabConnectionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateGitLabConnection"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateGitLabConnectionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createGitLabConnection"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"gitlabConnection"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"GitLabConnectionFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"GitLabConnectionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GitLabConnection"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"instanceUrl"}},{"kind":"Field","name":{"kind":"Name","value":"branchNameFormat"}},{"kind":"Field","name":{"kind":"Name","value":"linkCommits"}},{"kind":"Field","name":{"kind":"Name","value":"linkbacks"}},{"kind":"Field","name":{"kind":"Name","value":"connectedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateGitLabConnectionMutation, CreateGitLabConnectionMutationVariables>;
export const UpdateGitLabConnectionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateGitLabConnection"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateGitLabConnectionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateGitLabConnection"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"gitlabConnection"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"GitLabConnectionFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"GitLabConnectionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GitLabConnection"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"instanceUrl"}},{"kind":"Field","name":{"kind":"Name","value":"branchNameFormat"}},{"kind":"Field","name":{"kind":"Name","value":"linkCommits"}},{"kind":"Field","name":{"kind":"Name","value":"linkbacks"}},{"kind":"Field","name":{"kind":"Name","value":"connectedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UpdateGitLabConnectionMutation, UpdateGitLabConnectionMutationVariables>;
export const DeleteGitLabConnectionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteGitLabConnection"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteGitLabConnection"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteGitLabConnectionMutation, DeleteGitLabConnectionMutationVariables>;
export const CreateGitLabUserLinkDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateGitLabUserLink"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateGitLabUserLinkInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createGitLabUserLink"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"gitlabUserLink"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"GitLabUserLinkFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"GitLabUserLinkFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GitLabUserLink"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"gitlabUsername"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateGitLabUserLinkMutation, CreateGitLabUserLinkMutationVariables>;
export const DeleteGitLabUserLinkDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteGitLabUserLink"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteGitLabUserLink"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteGitLabUserLinkMutation, DeleteGitLabUserLinkMutationVariables>;
export const GitLabTeamAutomationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GitLabTeamAutomation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"gitlabTeamAutomation"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"teamId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"GitLabTeamAutomationFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"GitLabTeamAutomationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GitLabTeamAutomation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"configured"}},{"kind":"Field","name":{"kind":"Name","value":"draftedStateId"}},{"kind":"Field","name":{"kind":"Name","value":"openedStateId"}},{"kind":"Field","name":{"kind":"Name","value":"reviewRequestedStateId"}},{"kind":"Field","name":{"kind":"Name","value":"readyForMergeStateId"}},{"kind":"Field","name":{"kind":"Name","value":"mergedStateId"}}]}}]} as unknown as DocumentNode<GitLabTeamAutomationQuery, GitLabTeamAutomationQueryVariables>;
export const UpdateGitLabTeamAutomationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateGitLabTeamAutomation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateGitLabTeamAutomationInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateGitLabTeamAutomation"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"gitlabTeamAutomation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"GitLabTeamAutomationFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"GitLabTeamAutomationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GitLabTeamAutomation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"configured"}},{"kind":"Field","name":{"kind":"Name","value":"draftedStateId"}},{"kind":"Field","name":{"kind":"Name","value":"openedStateId"}},{"kind":"Field","name":{"kind":"Name","value":"reviewRequestedStateId"}},{"kind":"Field","name":{"kind":"Name","value":"readyForMergeStateId"}},{"kind":"Field","name":{"kind":"Name","value":"mergedStateId"}}]}}]} as unknown as DocumentNode<UpdateGitLabTeamAutomationMutation, UpdateGitLabTeamAutomationMutationVariables>;
export const DeleteGitLabTeamAutomationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteGitLabTeamAutomation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteGitLabTeamAutomation"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"teamId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"gitlabTeamAutomation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"GitLabTeamAutomationFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"GitLabTeamAutomationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GitLabTeamAutomation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"configured"}},{"kind":"Field","name":{"kind":"Name","value":"draftedStateId"}},{"kind":"Field","name":{"kind":"Name","value":"openedStateId"}},{"kind":"Field","name":{"kind":"Name","value":"reviewRequestedStateId"}},{"kind":"Field","name":{"kind":"Name","value":"readyForMergeStateId"}},{"kind":"Field","name":{"kind":"Name","value":"mergedStateId"}}]}}]} as unknown as DocumentNode<DeleteGitLabTeamAutomationMutation, DeleteGitLabTeamAutomationMutationVariables>;
export const InboxDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Inbox"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"first"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"notifications"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"includeRead"},"value":{"kind":"BooleanValue","value":true}},{"kind":"Argument","name":{"kind":"Name","value":"includeSnoozed"},"value":{"kind":"BooleanValue","value":true}},{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"Variable","name":{"kind":"Name","value":"first"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"NotificationFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"NotificationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Notification"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"commentId"}},{"kind":"Field","name":{"kind":"Name","value":"actor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"changeVersion"}},{"kind":"Field","name":{"kind":"Name","value":"groupKey"}},{"kind":"Field","name":{"kind":"Name","value":"count"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}},{"kind":"Field","name":{"kind":"Name","value":"readAt"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<InboxQuery, InboxQueryVariables>;
export const UnreadNotificationCountDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UnreadNotificationCount"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"unreadNotificationCount"}}]}}]} as unknown as DocumentNode<UnreadNotificationCountQuery, UnreadNotificationCountQueryVariables>;
export const MarkNotificationReadDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MarkNotificationRead"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"read"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"markNotificationRead"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"read"},"value":{"kind":"Variable","name":{"kind":"Name","value":"read"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"notification"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"NotificationFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"NotificationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Notification"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"commentId"}},{"kind":"Field","name":{"kind":"Name","value":"actor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"changeVersion"}},{"kind":"Field","name":{"kind":"Name","value":"groupKey"}},{"kind":"Field","name":{"kind":"Name","value":"count"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}},{"kind":"Field","name":{"kind":"Name","value":"readAt"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<MarkNotificationReadMutation, MarkNotificationReadMutationVariables>;
export const MarkAllNotificationsReadDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MarkAllNotificationsRead"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"markAllNotificationsRead"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"NotificationFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"NotificationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Notification"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"commentId"}},{"kind":"Field","name":{"kind":"Name","value":"actor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"changeVersion"}},{"kind":"Field","name":{"kind":"Name","value":"groupKey"}},{"kind":"Field","name":{"kind":"Name","value":"count"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}},{"kind":"Field","name":{"kind":"Name","value":"readAt"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<MarkAllNotificationsReadMutation, MarkAllNotificationsReadMutationVariables>;
export const SnoozeNotificationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SnoozeNotification"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"until"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Time"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"snoozeNotification"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"until"},"value":{"kind":"Variable","name":{"kind":"Name","value":"until"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"notification"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"NotificationFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"NotificationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Notification"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"commentId"}},{"kind":"Field","name":{"kind":"Name","value":"actor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"changeVersion"}},{"kind":"Field","name":{"kind":"Name","value":"groupKey"}},{"kind":"Field","name":{"kind":"Name","value":"count"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}},{"kind":"Field","name":{"kind":"Name","value":"readAt"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<SnoozeNotificationMutation, SnoozeNotificationMutationVariables>;
export const DeleteNotificationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteNotification"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteNotification"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteNotificationMutation, DeleteNotificationMutationVariables>;
export const UpdateNotificationPrefsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateNotificationPrefs"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"prefs"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"JSON"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateNotificationPrefs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"prefs"},"value":{"kind":"Variable","name":{"kind":"Name","value":"prefs"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"UserFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"UserFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"User"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"notificationPrefs"}},{"kind":"Field","name":{"kind":"Name","value":"lastSeenAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UpdateNotificationPrefsMutation, UpdateNotificationPrefsMutationVariables>;
export const CreateInitiativeLabelDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateInitiativeLabel"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateInitiativeLabelInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createInitiativeLabel"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"initiativeLabel"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"InitiativeLabelFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"InitiativeLabelFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"InitiativeLabel"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"isGroup"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<CreateInitiativeLabelMutation, CreateInitiativeLabelMutationVariables>;
export const UpdateInitiativeLabelDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateInitiativeLabel"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateInitiativeLabelInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateInitiativeLabel"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"initiativeLabel"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"InitiativeLabelFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"InitiativeLabelFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"InitiativeLabel"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"isGroup"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UpdateInitiativeLabelMutation, UpdateInitiativeLabelMutationVariables>;
export const ArchiveInitiativeLabelDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ArchiveInitiativeLabel"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"archived"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"archiveInitiativeLabel"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"archived"},"value":{"kind":"Variable","name":{"kind":"Name","value":"archived"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<ArchiveInitiativeLabelMutation, ArchiveInitiativeLabelMutationVariables>;
export const AddInitiativeLabelDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AddInitiativeLabel"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"initiativeId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"labelId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"addInitiativeLabel"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"initiativeId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"initiativeId"}}},{"kind":"Argument","name":{"kind":"Name","value":"labelId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"labelId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"initiativeLabelLink"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"InitiativeLabelLinkFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"InitiativeLabelLinkFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"InitiativeLabelLink"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"initiativeId"}},{"kind":"Field","name":{"kind":"Name","value":"labelId"}},{"kind":"Field","name":{"kind":"Name","value":"groupId"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<AddInitiativeLabelMutation, AddInitiativeLabelMutationVariables>;
export const RemoveInitiativeLabelDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveInitiativeLabel"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"initiativeId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"labelId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeInitiativeLabel"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"initiativeId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"initiativeId"}}},{"kind":"Argument","name":{"kind":"Name","value":"labelId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"labelId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<RemoveInitiativeLabelMutation, RemoveInitiativeLabelMutationVariables>;
export const CreateInitiativeUpdateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateInitiativeUpdate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateInitiativeUpdateInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createInitiativeUpdate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"initiativeUpdate"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"InitiativeUpdateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"InitiativeUpdateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"InitiativeUpdate"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"initiativeId"}},{"kind":"Field","name":{"kind":"Name","value":"health"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"authorId"}},{"kind":"Field","name":{"kind":"Name","value":"editedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateInitiativeUpdateMutation, CreateInitiativeUpdateMutationVariables>;
export const UpdateInitiativeUpdateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateInitiativeUpdate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateInitiativeUpdateInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateInitiativeUpdate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"initiativeUpdate"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"InitiativeUpdateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"InitiativeUpdateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"InitiativeUpdate"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"initiativeId"}},{"kind":"Field","name":{"kind":"Name","value":"health"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"authorId"}},{"kind":"Field","name":{"kind":"Name","value":"editedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UpdateInitiativeUpdateMutation, UpdateInitiativeUpdateMutationVariables>;
export const DeleteInitiativeUpdateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteInitiativeUpdate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteInitiativeUpdate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteInitiativeUpdateMutation, DeleteInitiativeUpdateMutationVariables>;
export const CreateInitiativeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateInitiative"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateInitiativeInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createInitiative"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"initiative"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"InitiativeFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"InitiativeFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Initiative"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"leadTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"targetDate"}},{"kind":"Field","name":{"kind":"Name","value":"targetDateGranularity"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateInitiativeMutation, CreateInitiativeMutationVariables>;
export const UpdateInitiativeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateInitiative"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateInitiativeInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateInitiative"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"initiative"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"InitiativeFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"InitiativeFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Initiative"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"leadTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"targetDate"}},{"kind":"Field","name":{"kind":"Name","value":"targetDateGranularity"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UpdateInitiativeMutation, UpdateInitiativeMutationVariables>;
export const AddInitiativeProjectDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AddInitiativeProject"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"initiativeId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"addInitiativeProject"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"initiativeId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"initiativeId"}}},{"kind":"Argument","name":{"kind":"Name","value":"projectId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"initiativeProject"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"InitiativeProjectFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"InitiativeProjectFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"InitiativeProject"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"initiativeId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<AddInitiativeProjectMutation, AddInitiativeProjectMutationVariables>;
export const RemoveInitiativeProjectDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveInitiativeProject"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"initiativeId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeInitiativeProject"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"initiativeId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"initiativeId"}}},{"kind":"Argument","name":{"kind":"Name","value":"projectId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<RemoveInitiativeProjectMutation, RemoveInitiativeProjectMutationVariables>;
export const ArchiveInitiativeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ArchiveInitiative"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"archived"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"archiveInitiative"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"archived"},"value":{"kind":"Variable","name":{"kind":"Name","value":"archived"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<ArchiveInitiativeMutation, ArchiveInitiativeMutationVariables>;
export const AddInitiativeRelationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AddInitiativeRelation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"parentInitiativeId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"childInitiativeId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"addInitiativeRelation"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"parentInitiativeId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"parentInitiativeId"}}},{"kind":"Argument","name":{"kind":"Name","value":"childInitiativeId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"childInitiativeId"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"initiativeRelation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"InitiativeRelationFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"InitiativeRelationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"InitiativeRelation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"parentInitiativeId"}},{"kind":"Field","name":{"kind":"Name","value":"childInitiativeId"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<AddInitiativeRelationMutation, AddInitiativeRelationMutationVariables>;
export const RemoveInitiativeRelationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveInitiativeRelation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"parentInitiativeId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"childInitiativeId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeInitiativeRelation"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"parentInitiativeId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"parentInitiativeId"}}},{"kind":"Argument","name":{"kind":"Name","value":"childInitiativeId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"childInitiativeId"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<RemoveInitiativeRelationMutation, RemoveInitiativeRelationMutationVariables>;
export const IntegrationSubmissionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"IntegrationSubmissions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"integrationSubmissions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"submittedBy"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"website"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<IntegrationSubmissionsQuery, IntegrationSubmissionsQueryVariables>;
export const SubmitIntegrationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SubmitIntegration"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SubmitIntegrationInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"submitIntegration"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"submission"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"submittedBy"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"website"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]}}]} as unknown as DocumentNode<SubmitIntegrationMutation, SubmitIntegrationMutationVariables>;
export const CreateSubIssueDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateSubIssue"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateIssueInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createIssue"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"issue"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SubIssueFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SubIssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Issue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"stateId"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"estimate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDateSource"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"subIssueSortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"formTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"recurringIssueId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"projectMilestoneId"}},{"kind":"Field","name":{"kind":"Name","value":"cycleId"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"autoClosedAt"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"canceledAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateSubIssueMutation, CreateSubIssueMutationVariables>;
export const CreateIssueRelationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateIssueRelation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"issueId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"relatedIssueId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"type"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RelationType"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createIssueRelation"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"issueId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"issueId"}}},{"kind":"Argument","name":{"kind":"Name","value":"relatedIssueId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"relatedIssueId"}}},{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"Variable","name":{"kind":"Name","value":"type"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"relation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"RelationFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"RelationFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IssueRelation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"relatedIssueId"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"relatedTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<CreateIssueRelationMutation, CreateIssueRelationMutationVariables>;
export const DeleteIssueRelationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteIssueRelation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteIssueRelation"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteIssueRelationMutation, DeleteIssueRelationMutationVariables>;
export const SetIssueSubscriptionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetIssueSubscription"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"issueId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"subscribed"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setIssueSubscription"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"issueId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"issueId"}}},{"kind":"Argument","name":{"kind":"Name","value":"subscribed"},"value":{"kind":"Variable","name":{"kind":"Name","value":"subscribed"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"subscription"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SubscriptionFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SubscriptionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IssueSubscription"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"reason"}},{"kind":"Field","name":{"kind":"Name","value":"unsubscribed"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<SetIssueSubscriptionMutation, SetIssueSubscriptionMutationVariables>;
export const BulkUpdateIssuesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"BulkUpdateIssues"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"BulkUpdateIssuesInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bulkUpdateIssues"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"skipped"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"reason"}}]}}]}}]}}]} as unknown as DocumentNode<BulkUpdateIssuesMutation, BulkUpdateIssuesMutationVariables>;
export const CreateLabelDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateLabel"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateLabelInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createLabel"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"label"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"LabelFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"LabelFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Label"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"isGroup"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<CreateLabelMutation, CreateLabelMutationVariables>;
export const UpdateLabelDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateLabel"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateLabelInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateLabel"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"label"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"LabelFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"LabelFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Label"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"isGroup"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UpdateLabelMutation, UpdateLabelMutationVariables>;
export const ArchiveLabelDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ArchiveLabel"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"archived"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"archiveLabel"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"archived"},"value":{"kind":"Variable","name":{"kind":"Name","value":"archived"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<ArchiveLabelMutation, ArchiveLabelMutationVariables>;
export const MergeLabelsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MergeLabels"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sourceId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"intoId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mergeLabels"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"sourceId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sourceId"}}},{"kind":"Argument","name":{"kind":"Name","value":"intoId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"intoId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"label"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"LabelFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"LabelFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Label"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"isGroup"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<MergeLabelsMutation, MergeLabelsMutationVariables>;
export const AddIssueLabelDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AddIssueLabel"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"issueId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"labelId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"addIssueLabel"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"issueId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"issueId"}}},{"kind":"Argument","name":{"kind":"Name","value":"labelId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"labelId"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"issueLabel"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IssueLabelFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueLabelFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IssueLabel"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"labelId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"groupId"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<AddIssueLabelMutation, AddIssueLabelMutationVariables>;
export const RemoveIssueLabelDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveIssueLabel"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"issueId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"labelId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeIssueLabel"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"issueId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"issueId"}}},{"kind":"Argument","name":{"kind":"Name","value":"labelId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"labelId"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<RemoveIssueLabelMutation, RemoveIssueLabelMutationVariables>;
export const OauthClientsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"OauthClients"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"oauthClients"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"OauthClientFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"OauthClientFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"OauthClient"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"clientId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"developer"}},{"kind":"Field","name":{"kind":"Name","value":"developerUrl"}},{"kind":"Field","name":{"kind":"Name","value":"imageUrl"}},{"kind":"Field","name":{"kind":"Name","value":"redirectUris"}},{"kind":"Field","name":{"kind":"Name","value":"allowedScopes"}},{"kind":"Field","name":{"kind":"Name","value":"publicEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"clientCredentialsEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"webhookUrl"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<OauthClientsQuery, OauthClientsQueryVariables>;
export const OauthClientInfoDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"OauthClientInfo"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"oauthClientInfo"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"clientId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"developer"}},{"kind":"Field","name":{"kind":"Name","value":"developerUrl"}},{"kind":"Field","name":{"kind":"Name","value":"imageUrl"}},{"kind":"Field","name":{"kind":"Name","value":"allowedScopes"}}]}}]}}]} as unknown as DocumentNode<OauthClientInfoQuery, OauthClientInfoQueryVariables>;
export const CreateOauthClientDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateOauthClient"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateOauthClientInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createOauthClient"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"created"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"clientSecret"}},{"kind":"Field","name":{"kind":"Name","value":"oauthClient"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"OauthClientFields"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"OauthClientFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"OauthClient"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"clientId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"developer"}},{"kind":"Field","name":{"kind":"Name","value":"developerUrl"}},{"kind":"Field","name":{"kind":"Name","value":"imageUrl"}},{"kind":"Field","name":{"kind":"Name","value":"redirectUris"}},{"kind":"Field","name":{"kind":"Name","value":"allowedScopes"}},{"kind":"Field","name":{"kind":"Name","value":"publicEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"clientCredentialsEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"webhookUrl"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateOauthClientMutation, CreateOauthClientMutationVariables>;
export const UpdateOauthClientDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateOauthClient"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateOauthClientInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateOauthClient"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"oauthClient"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"OauthClientFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"OauthClientFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"OauthClient"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"clientId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"developer"}},{"kind":"Field","name":{"kind":"Name","value":"developerUrl"}},{"kind":"Field","name":{"kind":"Name","value":"imageUrl"}},{"kind":"Field","name":{"kind":"Name","value":"redirectUris"}},{"kind":"Field","name":{"kind":"Name","value":"allowedScopes"}},{"kind":"Field","name":{"kind":"Name","value":"publicEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"clientCredentialsEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"webhookUrl"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UpdateOauthClientMutation, UpdateOauthClientMutationVariables>;
export const RotateOauthClientSecretDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RotateOauthClientSecret"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"rotateOauthClientSecret"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"clientSecret"}},{"kind":"Field","name":{"kind":"Name","value":"oauthClient"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"OauthClientFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"OauthClientFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"OauthClient"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"clientId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"developer"}},{"kind":"Field","name":{"kind":"Name","value":"developerUrl"}},{"kind":"Field","name":{"kind":"Name","value":"imageUrl"}},{"kind":"Field","name":{"kind":"Name","value":"redirectUris"}},{"kind":"Field","name":{"kind":"Name","value":"allowedScopes"}},{"kind":"Field","name":{"kind":"Name","value":"publicEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"clientCredentialsEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"webhookUrl"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<RotateOauthClientSecretMutation, RotateOauthClientSecretMutationVariables>;
export const DeleteOauthClientDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteOauthClient"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteOauthClient"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteOauthClientMutation, DeleteOauthClientMutationVariables>;
export const CreateOauthAuthorizationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateOauthAuthorization"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateOauthAuthorizationInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createOauthAuthorization"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"redirectUri"}}]}}]}}]} as unknown as DocumentNode<CreateOauthAuthorizationMutation, CreateOauthAuthorizationMutationVariables>;
export const CreateProjectLabelDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateProjectLabel"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateProjectLabelInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createProjectLabel"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"projectLabel"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProjectLabelFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectLabelFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectLabel"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"isGroup"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<CreateProjectLabelMutation, CreateProjectLabelMutationVariables>;
export const UpdateProjectLabelDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateProjectLabel"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateProjectLabelInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateProjectLabel"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"projectLabel"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProjectLabelFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectLabelFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectLabel"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"isGroup"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UpdateProjectLabelMutation, UpdateProjectLabelMutationVariables>;
export const ArchiveProjectLabelDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ArchiveProjectLabel"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"archived"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"archiveProjectLabel"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"archived"},"value":{"kind":"Variable","name":{"kind":"Name","value":"archived"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<ArchiveProjectLabelMutation, ArchiveProjectLabelMutationVariables>;
export const AddProjectLabelDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AddProjectLabel"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"labelId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"addProjectLabel"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"projectId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}}},{"kind":"Argument","name":{"kind":"Name","value":"labelId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"labelId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"projectLabelLink"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProjectLabelLinkFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectLabelLinkFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectLabelLink"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"labelId"}},{"kind":"Field","name":{"kind":"Name","value":"groupId"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<AddProjectLabelMutation, AddProjectLabelMutationVariables>;
export const RemoveProjectLabelDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveProjectLabel"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"labelId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeProjectLabel"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"projectId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}}},{"kind":"Argument","name":{"kind":"Name","value":"labelId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"labelId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<RemoveProjectLabelMutation, RemoveProjectLabelMutationVariables>;
export const CreateProjectTemplateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateProjectTemplate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateProjectTemplateInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createProjectTemplate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"template"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProjectTemplateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectTemplateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectTemplate"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"properties"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<CreateProjectTemplateMutation, CreateProjectTemplateMutationVariables>;
export const UpdateProjectTemplateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateProjectTemplate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateProjectTemplateInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateProjectTemplate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"template"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProjectTemplateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectTemplateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectTemplate"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"properties"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UpdateProjectTemplateMutation, UpdateProjectTemplateMutationVariables>;
export const ArchiveProjectTemplateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ArchiveProjectTemplate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"archived"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"archiveProjectTemplate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"archived"},"value":{"kind":"Variable","name":{"kind":"Name","value":"archived"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<ArchiveProjectTemplateMutation, ArchiveProjectTemplateMutationVariables>;
export const CreateProjectTemplateMilestoneDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateProjectTemplateMilestone"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateProjectTemplateMilestoneInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createProjectTemplateMilestone"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"milestone"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProjectTemplateMilestoneFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectTemplateMilestoneFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectTemplateMilestone"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"projectTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"targetDate"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateProjectTemplateMilestoneMutation, CreateProjectTemplateMilestoneMutationVariables>;
export const UpdateProjectTemplateMilestoneDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateProjectTemplateMilestone"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateProjectTemplateMilestoneInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateProjectTemplateMilestone"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"milestone"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProjectTemplateMilestoneFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectTemplateMilestoneFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectTemplateMilestone"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"projectTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"targetDate"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UpdateProjectTemplateMilestoneMutation, UpdateProjectTemplateMilestoneMutationVariables>;
export const DeleteProjectTemplateMilestoneDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteProjectTemplateMilestone"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteProjectTemplateMilestone"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteProjectTemplateMilestoneMutation, DeleteProjectTemplateMilestoneMutationVariables>;
export const CreateProjectTemplateIssueDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateProjectTemplateIssue"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateProjectTemplateIssueInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createProjectTemplateIssue"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"issue"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProjectTemplateIssueFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectTemplateIssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectTemplateIssue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"projectTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"properties"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateProjectTemplateIssueMutation, CreateProjectTemplateIssueMutationVariables>;
export const UpdateProjectTemplateIssueDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateProjectTemplateIssue"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateProjectTemplateIssueInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateProjectTemplateIssue"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"issue"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProjectTemplateIssueFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectTemplateIssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectTemplateIssue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"projectTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"properties"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UpdateProjectTemplateIssueMutation, UpdateProjectTemplateIssueMutationVariables>;
export const DeleteProjectTemplateIssueDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteProjectTemplateIssue"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteProjectTemplateIssue"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteProjectTemplateIssueMutation, DeleteProjectTemplateIssueMutationVariables>;
export const CreateProjectUpdateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateProjectUpdate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateProjectUpdateInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createProjectUpdate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"projectUpdate"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProjectUpdateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectUpdateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectUpdate"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"health"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"authorId"}},{"kind":"Field","name":{"kind":"Name","value":"editedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateProjectUpdateMutation, CreateProjectUpdateMutationVariables>;
export const UpdateProjectUpdateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateProjectUpdate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateProjectUpdateInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateProjectUpdate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"projectUpdate"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProjectUpdateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectUpdateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectUpdate"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"health"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"authorId"}},{"kind":"Field","name":{"kind":"Name","value":"editedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UpdateProjectUpdateMutation, UpdateProjectUpdateMutationVariables>;
export const DeleteProjectUpdateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteProjectUpdate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteProjectUpdate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteProjectUpdateMutation, DeleteProjectUpdateMutationVariables>;
export const CreateProjectDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateProject"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateProjectInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createProject"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"project"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProjectFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Project"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"statusId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"leadId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"startDate"}},{"kind":"Field","name":{"kind":"Name","value":"startDateGranularity"}},{"kind":"Field","name":{"kind":"Name","value":"targetDate"}},{"kind":"Field","name":{"kind":"Name","value":"targetDateGranularity"}},{"kind":"Field","name":{"kind":"Name","value":"updateSchedule"}},{"kind":"Field","name":{"kind":"Name","value":"updateReminderIntervalDays"}},{"kind":"Field","name":{"kind":"Name","value":"updateReminderWeekday"}},{"kind":"Field","name":{"kind":"Name","value":"updateReminderHour"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedBy"}},{"kind":"Field","name":{"kind":"Name","value":"projectTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateProjectMutation, CreateProjectMutationVariables>;
export const UpdateProjectDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateProject"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateProjectInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateProject"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"project"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProjectFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Project"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"statusId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"leadId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"startDate"}},{"kind":"Field","name":{"kind":"Name","value":"startDateGranularity"}},{"kind":"Field","name":{"kind":"Name","value":"targetDate"}},{"kind":"Field","name":{"kind":"Name","value":"targetDateGranularity"}},{"kind":"Field","name":{"kind":"Name","value":"updateSchedule"}},{"kind":"Field","name":{"kind":"Name","value":"updateReminderIntervalDays"}},{"kind":"Field","name":{"kind":"Name","value":"updateReminderWeekday"}},{"kind":"Field","name":{"kind":"Name","value":"updateReminderHour"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedBy"}},{"kind":"Field","name":{"kind":"Name","value":"projectTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UpdateProjectMutation, UpdateProjectMutationVariables>;
export const DeleteProjectDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteProject"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteProject"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteProjectMutation, DeleteProjectMutationVariables>;
export const AddProjectTeamDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AddProjectTeam"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"addProjectTeam"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"projectId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}}},{"kind":"Argument","name":{"kind":"Name","value":"teamId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"projectTeam"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProjectTeamFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectTeamFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectTeam"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<AddProjectTeamMutation, AddProjectTeamMutationVariables>;
export const AddProjectMemberDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AddProjectMember"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"userId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"addProjectMember"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"projectId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}}},{"kind":"Argument","name":{"kind":"Name","value":"userId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"userId"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"projectMember"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProjectMemberFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectMemberFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectMember"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<AddProjectMemberMutation, AddProjectMemberMutationVariables>;
export const AddProjectDependencyDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AddProjectDependency"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"blockingProjectId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"blockedProjectId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"addProjectDependency"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"blockingProjectId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"blockingProjectId"}}},{"kind":"Argument","name":{"kind":"Name","value":"blockedProjectId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"blockedProjectId"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"projectDependency"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProjectDependencyFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectDependencyFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectDependency"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"blockingProjectId"}},{"kind":"Field","name":{"kind":"Name","value":"blockedProjectId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<AddProjectDependencyMutation, AddProjectDependencyMutationVariables>;
export const RemoveProjectDependencyDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveProjectDependency"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeProjectDependency"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<RemoveProjectDependencyMutation, RemoveProjectDependencyMutationVariables>;
export const CreateProjectStatusDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateProjectStatus"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateProjectStatusInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createProjectStatus"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"status"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProjectStatusFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectStatusFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectStatus"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"isDefault"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<CreateProjectStatusMutation, CreateProjectStatusMutationVariables>;
export const UpdateProjectStatusDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateProjectStatus"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateProjectStatusInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateProjectStatus"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"status"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProjectStatusFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectStatusFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectStatus"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"isDefault"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UpdateProjectStatusMutation, UpdateProjectStatusMutationVariables>;
export const ArchiveProjectStatusDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ArchiveProjectStatus"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"archived"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"archiveProjectStatus"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"archived"},"value":{"kind":"Variable","name":{"kind":"Name","value":"archived"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<ArchiveProjectStatusMutation, ArchiveProjectStatusMutationVariables>;
export const CreateProjectMilestoneDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateProjectMilestone"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateProjectMilestoneInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createProjectMilestone"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"milestone"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProjectMilestoneFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectMilestoneFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectMilestone"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"targetDate"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<CreateProjectMilestoneMutation, CreateProjectMilestoneMutationVariables>;
export const UpdateProjectMilestoneDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateProjectMilestone"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateProjectMilestoneInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateProjectMilestone"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"milestone"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProjectMilestoneFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectMilestoneFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectMilestone"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"targetDate"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UpdateProjectMilestoneMutation, UpdateProjectMilestoneMutationVariables>;
export const DeleteProjectMilestoneDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteProjectMilestone"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteProjectMilestone"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteProjectMilestoneMutation, DeleteProjectMilestoneMutationVariables>;
export const CreatePulseFeedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreatePulseFeed"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreatePulseFeedInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createPulseFeed"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"pulseFeed"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"PulseFeedFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"PulseFeedFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"PulseFeed"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"projectIds"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreatePulseFeedMutation, CreatePulseFeedMutationVariables>;
export const UpdatePulseFeedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdatePulseFeed"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdatePulseFeedInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updatePulseFeed"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"pulseFeed"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"PulseFeedFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"PulseFeedFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"PulseFeed"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"projectIds"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UpdatePulseFeedMutation, UpdatePulseFeedMutationVariables>;
export const DeletePulseFeedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeletePulseFeed"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deletePulseFeed"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeletePulseFeedMutation, DeletePulseFeedMutationVariables>;
export const CreateRecurringIssueDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateRecurringIssue"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateRecurringIssueInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createRecurringIssue"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"recurringIssue"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"RecurringIssueFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"RecurringIssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RecurringIssue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"properties"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"cadence"}},{"kind":"Field","name":{"kind":"Name","value":"nextDueDate"}},{"kind":"Field","name":{"kind":"Name","value":"lastCreatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<CreateRecurringIssueMutation, CreateRecurringIssueMutationVariables>;
export const UpdateRecurringIssueDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateRecurringIssue"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateRecurringIssueInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateRecurringIssue"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"recurringIssue"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"RecurringIssueFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"RecurringIssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RecurringIssue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"properties"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"cadence"}},{"kind":"Field","name":{"kind":"Name","value":"nextDueDate"}},{"kind":"Field","name":{"kind":"Name","value":"lastCreatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UpdateRecurringIssueMutation, UpdateRecurringIssueMutationVariables>;
export const ArchiveRecurringIssueDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ArchiveRecurringIssue"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"archived"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"archiveRecurringIssue"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"archived"},"value":{"kind":"Variable","name":{"kind":"Name","value":"archived"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<ArchiveRecurringIssueMutation, ArchiveRecurringIssueMutationVariables>;
export const SearchDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Search"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SearchInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"search"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"issueCount"}},{"kind":"Field","name":{"kind":"Name","value":"issues"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"state"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"color"}}]}},{"kind":"Field","name":{"kind":"Name","value":"assignee"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"comments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]}}]} as unknown as DocumentNode<SearchQuery, SearchQueryVariables>;
export const SentrySettingsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"SentrySettings"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sentryWebhook"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"secret"}}]}}]}}]} as unknown as DocumentNode<SentrySettingsQuery, SentrySettingsQueryVariables>;
export const CreateSentryConnectionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateSentryConnection"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateSentryConnectionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createSentryConnection"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"sentryConnection"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SentryConnectionFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SentryConnectionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SentryConnection"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"organizationSlug"}},{"kind":"Field","name":{"kind":"Name","value":"connectedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateSentryConnectionMutation, CreateSentryConnectionMutationVariables>;
export const UpdateSentryConnectionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateSentryConnection"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateSentryConnectionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateSentryConnection"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"sentryConnection"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SentryConnectionFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SentryConnectionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SentryConnection"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"organizationSlug"}},{"kind":"Field","name":{"kind":"Name","value":"connectedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UpdateSentryConnectionMutation, UpdateSentryConnectionMutationVariables>;
export const DeleteSentryConnectionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteSentryConnection"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteSentryConnection"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteSentryConnectionMutation, DeleteSentryConnectionMutationVariables>;
export const AccountSessionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AccountSessions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"accountSessions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AccountSessionFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AccountSessionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AccountSession"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"label"}},{"kind":"Field","name":{"kind":"Name","value":"userAgent"}},{"kind":"Field","name":{"kind":"Name","value":"ip"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"current"}},{"kind":"Field","name":{"kind":"Name","value":"lastSeenAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}}]}}]} as unknown as DocumentNode<AccountSessionsQuery, AccountSessionsQueryVariables>;
export const RevokeAccountSessionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RevokeAccountSession"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"revokeAccountSession"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<RevokeAccountSessionMutation, RevokeAccountSessionMutationVariables>;
export const RevokeOtherSessionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RevokeOtherSessions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"revokeOtherSessions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<RevokeOtherSessionsMutation, RevokeOtherSessionsMutationVariables>;
export const SlackInboundDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"SlackInbound"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"slackInbound"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"commandUrl"}},{"kind":"Field","name":{"kind":"Name","value":"eventsUrl"}},{"kind":"Field","name":{"kind":"Name","value":"webhookConfigured"}},{"kind":"Field","name":{"kind":"Name","value":"signingSecretConfigured"}},{"kind":"Field","name":{"kind":"Name","value":"botTokenConfigured"}}]}}]}}]} as unknown as DocumentNode<SlackInboundQuery, SlackInboundQueryVariables>;
export const CreateSlackConnectionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateSlackConnection"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateSlackConnectionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createSlackConnection"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"slackConnection"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SlackConnectionFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SlackConnectionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SlackConnection"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"channelName"}},{"kind":"Field","name":{"kind":"Name","value":"notifyIssues"}},{"kind":"Field","name":{"kind":"Name","value":"notifyComments"}},{"kind":"Field","name":{"kind":"Name","value":"asksEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"connectedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateSlackConnectionMutation, CreateSlackConnectionMutationVariables>;
export const UpdateSlackConnectionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateSlackConnection"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateSlackConnectionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateSlackConnection"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"slackConnection"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SlackConnectionFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SlackConnectionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SlackConnection"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"channelName"}},{"kind":"Field","name":{"kind":"Name","value":"notifyIssues"}},{"kind":"Field","name":{"kind":"Name","value":"notifyComments"}},{"kind":"Field","name":{"kind":"Name","value":"asksEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"connectedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UpdateSlackConnectionMutation, UpdateSlackConnectionMutationVariables>;
export const DeleteSlackConnectionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteSlackConnection"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteSlackConnection"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteSlackConnectionMutation, DeleteSlackConnectionMutationVariables>;
export const CreateSlaRuleDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateSlaRule"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateSlaRuleInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createSlaRule"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"slaRule"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SlaRuleFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SlaRuleFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SlaRule"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"filter"}},{"kind":"Field","name":{"kind":"Name","value":"action"}},{"kind":"Field","name":{"kind":"Name","value":"durationMinutes"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateSlaRuleMutation, CreateSlaRuleMutationVariables>;
export const UpdateSlaRuleDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateSlaRule"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateSlaRuleInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateSlaRule"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"slaRule"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SlaRuleFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SlaRuleFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SlaRule"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"filter"}},{"kind":"Field","name":{"kind":"Name","value":"action"}},{"kind":"Field","name":{"kind":"Name","value":"durationMinutes"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UpdateSlaRuleMutation, UpdateSlaRuleMutationVariables>;
export const DeleteSlaRuleDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteSlaRule"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteSlaRule"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteSlaRuleMutation, DeleteSlaRuleMutationVariables>;
export const SetIssueSlaDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetIssueSla"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SetIssueSlaInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setIssueSla"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"issue"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IssueFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Issue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"stateId"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"estimate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDateSource"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"subIssueSortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"formTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"recurringIssueId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"projectMilestoneId"}},{"kind":"Field","name":{"kind":"Name","value":"cycleId"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"autoClosedAt"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"canceledAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<SetIssueSlaMutation, SetIssueSlaMutationVariables>;
export const ClearIssueSlaDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ClearIssueSla"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"issueId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"clearIssueSla"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"issueId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"issueId"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"issue"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IssueFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Issue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"stateId"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"estimate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDateSource"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"subIssueSortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"formTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"recurringIssueId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"projectMilestoneId"}},{"kind":"Field","name":{"kind":"Name","value":"cycleId"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"autoClosedAt"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"canceledAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<ClearIssueSlaMutation, ClearIssueSlaMutationVariables>;
export const SetProjectSubscriptionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetProjectSubscription"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SetProjectSubscriptionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setProjectSubscription"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"projectSubscription"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProjectSubscriptionFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProjectSubscriptionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProjectSubscription"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"issuesAdded"}},{"kind":"Field","name":{"kind":"Name","value":"issuesCompleted"}},{"kind":"Field","name":{"kind":"Name","value":"updates"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<SetProjectSubscriptionMutation, SetProjectSubscriptionMutationVariables>;
export const DeleteProjectSubscriptionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteProjectSubscription"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteProjectSubscription"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"projectId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteProjectSubscriptionMutation, DeleteProjectSubscriptionMutationVariables>;
export const SetInitiativeSubscriptionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetInitiativeSubscription"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SetInitiativeSubscriptionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setInitiativeSubscription"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"initiativeSubscription"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"InitiativeSubscriptionFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"InitiativeSubscriptionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"InitiativeSubscription"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"initiativeId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"issuesAdded"}},{"kind":"Field","name":{"kind":"Name","value":"issuesCompleted"}},{"kind":"Field","name":{"kind":"Name","value":"updates"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<SetInitiativeSubscriptionMutation, SetInitiativeSubscriptionMutationVariables>;
export const DeleteInitiativeSubscriptionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteInitiativeSubscription"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"initiativeId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteInitiativeSubscription"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"initiativeId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"initiativeId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteInitiativeSubscriptionMutation, DeleteInitiativeSubscriptionMutationVariables>;
export const SetCustomerSubscriptionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetCustomerSubscription"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SetCustomerSubscriptionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setCustomerSubscription"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"customerSubscription"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CustomerSubscriptionFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CustomerSubscriptionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"CustomerSubscription"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"customerId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"requestAdded"}},{"kind":"Field","name":{"kind":"Name","value":"requestImportant"}},{"kind":"Field","name":{"kind":"Name","value":"requestCompleted"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<SetCustomerSubscriptionMutation, SetCustomerSubscriptionMutationVariables>;
export const DeleteCustomerSubscriptionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteCustomerSubscription"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"customerId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteCustomerSubscription"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"customerId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"customerId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteCustomerSubscriptionMutation, DeleteCustomerSubscriptionMutationVariables>;
export const DeletedTeamsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"DeletedTeams"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deletedTeams"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"TeamFields"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TeamFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Team"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"parentTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"private"}},{"kind":"Field","name":{"kind":"Name","value":"estimateScale"}},{"kind":"Field","name":{"kind":"Name","value":"estimateAllowZero"}},{"kind":"Field","name":{"kind":"Name","value":"estimateExtended"}},{"kind":"Field","name":{"kind":"Name","value":"cyclesEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"cycleDurationWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleCooldownWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleStartDay"}},{"kind":"Field","name":{"kind":"Name","value":"cycleUpcomingCount"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddStarted"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddCompleted"}},{"kind":"Field","name":{"kind":"Name","value":"triageEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"triageRequirePriority"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoArchiveDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseParent"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseChildren"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTemplateForMembersId"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTemplateForNonMembersId"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeAddress"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"retiredAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<DeletedTeamsQuery, DeletedTeamsQueryVariables>;
export const RetireTeamDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RetireTeam"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"retireTeam"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"team"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"TeamFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TeamFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Team"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"parentTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"private"}},{"kind":"Field","name":{"kind":"Name","value":"estimateScale"}},{"kind":"Field","name":{"kind":"Name","value":"estimateAllowZero"}},{"kind":"Field","name":{"kind":"Name","value":"estimateExtended"}},{"kind":"Field","name":{"kind":"Name","value":"cyclesEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"cycleDurationWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleCooldownWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleStartDay"}},{"kind":"Field","name":{"kind":"Name","value":"cycleUpcomingCount"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddStarted"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddCompleted"}},{"kind":"Field","name":{"kind":"Name","value":"triageEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"triageRequirePriority"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoArchiveDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseParent"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseChildren"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTemplateForMembersId"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTemplateForNonMembersId"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeAddress"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"retiredAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<RetireTeamMutation, RetireTeamMutationVariables>;
export const UnretireTeamDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UnretireTeam"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"unretireTeam"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"team"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"TeamFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TeamFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Team"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"parentTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"private"}},{"kind":"Field","name":{"kind":"Name","value":"estimateScale"}},{"kind":"Field","name":{"kind":"Name","value":"estimateAllowZero"}},{"kind":"Field","name":{"kind":"Name","value":"estimateExtended"}},{"kind":"Field","name":{"kind":"Name","value":"cyclesEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"cycleDurationWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleCooldownWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleStartDay"}},{"kind":"Field","name":{"kind":"Name","value":"cycleUpcomingCount"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddStarted"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddCompleted"}},{"kind":"Field","name":{"kind":"Name","value":"triageEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"triageRequirePriority"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoArchiveDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseParent"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseChildren"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTemplateForMembersId"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTemplateForNonMembersId"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeAddress"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"retiredAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UnretireTeamMutation, UnretireTeamMutationVariables>;
export const DeleteTeamDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteTeam"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteTeam"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteTeamMutation, DeleteTeamMutationVariables>;
export const RestoreTeamDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RestoreTeam"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"restoreTeam"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"team"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"TeamFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TeamFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Team"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"parentTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"private"}},{"kind":"Field","name":{"kind":"Name","value":"estimateScale"}},{"kind":"Field","name":{"kind":"Name","value":"estimateAllowZero"}},{"kind":"Field","name":{"kind":"Name","value":"estimateExtended"}},{"kind":"Field","name":{"kind":"Name","value":"cyclesEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"cycleDurationWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleCooldownWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleStartDay"}},{"kind":"Field","name":{"kind":"Name","value":"cycleUpcomingCount"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddStarted"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddCompleted"}},{"kind":"Field","name":{"kind":"Name","value":"triageEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"triageRequirePriority"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoArchiveDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseParent"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseChildren"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTemplateForMembersId"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTemplateForNonMembersId"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeAddress"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"retiredAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<RestoreTeamMutation, RestoreTeamMutationVariables>;
export const MoveTeamDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MoveTeam"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"parentTeamId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"moveTeam"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"teamId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}}},{"kind":"Argument","name":{"kind":"Name","value":"parentTeamId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"parentTeamId"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"team"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"TeamFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TeamFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Team"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"parentTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"private"}},{"kind":"Field","name":{"kind":"Name","value":"estimateScale"}},{"kind":"Field","name":{"kind":"Name","value":"estimateAllowZero"}},{"kind":"Field","name":{"kind":"Name","value":"estimateExtended"}},{"kind":"Field","name":{"kind":"Name","value":"cyclesEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"cycleDurationWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleCooldownWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleStartDay"}},{"kind":"Field","name":{"kind":"Name","value":"cycleUpcomingCount"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddStarted"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddCompleted"}},{"kind":"Field","name":{"kind":"Name","value":"triageEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"triageRequirePriority"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoArchiveDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseParent"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseChildren"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTemplateForMembersId"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTemplateForNonMembersId"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeAddress"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"retiredAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<MoveTeamMutation, MoveTeamMutationVariables>;
export const AddTeamMemberDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AddTeamMember"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"userId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"role"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"TeamRole"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"addTeamMember"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"teamId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}}},{"kind":"Argument","name":{"kind":"Name","value":"userId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"userId"}}},{"kind":"Argument","name":{"kind":"Name","value":"role"},"value":{"kind":"Variable","name":{"kind":"Name","value":"role"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"membership"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]}}]} as unknown as DocumentNode<AddTeamMemberMutation, AddTeamMemberMutationVariables>;
export const RemoveTeamMemberDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveTeamMember"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"userId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeTeamMember"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"teamId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"teamId"}}},{"kind":"Argument","name":{"kind":"Name","value":"userId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"userId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<RemoveTeamMemberMutation, RemoveTeamMemberMutationVariables>;
export const CreateIssueTemplateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateIssueTemplate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateIssueTemplateInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createIssueTemplate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"template"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IssueTemplateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueTemplateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IssueTemplate"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"properties"}},{"kind":"Field","name":{"kind":"Name","value":"subIssues"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"title"}}]}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeAddress"}}]}}]} as unknown as DocumentNode<CreateIssueTemplateMutation, CreateIssueTemplateMutationVariables>;
export const UpdateIssueTemplateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateIssueTemplate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateIssueTemplateInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateIssueTemplate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"template"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IssueTemplateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueTemplateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IssueTemplate"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"properties"}},{"kind":"Field","name":{"kind":"Name","value":"subIssues"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"title"}}]}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeAddress"}}]}}]} as unknown as DocumentNode<UpdateIssueTemplateMutation, UpdateIssueTemplateMutationVariables>;
export const ArchiveIssueTemplateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ArchiveIssueTemplate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"archived"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"archiveIssueTemplate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"archived"},"value":{"kind":"Variable","name":{"kind":"Name","value":"archived"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<ArchiveIssueTemplateMutation, ArchiveIssueTemplateMutationVariables>;
export const UpdateIssueTemplateEmailIntakeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateIssueTemplateEmailIntake"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateIssueTemplateEmailIntakeInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateIssueTemplateEmailIntake"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"template"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IssueTemplateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueTemplateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IssueTemplate"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"properties"}},{"kind":"Field","name":{"kind":"Name","value":"subIssues"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"title"}}]}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeAddress"}}]}}]} as unknown as DocumentNode<UpdateIssueTemplateEmailIntakeMutation, UpdateIssueTemplateEmailIntakeMutationVariables>;
export const DeletedIssuesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"DeletedIssues"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deletedIssues"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IssueFields"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"deletedBy"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Issue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"stateId"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"estimate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDateSource"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"subIssueSortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"formTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"recurringIssueId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"projectMilestoneId"}},{"kind":"Field","name":{"kind":"Name","value":"cycleId"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"autoClosedAt"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"canceledAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<DeletedIssuesQuery, DeletedIssuesQueryVariables>;
export const RestoreIssueDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RestoreIssue"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"restoreIssue"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"issue"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IssueFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Issue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"stateId"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"estimate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDateSource"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"subIssueSortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"formTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"recurringIssueId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"projectMilestoneId"}},{"kind":"Field","name":{"kind":"Name","value":"cycleId"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"autoClosedAt"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"canceledAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<RestoreIssueMutation, RestoreIssueMutationVariables>;
export const CreateViewDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateView"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateViewInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createView"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"view"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ViewFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ViewFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"View"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"filter"}},{"kind":"Field","name":{"kind":"Name","value":"display"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<CreateViewMutation, CreateViewMutationVariables>;
export const UpdateViewDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateView"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateViewInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateView"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"view"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ViewFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ViewFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"View"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"ownerId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"filter"}},{"kind":"Field","name":{"kind":"Name","value":"display"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UpdateViewMutation, UpdateViewMutationVariables>;
export const DeleteViewDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteView"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteView"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteViewMutation, DeleteViewMutationVariables>;
export const SetViewPreferenceDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetViewPreference"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"viewKey"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"display"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"JSON"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setViewPreference"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"viewKey"},"value":{"kind":"Variable","name":{"kind":"Name","value":"viewKey"}}},{"kind":"Argument","name":{"kind":"Name","value":"display"},"value":{"kind":"Variable","name":{"kind":"Name","value":"display"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"preference"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ViewPreferenceFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ViewPreferenceFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ViewPreference"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"viewKey"}},{"kind":"Field","name":{"kind":"Name","value":"display"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<SetViewPreferenceMutation, SetViewPreferenceMutationVariables>;
export const AddFavoriteDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AddFavorite"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"kind"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"FavoriteKind"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"targetId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"afterFavoriteId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"addFavorite"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"kind"},"value":{"kind":"Variable","name":{"kind":"Name","value":"kind"}}},{"kind":"Argument","name":{"kind":"Name","value":"targetId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"targetId"}}},{"kind":"Argument","name":{"kind":"Name","value":"afterFavoriteId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"afterFavoriteId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"favorite"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"FavoriteFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"FavoriteFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Favorite"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"targetId"}},{"kind":"Field","name":{"kind":"Name","value":"folderId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<AddFavoriteMutation, AddFavoriteMutationVariables>;
export const RemoveFavoriteDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveFavorite"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"kind"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"FavoriteKind"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"targetId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeFavorite"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"kind"},"value":{"kind":"Variable","name":{"kind":"Name","value":"kind"}}},{"kind":"Argument","name":{"kind":"Name","value":"targetId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"targetId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<RemoveFavoriteMutation, RemoveFavoriteMutationVariables>;
export const CreateFavoriteFolderDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateFavoriteFolder"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"afterFavoriteId"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createFavoriteFolder"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"afterFavoriteId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"afterFavoriteId"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"favorite"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"FavoriteFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"FavoriteFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Favorite"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"targetId"}},{"kind":"Field","name":{"kind":"Name","value":"folderId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateFavoriteFolderMutation, CreateFavoriteFolderMutationVariables>;
export const UpdateFavoriteFolderDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateFavoriteFolder"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateFavoriteFolder"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"favorite"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"FavoriteFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"FavoriteFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Favorite"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"targetId"}},{"kind":"Field","name":{"kind":"Name","value":"folderId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UpdateFavoriteFolderMutation, UpdateFavoriteFolderMutationVariables>;
export const MoveFavoriteDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MoveFavorite"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MoveFavoriteInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"moveFavorite"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"favorite"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"FavoriteFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"FavoriteFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Favorite"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"targetId"}},{"kind":"Field","name":{"kind":"Name","value":"folderId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<MoveFavoriteMutation, MoveFavoriteMutationVariables>;
export const SetViewSubscriptionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetViewSubscription"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SetViewSubscriptionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setViewSubscription"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"viewSubscription"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ViewSubscriptionFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ViewSubscriptionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ViewSubscription"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"viewId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"added"}},{"kind":"Field","name":{"kind":"Name","value":"completed"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<SetViewSubscriptionMutation, SetViewSubscriptionMutationVariables>;
export const DeleteViewSubscriptionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteViewSubscription"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"viewId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteViewSubscription"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"viewId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"viewId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteViewSubscriptionMutation, DeleteViewSubscriptionMutationVariables>;
export const WebhooksDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Webhooks"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"webhooks"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WebhookSummary"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WebhookSummary"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Webhook"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"allPublicTeams"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"resourceTypes"}},{"kind":"Field","name":{"kind":"Name","value":"consecutiveFailures"}},{"kind":"Field","name":{"kind":"Name","value":"disabledAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<WebhooksQuery, WebhooksQueryVariables>;
export const WebhookDeliveriesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"WebhookDeliveries"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"webhookId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"webhookDeliveries"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"webhookId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"webhookId"}}},{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"IntValue","value":"20"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"attempt"}},{"kind":"Field","name":{"kind":"Name","value":"lastStatus"}},{"kind":"Field","name":{"kind":"Name","value":"lastError"}},{"kind":"Field","name":{"kind":"Name","value":"deliveredAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}}]}}]}}]} as unknown as DocumentNode<WebhookDeliveriesQuery, WebhookDeliveriesQueryVariables>;
export const CreateWebhookDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateWebhook"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateWebhookInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createWebhook"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"created"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"secret"}},{"kind":"Field","name":{"kind":"Name","value":"webhook"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WebhookSummary"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WebhookSummary"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Webhook"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"allPublicTeams"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"resourceTypes"}},{"kind":"Field","name":{"kind":"Name","value":"consecutiveFailures"}},{"kind":"Field","name":{"kind":"Name","value":"disabledAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<CreateWebhookMutation, CreateWebhookMutationVariables>;
export const UpdateWebhookDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateWebhook"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateWebhookInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateWebhook"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"webhook"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WebhookSummary"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WebhookSummary"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Webhook"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"allPublicTeams"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"resourceTypes"}},{"kind":"Field","name":{"kind":"Name","value":"consecutiveFailures"}},{"kind":"Field","name":{"kind":"Name","value":"disabledAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<UpdateWebhookMutation, UpdateWebhookMutationVariables>;
export const DeleteWebhookDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteWebhook"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteWebhook"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteWebhookMutation, DeleteWebhookMutationVariables>;
export const UpdateWorkspaceDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateWorkspace"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateWorkspaceInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateWorkspace"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"workspace"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkspaceFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkspaceFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Workspace"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"urlKey"}},{"kind":"Field","name":{"kind":"Name","value":"logoUrl"}},{"kind":"Field","name":{"kind":"Name","value":"plan"}},{"kind":"Field","name":{"kind":"Name","value":"planExpiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"planLapsedAt"}},{"kind":"Field","name":{"kind":"Name","value":"seatLimit"}},{"kind":"Field","name":{"kind":"Name","value":"projectUpdateReminderIntervalDays"}},{"kind":"Field","name":{"kind":"Name","value":"projectUpdateReminderWeekday"}},{"kind":"Field","name":{"kind":"Name","value":"projectUpdateReminderHour"}},{"kind":"Field","name":{"kind":"Name","value":"pulseEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"pulseDigestCadence"}},{"kind":"Field","name":{"kind":"Name","value":"customerRequestsEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"customerDefaultTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"customerRevenueUnit"}},{"kind":"Field","name":{"kind":"Name","value":"customerTiers"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UpdateWorkspaceMutation, UpdateWorkspaceMutationVariables>;
export const AddReactionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AddReaction"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"commentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"emoji"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"addReaction"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"commentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"commentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"emoji"},"value":{"kind":"Variable","name":{"kind":"Name","value":"emoji"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"reaction"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ReactionFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ReactionFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Reaction"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"commentId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"emoji"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<AddReactionMutation, AddReactionMutationVariables>;
export const RemoveReactionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveReaction"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"commentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"emoji"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeReaction"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"commentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"commentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"emoji"},"value":{"kind":"Variable","name":{"kind":"Name","value":"emoji"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<RemoveReactionMutation, RemoveReactionMutationVariables>;
export const ViewerDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Viewer"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"viewer"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"syncVersion"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"UserFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"workspace"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"urlKey"}},{"kind":"Field","name":{"kind":"Name","value":"logoUrl"}},{"kind":"Field","name":{"kind":"Name","value":"plan"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"workspaces"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"urlKey"}},{"kind":"Field","name":{"kind":"Name","value":"logoUrl"}},{"kind":"Field","name":{"kind":"Name","value":"plan"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"UserFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"User"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"notificationPrefs"}},{"kind":"Field","name":{"kind":"Name","value":"lastSeenAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<ViewerQuery, ViewerQueryVariables>;
export const IssueDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"IssueDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"comments"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"issueId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CommentFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"issueHistory"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"issueId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"fromValue"}},{"kind":"Field","name":{"kind":"Name","value":"toValue"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"actor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CommentFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Comment"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"actor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"editedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedBy"}},{"kind":"Field","name":{"kind":"Name","value":"anchorStart"}},{"kind":"Field","name":{"kind":"Name","value":"anchorEnd"}},{"kind":"Field","name":{"kind":"Name","value":"quote"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<IssueDetailQuery, IssueDetailQueryVariables>;
export const CreateIssueDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateIssue"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateIssueInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createIssue"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"issue"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IssueFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Issue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"stateId"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"estimate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDateSource"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"subIssueSortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"formTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"recurringIssueId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"projectMilestoneId"}},{"kind":"Field","name":{"kind":"Name","value":"cycleId"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"autoClosedAt"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"canceledAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateIssueMutation, CreateIssueMutationVariables>;
export const UpdateIssueDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateIssue"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateIssueInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateIssue"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"issue"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IssueFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Issue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"stateId"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"estimate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDateSource"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"subIssueSortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"formTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"recurringIssueId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"projectMilestoneId"}},{"kind":"Field","name":{"kind":"Name","value":"cycleId"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"autoClosedAt"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"canceledAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UpdateIssueMutation, UpdateIssueMutationVariables>;
export const ArchiveIssueDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ArchiveIssue"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"archived"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"archiveIssue"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"archived"},"value":{"kind":"Variable","name":{"kind":"Name","value":"archived"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<ArchiveIssueMutation, ArchiveIssueMutationVariables>;
export const DeleteIssueDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteIssue"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteIssue"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteIssueMutation, DeleteIssueMutationVariables>;
export const CreateCommentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateComment"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateCommentInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createComment"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"comment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CommentFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CommentFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Comment"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"actor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"editedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedBy"}},{"kind":"Field","name":{"kind":"Name","value":"anchorStart"}},{"kind":"Field","name":{"kind":"Name","value":"anchorEnd"}},{"kind":"Field","name":{"kind":"Name","value":"quote"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateCommentMutation, CreateCommentMutationVariables>;
export const UpdateCommentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateComment"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"body"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateComment"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"body"},"value":{"kind":"Variable","name":{"kind":"Name","value":"body"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"comment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CommentFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CommentFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Comment"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"actor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"editedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedBy"}},{"kind":"Field","name":{"kind":"Name","value":"anchorStart"}},{"kind":"Field","name":{"kind":"Name","value":"anchorEnd"}},{"kind":"Field","name":{"kind":"Name","value":"quote"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UpdateCommentMutation, UpdateCommentMutationVariables>;
export const DeleteCommentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteComment"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteComment"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteCommentMutation, DeleteCommentMutationVariables>;
export const ResolveCommentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ResolveComment"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"resolved"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"resolveComment"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"resolved"},"value":{"kind":"Variable","name":{"kind":"Name","value":"resolved"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"comment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CommentFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CommentFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Comment"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"actor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"editedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedBy"}},{"kind":"Field","name":{"kind":"Name","value":"anchorStart"}},{"kind":"Field","name":{"kind":"Name","value":"anchorEnd"}},{"kind":"Field","name":{"kind":"Name","value":"quote"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<ResolveCommentMutation, ResolveCommentMutationVariables>;
export const CreateAttachmentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateAttachment"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateAttachmentInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createAttachment"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"attachment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AttachmentFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AttachmentFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Attachment"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"subtitle"}},{"kind":"Field","name":{"kind":"Name","value":"iconUrl"}},{"kind":"Field","name":{"kind":"Name","value":"metadata"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<CreateAttachmentMutation, CreateAttachmentMutationVariables>;
export const UpdateAttachmentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateAttachment"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateAttachmentInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateAttachment"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"attachment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AttachmentFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AttachmentFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Attachment"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"issueId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"subtitle"}},{"kind":"Field","name":{"kind":"Name","value":"iconUrl"}},{"kind":"Field","name":{"kind":"Name","value":"metadata"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UpdateAttachmentMutation, UpdateAttachmentMutationVariables>;
export const DeleteAttachmentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteAttachment"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteAttachment"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteAttachmentMutation, DeleteAttachmentMutationVariables>;
export const CreateTeamDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateTeam"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateTeamInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createTeam"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"team"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"TeamFields"}},{"kind":"Field","name":{"kind":"Name","value":"states"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"StateFields"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TeamFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Team"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"parentTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"private"}},{"kind":"Field","name":{"kind":"Name","value":"estimateScale"}},{"kind":"Field","name":{"kind":"Name","value":"estimateAllowZero"}},{"kind":"Field","name":{"kind":"Name","value":"estimateExtended"}},{"kind":"Field","name":{"kind":"Name","value":"cyclesEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"cycleDurationWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleCooldownWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleStartDay"}},{"kind":"Field","name":{"kind":"Name","value":"cycleUpcomingCount"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddStarted"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddCompleted"}},{"kind":"Field","name":{"kind":"Name","value":"triageEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"triageRequirePriority"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoArchiveDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseParent"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseChildren"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTemplateForMembersId"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTemplateForNonMembersId"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeAddress"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"retiredAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"StateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkflowState"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"isDefault"}},{"kind":"Field","name":{"kind":"Name","value":"isSystem"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<CreateTeamMutation, CreateTeamMutationVariables>;
export const UpdateTeamDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateTeam"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateTeamInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateTeam"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"team"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"TeamFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TeamFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Team"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"parentTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"private"}},{"kind":"Field","name":{"kind":"Name","value":"estimateScale"}},{"kind":"Field","name":{"kind":"Name","value":"estimateAllowZero"}},{"kind":"Field","name":{"kind":"Name","value":"estimateExtended"}},{"kind":"Field","name":{"kind":"Name","value":"cyclesEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"cycleDurationWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleCooldownWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleStartDay"}},{"kind":"Field","name":{"kind":"Name","value":"cycleUpcomingCount"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddStarted"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddCompleted"}},{"kind":"Field","name":{"kind":"Name","value":"triageEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"triageRequirePriority"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoArchiveDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseParent"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseChildren"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTemplateForMembersId"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTemplateForNonMembersId"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeAddress"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"retiredAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UpdateTeamMutation, UpdateTeamMutationVariables>;
export const UpdateTeamCyclesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateTeamCycles"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateTeamCyclesInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateTeamCycles"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"team"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"TeamFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TeamFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Team"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"parentTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"private"}},{"kind":"Field","name":{"kind":"Name","value":"estimateScale"}},{"kind":"Field","name":{"kind":"Name","value":"estimateAllowZero"}},{"kind":"Field","name":{"kind":"Name","value":"estimateExtended"}},{"kind":"Field","name":{"kind":"Name","value":"cyclesEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"cycleDurationWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleCooldownWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleStartDay"}},{"kind":"Field","name":{"kind":"Name","value":"cycleUpcomingCount"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddStarted"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddCompleted"}},{"kind":"Field","name":{"kind":"Name","value":"triageEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"triageRequirePriority"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoArchiveDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseParent"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseChildren"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTemplateForMembersId"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTemplateForNonMembersId"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeAddress"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"retiredAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UpdateTeamCyclesMutation, UpdateTeamCyclesMutationVariables>;
export const UpdateTeamTriageDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateTeamTriage"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateTeamTriageInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateTeamTriage"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"team"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"TeamFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TeamFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Team"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"parentTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"private"}},{"kind":"Field","name":{"kind":"Name","value":"estimateScale"}},{"kind":"Field","name":{"kind":"Name","value":"estimateAllowZero"}},{"kind":"Field","name":{"kind":"Name","value":"estimateExtended"}},{"kind":"Field","name":{"kind":"Name","value":"cyclesEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"cycleDurationWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleCooldownWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleStartDay"}},{"kind":"Field","name":{"kind":"Name","value":"cycleUpcomingCount"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddStarted"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddCompleted"}},{"kind":"Field","name":{"kind":"Name","value":"triageEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"triageRequirePriority"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoArchiveDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseParent"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseChildren"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTemplateForMembersId"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTemplateForNonMembersId"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeAddress"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"retiredAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UpdateTeamTriageMutation, UpdateTeamTriageMutationVariables>;
export const UpdateTeamEmailIntakeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateTeamEmailIntake"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateTeamEmailIntakeInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateTeamEmailIntake"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"team"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"TeamFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TeamFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Team"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"parentTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"private"}},{"kind":"Field","name":{"kind":"Name","value":"estimateScale"}},{"kind":"Field","name":{"kind":"Name","value":"estimateAllowZero"}},{"kind":"Field","name":{"kind":"Name","value":"estimateExtended"}},{"kind":"Field","name":{"kind":"Name","value":"cyclesEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"cycleDurationWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleCooldownWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleStartDay"}},{"kind":"Field","name":{"kind":"Name","value":"cycleUpcomingCount"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddStarted"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddCompleted"}},{"kind":"Field","name":{"kind":"Name","value":"triageEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"triageRequirePriority"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoArchiveDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseParent"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseChildren"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTemplateForMembersId"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTemplateForNonMembersId"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeAddress"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"retiredAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UpdateTeamEmailIntakeMutation, UpdateTeamEmailIntakeMutationVariables>;
export const UpdateTeamArchiveDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateTeamArchive"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateTeamArchiveInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateTeamArchive"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"team"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"TeamFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TeamFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Team"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"parentTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"private"}},{"kind":"Field","name":{"kind":"Name","value":"estimateScale"}},{"kind":"Field","name":{"kind":"Name","value":"estimateAllowZero"}},{"kind":"Field","name":{"kind":"Name","value":"estimateExtended"}},{"kind":"Field","name":{"kind":"Name","value":"cyclesEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"cycleDurationWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleCooldownWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleStartDay"}},{"kind":"Field","name":{"kind":"Name","value":"cycleUpcomingCount"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddStarted"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddCompleted"}},{"kind":"Field","name":{"kind":"Name","value":"triageEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"triageRequirePriority"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoArchiveDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseParent"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseChildren"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTemplateForMembersId"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTemplateForNonMembersId"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeAddress"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"retiredAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UpdateTeamArchiveMutation, UpdateTeamArchiveMutationVariables>;
export const UpdateTeamTemplatesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateTeamTemplates"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateTeamTemplatesInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateTeamTemplates"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"team"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"TeamFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TeamFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Team"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"icon"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"parentTeamId"}},{"kind":"Field","name":{"kind":"Name","value":"private"}},{"kind":"Field","name":{"kind":"Name","value":"estimateScale"}},{"kind":"Field","name":{"kind":"Name","value":"estimateAllowZero"}},{"kind":"Field","name":{"kind":"Name","value":"estimateExtended"}},{"kind":"Field","name":{"kind":"Name","value":"cyclesEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"cycleDurationWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleCooldownWeeks"}},{"kind":"Field","name":{"kind":"Name","value":"cycleStartDay"}},{"kind":"Field","name":{"kind":"Name","value":"cycleUpcomingCount"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddStarted"}},{"kind":"Field","name":{"kind":"Name","value":"cycleAutoAddCompleted"}},{"kind":"Field","name":{"kind":"Name","value":"triageEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"triageRequirePriority"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoArchiveDays"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseParent"}},{"kind":"Field","name":{"kind":"Name","value":"autoCloseChildren"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTemplateForMembersId"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTemplateForNonMembersId"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"emailIntakeAddress"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"retiredAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UpdateTeamTemplatesMutation, UpdateTeamTemplatesMutationVariables>;
export const AcceptTriageIssueDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AcceptTriageIssue"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"acceptTriageIssue"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"issue"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IssueFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Issue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"stateId"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"estimate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDateSource"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"subIssueSortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"formTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"recurringIssueId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"projectMilestoneId"}},{"kind":"Field","name":{"kind":"Name","value":"cycleId"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"autoClosedAt"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"canceledAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<AcceptTriageIssueMutation, AcceptTriageIssueMutationVariables>;
export const DeclineTriageIssueDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeclineTriageIssue"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"declineTriageIssue"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"issue"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IssueFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Issue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"stateId"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"estimate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDateSource"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"subIssueSortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"formTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"recurringIssueId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"projectMilestoneId"}},{"kind":"Field","name":{"kind":"Name","value":"cycleId"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"autoClosedAt"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"canceledAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<DeclineTriageIssueMutation, DeclineTriageIssueMutationVariables>;
export const MarkIssueDuplicateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MarkIssueDuplicate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"canonicalId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"markIssueDuplicate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"canonicalId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"canonicalId"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"issue"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IssueFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Issue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"stateId"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"estimate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDateSource"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"subIssueSortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"formTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"recurringIssueId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"projectMilestoneId"}},{"kind":"Field","name":{"kind":"Name","value":"cycleId"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"autoClosedAt"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"canceledAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<MarkIssueDuplicateMutation, MarkIssueDuplicateMutationVariables>;
export const SnoozeIssueDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SnoozeIssue"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"until"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Time"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"snoozeIssue"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"until"},"value":{"kind":"Variable","name":{"kind":"Name","value":"until"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"issue"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IssueFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IssueFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Issue"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"stateId"}},{"kind":"Field","name":{"kind":"Name","value":"assigneeId"}},{"kind":"Field","name":{"kind":"Name","value":"creatorId"}},{"kind":"Field","name":{"kind":"Name","value":"priority"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"estimate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDate"}},{"kind":"Field","name":{"kind":"Name","value":"dueDateSource"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"subIssueSortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"formTemplateId"}},{"kind":"Field","name":{"kind":"Name","value":"recurringIssueId"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"projectMilestoneId"}},{"kind":"Field","name":{"kind":"Name","value":"cycleId"}},{"kind":"Field","name":{"kind":"Name","value":"snoozedUntil"}},{"kind":"Field","name":{"kind":"Name","value":"autoClosedAt"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"canceledAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<SnoozeIssueMutation, SnoozeIssueMutationVariables>;
export const CreateWorkflowStateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateWorkflowState"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateWorkflowStateInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"opId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createWorkflowState"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"clientId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"clientId"}}},{"kind":"Argument","name":{"kind":"Name","value":"opId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"opId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"state"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"StateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"StateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkflowState"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"isDefault"}},{"kind":"Field","name":{"kind":"Name","value":"isSystem"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<CreateWorkflowStateMutation, CreateWorkflowStateMutationVariables>;
export const UpdateWorkflowStateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateWorkflowState"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateWorkflowStateInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateWorkflowState"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"state"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"StateFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"StateFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkflowState"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"teamId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"position"}},{"kind":"Field","name":{"kind":"Name","value":"isDefault"}},{"kind":"Field","name":{"kind":"Name","value":"isSystem"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UpdateWorkflowStateMutation, UpdateWorkflowStateMutationVariables>;
export const ArchiveWorkflowStateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ArchiveWorkflowState"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"archived"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"archiveWorkflowState"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"archived"},"value":{"kind":"Variable","name":{"kind":"Name","value":"archived"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<ArchiveWorkflowStateMutation, ArchiveWorkflowStateMutationVariables>;
export const SetUserRoleDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetUserRole"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"userId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"role"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserRole"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setUserRole"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"userId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"userId"}}},{"kind":"Argument","name":{"kind":"Name","value":"role"},"value":{"kind":"Variable","name":{"kind":"Name","value":"role"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"UserFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"UserFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"User"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"notificationPrefs"}},{"kind":"Field","name":{"kind":"Name","value":"lastSeenAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<SetUserRoleMutation, SetUserRoleMutationVariables>;
export const SuspendUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SuspendUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"userId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"suspended"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"suspendUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"userId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"userId"}}},{"kind":"Argument","name":{"kind":"Name","value":"suspended"},"value":{"kind":"Variable","name":{"kind":"Name","value":"suspended"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"UserFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"UserFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"User"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"notificationPrefs"}},{"kind":"Field","name":{"kind":"Name","value":"lastSeenAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<SuspendUserMutation, SuspendUserMutationVariables>;
export const UpdateProfileDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateProfile"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateProfileInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateProfile"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"UserFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"UserFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"User"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"workspaceId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"notificationPrefs"}},{"kind":"Field","name":{"kind":"Name","value":"lastSeenAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"archivedAt"}}]}}]} as unknown as DocumentNode<UpdateProfileMutation, UpdateProfileMutationVariables>;