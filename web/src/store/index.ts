/**
 * The local-first client store.
 *
 * Three layers, and the boundary between them is the point of the whole package:
 *
 *   `db.ts`      IndexedDB — durability. Touched at boot and on write, never on read.
 *   `store.ts`   the in-memory replica and its indexes — what every view renders from.
 *   `query.ts`   synchronous filter/group/sort over those indexes.
 *
 * `outbox.ts` sits beside them holding mutations the server has not confirmed, so that
 * an edit made on a train survives the tunnel and the reload after it.
 *
 * Nothing here knows about the network. The sync socket and the GraphQL client feed
 * `applyChanges` and `Outbox` from outside; keeping it that way is what makes the store
 * testable without a server and what keeps a network stall off the render path.
 */

export { CLIENT_SCHEMA, databaseName, dropDatabase, dropStaleDatabases, PolarisDB } from './db';
export type { EntityRef, EntityRow, Meta, Snapshot, WriteBatch } from './db';

export {
  fold,
  IssueIndex,
  LabelIndex,
  NotificationIndex,
  ProjectLabelIndex,
  RelationIndex,
  SetIndex,
} from './indexes';

export { Outbox, uuidv7 } from './outbox';
export type { EntityPatch, OptimisticPatch, OutboxAppend, OutboxRecord } from './outbox';

export { queryIssues, subIssueProgress } from './query';
export type {
  GroupBy,
  IssueFilter,
  IssueGroup,
  IssueQuery,
  IssueQueryResult,
  IssueSource,
  SortBy,
  SortDirection,
  SubIssueProgress,
} from './query';

export { sameResult, Store } from './store';
export type { StoreOptions, Subscription } from './store';

export {
  CATEGORY_ORDER,
  ENTITY_TYPES,
  isEntityType,
  issueIdentifier,
  PRIORITY_RANK,
  priorityRank,
} from './types';
export type {
  Actor,
  ActorType,
  Change,
  Comment,
  Attachment,
  Document,
  Cycle,
  DateOnly,
  DueDateSource,
  Entity,
  EntityByType,
  EntityOf,
  EntityType,
  EstimateScale,
  Favorite,
  FavoriteKind,
  FormTemplate,
  FormTemplateField,
  FormTemplateFieldType,
  AskForm,
  GitHubConnection,
  GitHubUserLink,
  GitLabConnection,
  GitLabUserLink,
  SentryConnection,
  CycleCalendarFeed,
  ProjectTemplate,
  ProjectTemplateMilestone,
  ProjectTemplateIssue,
  ProjectTemplateProperties,
  Issue,
  IssueLabel,
  IssueRelation,
  IssueSubscription,
  IssueTemplate,
  Label,
  Notification,
  NotificationPrefs,
  NotificationType,
  Op,
  Project,
  ProjectMember,
  ProjectMilestone,
  Initiative,
  InitiativeProject,
  Customer,
  CustomerRequest,
  SlaAction,
  SlaRule,
  Dashboard,
  DashboardMeasure,
  DashboardSlice,
  DashboardTile,
  DashboardTileDisplay,
  RecurringCadence,
  RecurringIssue,
  InitiativeStatus,
  CustomerStatus,
  ProjectUpdate,
  ProjectUpdateHealth,
  ProjectUpdateSchedule,
  ProjectDependency,
  ProjectLabel,
  ProjectLabelLink,
  ProjectStatus,
  ProjectStatusCategory,
  ProjectTeam,
  TimeframeGranularity,
  RelationType,
  StateCategory,
  SubscriptionReason,
  Team,
  TeamMembership,
  TeamRole,
  TemplateProperties,
  Timestamp,
  User,
  UserKind,
  UserRole,
  UserStatus,
  UUID,
  View,
  ViewPreference,
  ViewSubscription,
  Workspace,
  WorkflowState,
} from './types';
