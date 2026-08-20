/**
 * The wire shape, mirrored.
 *
 * Every interface here is the TypeScript reading of a struct in the server's
 * `internal/domain/model` package. That package is deliberately THE serialisation: the
 * same value is written into `change_log.payload`, streamed by the bootstrap endpoint,
 * stored in IndexedDB and mapped onto the GraphQL types. So these are not "the client's
 * types" — they are the server's types, restated.
 *
 * The consequence of that, and the reason this file is worth reading before editing: a
 * field that drifts from `model.go` does not fail to compile. It produces a client that
 * renders `undefined` for something the API is sending, or writes a field the API never
 * reads, and the bug surfaces three layers away from its cause. When `model.go` changes,
 * this file changes in the same commit.
 */

// The filter AST and the display options are the filter module's to define, because the
// compiler that consumes them lives there and a second definition beside it is how a
// saved view comes to mean something different from the search box.
import type { DisplayOptions, FilterNode } from '~/filter';

/**
 * A UUID in canonical hyphenated form.
 *
 * Ids stay strings from the socket to the IndexedDB key to the React `key` prop. Every
 * alternative — branded types, a wrapper class, parsed 128-bit pairs — buys type safety
 * at the cost of a conversion on the hottest path in the product, where a filtered list
 * touches five thousand of them per frame.
 */
export type UUID = string;

/**
 * An RFC 3339 timestamp, kept exactly as the server sent it.
 *
 * Deliberately not a `Date`. Parsing every timestamp at ingest costs an allocation per
 * field per row, which on a 10,000-issue bootstrap is a hundred thousand short-lived
 * objects and a visible pause. Views format on demand; the one place that needs to
 * *order* by time keeps a parsed epoch key in the index instead (see `indexes.ts`), and
 * for a good reason: RFC 3339 strings do not compare correctly as strings, because Go
 * trims trailing zeros from the fraction and `.5` therefore sorts after `.55`.
 */
export type Timestamp = string;

/**
 * Who caused a change. All four kinds exist from the first release because the activity
 * feed, webhooks, the audit log and filters all expose them, and retrofitting a fifth
 * column onto a shipped audit trail is not a migration anybody enjoys.
 */
export type ActorType = 'user' | 'app_user' | 'integration' | 'system';

export interface Actor {
  readonly type: ActorType;
  /** The user id for `user` and `app_user`, the integration id for `integration`, absent for `system`. */
  readonly id?: UUID;
}

/**
 * A calendar day, `2006-01-02`.
 *
 * Deliberately not a `Timestamp`. A due date is a day in the team's timezone, not an
 * instant: as a timestamp it renders as the previous day for everybody west of whoever
 * set it, and nobody notices until somebody misses a deadline by a few hours.
 */
export type DateOnly = string;

export interface Workspace {
  readonly id: UUID;
  readonly name: string;
  readonly urlKey: string;
  readonly logoUrl?: string;
  readonly plan: string;
  readonly planExpiresAt?: Timestamp;
  /** Set when a paid plan has lapsed: reads keep working, gated writes do not. */
  readonly planLapsedAt?: Timestamp;
  /** Overrides the plan's default seat count. Absent means whatever the plan says. */
  readonly seatLimit?: number;
  /** Default cadence for project update reminders (staleness; delivery is later). */
  readonly projectUpdateReminderIntervalDays: number;
  /** 0 = Sunday through 6 = Saturday. */
  readonly projectUpdateReminderWeekday: number;
  /** Hour of day (0–23) when reminders would send in the lead's timezone. */
  readonly projectUpdateReminderHour: number;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly archivedAt?: Timestamp;
}

/** Workspace-scoped profile. The auth identity behind it is an `account`, which the client never sees. */
export interface User {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly name: string;
  readonly displayName: string;
  readonly avatarUrl?: string;
  readonly timezone: string;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly kind: UserKind;
  /**
   * Only populated for the viewer themselves and for admins. A member listing the
   * workspace does not receive everyone's address, so a view that shows an email must
   * cope with its absence rather than assume the field is always there.
   */
  readonly email?: string;
  readonly lastSeenAt?: Timestamp;
  /**
   * Per-channel, per-type delivery toggles. Opaque here on purpose: read whole at
   * delivery time and never filtered on, so a field per toggle would be a schema change
   * every time a notification type is added.
   */
  readonly notificationPrefs?: NotificationPrefs;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly archivedAt?: Timestamp;
}

/**
 * Workspace GitHub install, minus credentials. On the replica so Copy git branch
 * name works offline and the settings screen can render without a round trip.
 */
export interface GitHubConnection {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly creatorId: UUID;
  readonly enabled: boolean;
  readonly orgLogin?: string;
  readonly branchNameFormat: string;
  readonly linkCommits: boolean;
  readonly linkbacks: boolean;
  readonly connectedAt?: Timestamp;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

/**
 * The caller's linked GitHub login. Tokens are absent for the same reason API keys
 * never replicate theirs.
 */
export interface GitHubUserLink {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly userId: UUID;
  readonly githubLogin: string;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

/**
 * Delivery preferences. Every key is optional and absence means the default, so a client
 * built before a notification type existed does not have to know about it.
 */
export interface NotificationPrefs {
  /** Per-notification email rather than the digest. A preference, never a default. */
  readonly emailPerNotification?: boolean;
  /**
   * How often the digest goes out. Absent means daily — the default M1 asks for: digest
   * first, and quiet enough that nobody's first act is to turn it off.
   *
   * The four values are `domain.cadence*` in services/internal/domain/notification_prefs.go,
   * which is the code that reads them. `hourly` was missing here while the server accepted
   * it, which is a value the preferences screen could never offer.
   */
  readonly emailDigest?: 'off' | 'hourly' | 'daily' | 'weekly';
  /**
   * Types the user has switched off entirely, in either channel.
   *
   * An array, and the server decodes an array. It decoded an object for a while and the two
   * never met: unmarshalling `["comment"]` into a map fails, both decoders are lenient by
   * design, and so muting a type silently did nothing. `TestNotificationPrefsMatchTheClient`
   * reads this interface and fails when the two shapes part company again.
   */
  readonly muted?: readonly NotificationType[];
}

export type UserRole = 'owner' | 'admin' | 'member' | 'guest';
export type UserStatus = 'active' | 'suspended';
/** Humans sign in; agents are installed. Both are users so assignee, mention and actor keep one foreign key target. */
export type UserKind = 'human' | 'app';

export interface Team {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly icon?: string;
  readonly color?: string;
  readonly timezone: string;
  readonly parentTeamId?: UUID;
  readonly private: boolean;
  /**
   * Estimates are a per-team decision, and only the scale lives here — the issue stores
   * the number. A team on t-shirt sizes and a team on Fibonacci both store 3, so changing
   * a team's scale does not rewrite a single issue.
   */
  readonly estimateScale: EstimateScale;
  readonly estimateAllowZero: boolean;
  readonly estimateExtended: boolean;
  readonly cyclesEnabled: boolean;
  readonly cycleDurationWeeks: number;
  readonly cycleCooldownWeeks: number;
  readonly cycleStartDay: string;
  readonly cycleUpcomingCount: number;
  readonly cycleAutoAddStarted: boolean;
  readonly cycleAutoAddCompleted: boolean;
  readonly triageEnabled: boolean;
  readonly triageRequirePriority: boolean;
  readonly autoCloseDays: number;
  readonly autoArchiveDays: number;
  readonly autoCloseParent: boolean;
  readonly autoCloseChildren: boolean;
  readonly defaultTemplateForMembersId?: UUID;
  readonly defaultTemplateForNonMembersId?: UUID;
  readonly emailIntakeEnabled?: boolean;
  readonly emailIntakeAddress?: string;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly retiredAt?: Timestamp;
  readonly archivedAt?: Timestamp;
}

/** `none` hides the estimate control rather than leaving it empty. */
export type EstimateScale = 'none' | 'exponential' | 'fibonacci' | 'linear' | 'tshirt';

export interface TeamMembership {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly teamId: UUID;
  readonly userId: UUID;
  readonly role: TeamRole;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export type TeamRole = 'owner' | 'member';

/**
 * The seven status categories are fixed by the product. Teams create, rename and reorder
 * statuses *within* a category; they cannot invent categories, because cycle completion,
 * project progress, insights, triage semantics and the git integrations all branch on
 * them. `duplicate` is system-managed and never assigned directly.
 */
export type StateCategory =
  'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled' | 'duplicate';

/**
 * The order the product displays categories in, mirroring `domain.categoryOrder`.
 *
 * Grouping an issue list by status orders the groups by this and then by each status's
 * fractional `position` — never by position alone, because positions are only comparable
 * within a category.
 */
export const CATEGORY_ORDER: Readonly<Record<StateCategory, number>> = {
  triage: 0,
  backlog: 1,
  unstarted: 2,
  started: 3,
  completed: 4,
  canceled: 5,
  duplicate: 6,
};

export interface WorkflowState {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly teamId: UUID;
  readonly name: string;
  readonly description?: string;
  readonly color: string;
  readonly category: StateCategory;
  /** Fractional index. Ordering within a category; never compared across categories. */
  readonly position: string;
  readonly isDefault: boolean;
  readonly isSystem: boolean;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly archivedAt?: Timestamp;
}

export interface Issue {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly teamId: UUID;
  readonly number: number;
  /**
   * Derived from the team key and number, never stored server-side. It arrives on the
   * wire because the API must return it, and the client recomputes it with
   * `issueIdentifier` whenever a team key changes — see that function for why nothing
   * here may treat this field as authoritative.
   */
  readonly identifier: string;
  readonly title: string;
  readonly description: string;
  readonly stateId: UUID;
  readonly assigneeId?: UUID;
  readonly creatorId?: UUID;
  /** 0 none, 1 urgent, 2 high, 3 medium, 4 low. A fixed scale; see `PRIORITY_RANK`. */
  readonly priority: number;
  /** Fractional index. Manual order is workspace-global, not per-user and not per-view. */
  readonly sortOrder: string;
  /** The raw point value. Absent is unestimated, which is not zero. */
  readonly estimate?: number;
  readonly dueDate?: DateOnly;
  /** Which subsystem owns the date, and therefore whether a human may edit it. */
  readonly dueDateSource: DueDateSource;
  /** Makes this a sub-issue. Cross-team is allowed: platform work blocking a feature is normal. */
  readonly parentId?: UUID;
  /** Order among siblings. A checklist's order has nothing to do with the backlog's. */
  readonly subIssueSortOrder?: string;
  readonly templateId?: UUID;
  readonly formTemplateId?: UUID;
  readonly recurringIssueId?: UUID;
  readonly projectId?: UUID;
  readonly projectMilestoneId?: UUID;
  readonly cycleId?: UUID;
  /**
   * Hidden from the triage inbox until this instant, or until the next edit or comment.
   * Absent means the issue is not snoozed.
   */
  readonly snoozedUntil?: Timestamp;
  /**
   * Set when the auto-close engine moved this issue to a closed status. Absent otherwise;
   * cleared if the issue is reopened.
   */
  readonly autoClosedAt?: Timestamp;
  readonly startedAt?: Timestamp;
  readonly completedAt?: Timestamp;
  readonly canceledAt?: Timestamp;
  readonly archivedAt?: Timestamp;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export type DueDateSource = 'manual' | 'sla';

/**
 * Display order for the priority scale, which is not its numeric order.
 *
 * The server stores 0 for "no priority", so sorting on the raw number puts unprioritised
 * work above everything urgent — the exact opposite of what a triage list is for. Every
 * sort and every group heading goes through this table instead.
 */
export const PRIORITY_RANK: readonly number[] = [
  5, // 0 none — last
  0, // 1 urgent
  1, // 2 high
  2, // 3 medium
  3, // 4 low
];

/** The rank of a priority, tolerating values outside the scale by sorting them last. */
export function priorityRank(priority: number): number {
  return PRIORITY_RANK[priority] ?? PRIORITY_RANK.length;
}

export interface Comment {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly issueId: UUID;
  readonly parentId?: UUID;
  readonly body: string;
  readonly actor: Actor;
  readonly editedAt?: Timestamp;
  readonly resolvedAt?: Timestamp;
  readonly resolvedBy?: UUID;
  /** Start of the highlighted span in the issue description (UTF-16 offsets). */
  readonly anchorStart?: number;
  /** Exclusive end of the highlighted span. */
  readonly anchorEnd?: number;
  /** The selected text when the comment was left, used to re-find the span after edits. */
  readonly quote?: string;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

/**
 * A link card on an issue. The URL is unique per issue: posting the same URL again
 * updates this row rather than minting a second card.
 */
export interface Attachment {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly issueId: UUID;
  readonly teamId: UUID;
  readonly url: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly iconUrl?: string;
  readonly metadata?: unknown;
  readonly creatorId?: UUID;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

/** Long-form markdown attached to a team or a project. */
export interface Document {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly teamId: UUID;
  readonly projectId?: UUID;
  readonly title: string;
  readonly body: string;
  readonly sortOrder: string;
  readonly creatorId?: UUID;
  readonly updatedBy?: UUID;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly archivedAt?: Timestamp;
  readonly deletedAt?: Timestamp;
}

/**
 * Both a label and a group of labels: a group is a label with `isGroup` set.
 *
 * One entity rather than two means one picker, one permission rule and one place where
 * scoping is decided — a group has exactly the fields a label has.
 */
export interface Label {
  readonly id: UUID;
  readonly workspaceId: UUID;
  /** Absent means the label belongs to the whole workspace. */
  readonly teamId?: UUID;
  /** The group this label sits in. Nesting is one level. */
  readonly parentId?: UUID;
  /**
   * Declared rather than derived from "has children" — a group you have just created has
   * no children yet, and under that definition would stay applicable until it did.
   */
  readonly isGroup: boolean;
  readonly name: string;
  readonly description?: string;
  readonly color: string;
  readonly position: string;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly archivedAt?: Timestamp;
}

/**
 * One label applied to one issue, as an entity in its own right.
 *
 * That is the point, not an implementation detail. Labels are the first *set* the sync
 * engine carries, and a set written as a whole loses writes: two people adding different
 * labels a second apart both send the full new set and the second overwrites the first.
 * As individual rows an add is an upsert of one row and a remove is a delete of one, so
 * both survive with no merge logic anywhere.
 */
export interface IssueLabel {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly issueId: UUID;
  readonly labelId: UUID;
  readonly teamId: UUID;
  /** Denormalised from the label, so "at most one per group" is a database rule. */
  readonly groupId?: UUID;
  readonly createdBy?: UUID;
  readonly createdAt: Timestamp;
}

/**
 * A link between two issues.
 *
 * Only `blocks` is stored; "blocked by" is the same row read from the other end. Two rows
 * could disagree, and an issue that blocks another without the other being blocked by it
 * is a state no user can explain or repair.
 */
export interface IssueRelation {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly issueId: UUID;
  readonly relatedIssueId: UUID;
  readonly type: RelationType;
  readonly teamId: UUID;
  readonly relatedTeamId: UUID;
  readonly createdBy?: UUID;
  readonly createdAt: Timestamp;
}

/** `related` is symmetric and stored with the smaller id first, so one index prevents duplicates. */
export type RelationType = 'blocks' | 'related' | 'duplicate';

export interface IssueSubscription {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly issueId: UUID;
  readonly userId: UUID;
  readonly reason: SubscriptionReason;
  /**
   * An explicit unsubscribe is a flag, not a missing row. Deleting the row would let the
   * next comment re-subscribe you, so unsubscribe would work for about four minutes.
   */
  readonly unsubscribed: boolean;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export type SubscriptionReason =
  'created' | 'assigned' | 'mentioned' | 'commented' | 'subscribed' | 'manual';

export type NotificationType =
  | 'issue_assigned'
  | 'issue_status_changed'
  | 'issue_priority_raised'
  | 'issue_due'
  | 'issue_blocked'
  | 'comment'
  | 'mention'
  | 'sub_issue_completed';

/**
 * One inbox row, derived from a change-log row rather than re-derived from entities.
 *
 * That derivation is the commitment: "what happened" already has a definition, and a
 * second one disagrees with the first within a month.
 */
export interface Notification {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly userId: UUID;
  readonly type: NotificationType;
  readonly issueId?: UUID;
  readonly commentId?: UUID;
  readonly actor: Actor;
  /** Traces this row back to the exact mutation that produced it. */
  readonly changeVersion: number;
  /**
   * The coalescing key, and the reason a bulk update of two hundred issues produces one
   * inbox row per person rather than two hundred.
   */
  readonly groupKey: string;
  readonly count: number;
  readonly payload?: unknown;
  readonly readAt?: Timestamp;
  readonly snoozedUntil?: Timestamp;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

/**
 * A saved filter plus how to display it.
 *
 * `filter` is the AST the one compiler consumes — the same bytes the server compiles to
 * SQL for search. There is no second definition of the grammar, deliberately: that is
 * where a filter meaning one thing in a view and another in search comes from.
 */
export interface View {
  readonly id: UUID;
  readonly workspaceId: UUID;
  /** Absent means the view spans the workspace. */
  readonly teamId?: UUID;
  /** Absent means shared. Set means it is that person's private view. */
  readonly ownerId?: UUID;
  /** Set means the view is attached as a tab on this project. */
  readonly projectId?: UUID;
  readonly name: string;
  readonly description?: string;
  readonly icon?: string;
  readonly color?: string;
  readonly filter: FilterNode;
  readonly display: DisplayOptions;
  readonly position: string;
  readonly createdBy?: UUID;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly archivedAt?: Timestamp;
}

/**
 * Display options for the views that have no row of their own — Team issues, My issues
 * and the rest. On the server rather than in localStorage, because the grouping you chose
 * has to follow you to your other machine.
 */
export interface ViewPreference {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly userId: UUID;
  readonly viewKey: string;
  readonly display: DisplayOptions;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export interface Favorite {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly userId: UUID;
  readonly kind: FavoriteKind;
  readonly targetId: UUID;
  readonly position: string;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export type FavoriteKind = 'view' | 'team' | 'issue' | 'label';

export interface IssueTemplate {
  readonly id: UUID;
  readonly workspaceId: UUID;
  /** Absent means the template is offered in every team. */
  readonly teamId?: UUID;
  readonly name: string;
  readonly description?: string;
  readonly title: string;
  readonly body: string;
  /** Keys are the same names the create mutation takes. */
  readonly properties: TemplateProperties;
  readonly position: string;
  readonly createdBy?: UUID;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly archivedAt?: Timestamp;
  readonly emailIntakeEnabled?: boolean;
  readonly emailIntakeAddress?: string;
}

export type RecurringCadence = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

/**
 * A schedule that mints issues on a cadence.
 *
 * title, body and properties are a snapshot taken when the schedule was created. Editing
 * a source template afterwards does not change them. nextDueDate is the due date of the
 * current occurrence.
 */
export interface RecurringIssue {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly teamId: UUID;
  readonly title: string;
  readonly body: string;
  readonly properties: TemplateProperties;
  readonly templateId?: UUID;
  readonly cadence: RecurringCadence;
  readonly nextDueDate: DateOnly;
  readonly lastCreatedAt?: Timestamp;
  readonly createdBy?: UUID;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly archivedAt?: Timestamp;
}

export interface TemplateProperties {
  readonly stateId?: UUID;
  readonly assigneeId?: UUID;
  readonly priority?: number;
  readonly estimate?: number;
  readonly labelIds?: readonly UUID[];
}

export type FormTemplateFieldType =
  | 'text'
  | 'long_text'
  | 'dropdown'
  | 'checkboxes'
  | 'date'
  | 'file_upload'
  | 'instructions'
  | 'label_group'
  | 'priority'
  | 'title'
  | 'due_date';

export interface FormTemplate {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly teamId?: UUID;
  readonly name: string;
  readonly description?: string;
  readonly properties: TemplateProperties;
  readonly position: string;
  readonly createdBy?: UUID;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly archivedAt?: Timestamp;
}

export interface FormTemplateField {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly formTemplateId: UUID;
  readonly fieldType: FormTemplateFieldType;
  readonly label: string;
  readonly description?: string;
  readonly required: boolean;
  readonly sortOrder: string;
  readonly config: Record<string, unknown>;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

/** Keys match `createProject`: status, priority, lead, colour, dates, teams, members, initiatives. */
export interface ProjectTemplateProperties {
  readonly statusId?: UUID;
  readonly priority?: number;
  readonly leadId?: UUID;
  readonly color?: string;
  readonly icon?: string;
  readonly teamIds?: readonly UUID[];
  readonly memberIds?: readonly UUID[];
  readonly startDate?: DateOnly;
  readonly targetDate?: DateOnly;
  readonly initiativeIds?: readonly UUID[];
}

export interface ProjectTemplate {
  readonly id: UUID;
  readonly workspaceId: UUID;
  /** Absent means the template is offered in every team. */
  readonly teamId?: UUID;
  readonly name: string;
  readonly description?: string;
  readonly summary: string;
  readonly body: string;
  readonly properties: ProjectTemplateProperties;
  readonly position: string;
  readonly createdBy?: UUID;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly archivedAt?: Timestamp;
}

export interface ProjectTemplateMilestone {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly projectTemplateId: UUID;
  readonly name: string;
  readonly description?: string;
  readonly targetDate?: DateOnly;
  readonly sortOrder: string;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export interface ProjectTemplateIssue {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly projectTemplateId: UUID;
  readonly parentId?: UUID;
  readonly title: string;
  readonly description: string;
  readonly properties: TemplateProperties;
  readonly sortOrder: string;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export type ProjectStatusCategory = 'backlog' | 'planned' | 'started' | 'completed' | 'canceled';

export type TimeframeGranularity = 'day' | 'month' | 'quarter' | 'half' | 'year';

export interface ProjectStatus {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly name: string;
  readonly description?: string;
  readonly color: string;
  readonly category: ProjectStatusCategory;
  readonly position: string;
  readonly isDefault: boolean;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly archivedAt?: Timestamp;
}

export interface Project {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly name: string;
  readonly summary?: string;
  readonly description: string;
  readonly icon?: string;
  readonly color: string;
  readonly statusId: UUID;
  readonly priority: number;
  readonly leadId?: UUID;
  readonly creatorId?: UUID;
  readonly sortOrder: string;
  readonly startDate?: DateOnly;
  readonly startDateGranularity?: TimeframeGranularity;
  readonly targetDate?: DateOnly;
  readonly targetDateGranularity?: TimeframeGranularity;
  /** Workspace default, custom cadence, or never expect updates. */
  readonly updateSchedule: ProjectUpdateSchedule;
  readonly updateReminderIntervalDays?: number;
  readonly updateReminderWeekday?: number;
  readonly updateReminderHour?: number;
  readonly archivedAt?: Timestamp;
  readonly deletedAt?: Timestamp;
  readonly deletedBy?: UUID;
  readonly projectTemplateId?: UUID;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export interface ProjectTeam {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly projectId: UUID;
  readonly teamId: UUID;
  readonly createdAt: Timestamp;
}

export interface ProjectMember {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly projectId: UUID;
  readonly userId: UUID;
  readonly createdAt: Timestamp;
}

export interface ProjectMilestone {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly projectId: UUID;
  readonly name: string;
  readonly description?: string;
  readonly targetDate?: DateOnly;
  readonly sortOrder: string;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly archivedAt?: Timestamp;
}

export type InitiativeStatus = 'proposed' | 'planned' | 'active' | 'completed' | 'canceled';

/** A workspace objective grouping a manually curated set of projects. */
export interface Initiative {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly name: string;
  readonly description: string;
  readonly status: InitiativeStatus;
  readonly priority: number;
  readonly ownerId?: UUID;
  readonly leadTeamId?: UUID;
  readonly creatorId?: UUID;
  readonly sortOrder: string;
  readonly targetDate?: DateOnly;
  readonly targetDateGranularity?: TimeframeGranularity;
  readonly archivedAt?: Timestamp;
  readonly deletedAt?: Timestamp;
  readonly deletedBy?: UUID;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export interface InitiativeProject {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly initiativeId: UUID;
  readonly projectId: UUID;
  readonly createdAt: Timestamp;
}

export type CustomerStatus = 'active' | 'prospect' | 'churned';

/** An external organisation whose feedback is attributed onto issues and projects. */
export interface Customer {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly name: string;
  readonly domains: readonly string[];
  readonly revenue?: number;
  readonly size?: number;
  readonly tier?: string;
  readonly status: CustomerStatus;
  readonly ownerId?: UUID;
  readonly logoUrl: string;
  readonly creatorId?: UUID;
  readonly sortOrder: string;
  readonly archivedAt?: Timestamp;
  readonly deletedAt?: Timestamp;
  readonly deletedBy?: UUID;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

/** Feedback attached to an issue and/or a project, optionally a customer. */
export interface CustomerRequest {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly customerId?: UUID;
  readonly issueId?: UUID;
  readonly projectId?: UUID;
  readonly body: string;
  readonly important: boolean;
  readonly creatorId?: UUID;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export type SlaAction = 'apply' | 'remove';

/** A workspace policy: first match wins. Applying one owns the issue's due date. */
export interface SlaRule {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly position: string;
  readonly filter: FilterNode;
  readonly action: SlaAction;
  readonly durationMinutes?: number;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export type DashboardMeasure =
  | 'count'
  | 'effort'
  | 'cycle_time'
  | 'lead_time'
  | 'issue_age'
  | 'burn_up';

export type DashboardSlice =
  | 'assignee'
  | 'priority'
  | 'state_category'
  | 'team'
  | 'project'
  | 'label';

export type DashboardTileDisplay = 'chart' | 'table' | 'metric';

/** A page of Insights tiles. Personal when ownerId is set, team-scoped when teamId is. */
export interface Dashboard {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly teamId?: UUID;
  readonly ownerId?: UUID;
  readonly name: string;
  readonly description: string;
  readonly filter: FilterNode;
  readonly creatorId?: UUID;
  readonly sortOrder: string;
  readonly archivedAt?: Timestamp;
  readonly deletedAt?: Timestamp;
  readonly deletedBy?: UUID;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

/** One Insights chart, table, or metric on a dashboard. */
export interface DashboardTile {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly dashboardId: UUID;
  readonly title: string;
  readonly measure: DashboardMeasure;
  readonly slice: DashboardSlice;
  readonly display: DashboardTileDisplay;
  readonly filter: FilterNode;
  readonly sortOrder: string;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export type ProjectUpdateHealth = 'on_track' | 'at_risk' | 'off_track';

export type ProjectUpdateSchedule = 'default' | 'never' | 'custom';

/** A status post on a project — health plus narrative markdown. */
export interface ProjectUpdate {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly projectId: UUID;
  readonly health: ProjectUpdateHealth;
  readonly body: string;
  readonly authorId: UUID;
  readonly editedAt?: Timestamp;
  readonly deletedAt?: Timestamp;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

/** An end→start link: the blocking project must finish before the blocked may start. */
export interface ProjectDependency {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly blockingProjectId: UUID;
  readonly blockedProjectId: UUID;
  readonly createdAt: Timestamp;
}

/**
 * Workspace taxonomy for labelling projects — separate from issue labels.
 *
 * Both a label and a group of labels: a group is a label with `isGroup` set. Nesting is
 * one level deep, matching issue labels.
 */
export interface ProjectLabel {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly parentId?: UUID;
  readonly isGroup: boolean;
  readonly name: string;
  readonly description?: string;
  readonly color: string;
  readonly position: string;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly archivedAt?: Timestamp;
}

/** One project label applied to one project, as its own replicated row. */
export interface ProjectLabelLink {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly projectId: UUID;
  readonly labelId: UUID;
  readonly groupId?: UUID;
  readonly createdBy?: UUID;
  readonly createdAt: Timestamp;
}

export interface Cycle {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly teamId: UUID;
  readonly number: number;
  readonly name: string;
  readonly description?: string;
  readonly startsAt: Timestamp;
  readonly endsAt: Timestamp;
  readonly completedAt?: Timestamp;
  readonly archivedAt?: Timestamp;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

/**
 * The entity types the client replicates, keyed by the exact string the server puts in
 * `change_log.entity_type` and in each bootstrap line. These strings are the protocol —
 * they are not a local naming choice, and renaming one silently drops a stream.
 *
 * `apiKey` is deliberately absent. Everything here is replicated because it is rendered
 * in a hot path; keys are listed on one settings screen, rarely, and replicating them
 * would put a credential's metadata in every device's IndexedDB for no gain.
 */
export interface EntityByType {
  workspace: Workspace;
  user: User;
  githubConnection: GitHubConnection;
  githubUserLink: GitHubUserLink;
  team: Team;
  teamMembership: TeamMembership;
  workflowState: WorkflowState;
  customer: Customer;
  slaRule: SlaRule;
  dashboard: Dashboard;
  dashboardTile: DashboardTile;
  label: Label;
  issueTemplate: IssueTemplate;
  formTemplate: FormTemplate;
  formTemplateField: FormTemplateField;
  projectTemplate: ProjectTemplate;
  projectTemplateMilestone: ProjectTemplateMilestone;
  projectTemplateIssue: ProjectTemplateIssue;
  projectStatus: ProjectStatus;
  project: Project;
  projectTeam: ProjectTeam;
  projectMember: ProjectMember;
  projectMilestone: ProjectMilestone;
  initiative: Initiative;
  initiativeProject: InitiativeProject;
  projectUpdate: ProjectUpdate;
  projectDependency: ProjectDependency;
  projectLabel: ProjectLabel;
  projectLabelLink: ProjectLabelLink;
  cycle: Cycle;
  recurringIssue: RecurringIssue;
  issue: Issue;
  customerRequest: CustomerRequest;
  issueLabel: IssueLabel;
  issueRelation: IssueRelation;
  attachment: Attachment;
  document: Document;
  comment: Comment;
  issueSubscription: IssueSubscription;
  notification: Notification;
  view: View;
  viewPreference: ViewPreference;
  favorite: Favorite;
}

export type EntityType = keyof EntityByType;
export type EntityOf<T extends EntityType> = EntityByType[T];
export type Entity = EntityByType[EntityType];

/**
 * Every entity type, in dependency order — the same order the bootstrap endpoint streams
 * them in, so that anything holding a foreign key arrives after its target. Iterating
 * this rather than `Object.keys` keeps that order a stated fact instead of an accident
 * of declaration.
 */
export const ENTITY_TYPES: readonly EntityType[] = [
  'workspace',
  'user',
  'githubConnection',
  'githubUserLink',
  'team',
  'teamMembership',
  'workflowState',
  'customer',
  'slaRule',
  'dashboard',
  'dashboardTile',
  // Before issues: an issue may carry a labelId or a templateId.
  'label',
  'issueTemplate',
  'formTemplate',
  'formTemplateField',
  'projectTemplate',
  'projectTemplateMilestone',
  'projectTemplateIssue',
  // Before issues: an issue may name a project and a milestone.
  'projectStatus',
  'project',
  'projectTeam',
  'projectMember',
  'projectMilestone',
  'initiative',
  'initiativeProject',
  'projectUpdate',
  'projectDependency',
  'projectLabel',
  'projectLabelLink',
  // Before issues: an issue may name a cycle or a recurring schedule.
  'cycle',
  'recurringIssue',
  'issue',
  'customerRequest',
  // After issues, because each names one.
  'issueLabel',
  'issueRelation',
  'attachment',
  'document',
  'comment',
  'issueSubscription',
  // After comments, because a notification may name one.
  'notification',
  'view',
  'viewPreference',
  // Last: a favourite may point at any of the above.
  'favorite',
];

const ENTITY_TYPE_SET: ReadonlySet<string> = new Set<string>(ENTITY_TYPES);

/**
 * Whether a string names an entity type this client knows.
 *
 * The socket is a trust boundary in the version sense: a newer server may stream a type
 * this build has never heard of. Recognising that and skipping it is the difference
 * between an unknown entity being ignored and an unknown entity throwing on the sync
 * path, which would stall the whole delta stream behind it.
 */
export function isEntityType(value: string): value is EntityType {
  return ENTITY_TYPE_SET.has(value);
}

/**
 * What happened to an entity, from the client's point of view.
 *
 * `revoke` is the one worth understanding: the entity still exists, but this recipient
 * may no longer see it. It carries no payload and the client deletes its local copy.
 * Without it, somebody removed from a team keeps a perfectly readable replica of its
 * issues forever — the failure mode is not data loss, it is a silent permanent read of
 * data you were just cut off from.
 */
export type Op = 'upsert' | 'delete' | 'revoke';

/**
 * One entity mutation as it arrives on the socket, inside a `delta` frame.
 *
 * `v` is the workspace-scoped version: gapless and totally ordered, which is what lets a
 * client say "I am at V, send me the rest" and trust the answer. Applying changes in `v`
 * order is therefore not an optimisation, it is the ordering guarantee.
 */
export interface Change<T extends EntityType = EntityType> {
  readonly v: number;
  readonly type: T;
  readonly id: UUID;
  readonly op: Op;
  readonly actor: Actor;
  /** Present on `upsert` and absent otherwise — a revoke that carried data would defeat itself. */
  readonly payload?: EntityOf<T>;
}

/**
 * Builds the human-readable issue id from a team key and issue number.
 *
 * The identifier is derived rather than stored because the team key is mutable: storing
 * it would mean rewriting every issue in a team to fix a typo in `ENG`. The client holds
 * the team already, so recomputing costs a concatenation and removes a whole class of
 * "the list says ENG-4 and the detail page says ENGG-4" bug.
 */
export function issueIdentifier(teamKey: string, number: number): string {
  return `${teamKey}-${number}`;
}
