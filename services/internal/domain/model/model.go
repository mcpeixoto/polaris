// Package model holds the client-facing shape of every entity.
//
// These structs are THE serialisation. The same value is:
//
//   - written into change_log.payload for the sync stream,
//   - streamed by the bootstrap endpoint,
//   - stored by the client in IndexedDB,
//   - and mapped one-to-one onto the GraphQL transport types by internal/graph/convert.go.
//
// One shape, one place. The alternative — a separate sync payload — drifts within weeks,
// and the symptom is that the client renders one thing and the API returns another for
// the same field.
//
// GraphQL keeps its own generated types because enums are uppercase on the wire and
// lowercase in the database, and schema nullability does not always match a Go pointer.
// internal/graph/schema_drift_test.go asserts the two field sets stay identical, so
// adding a field to one and forgetting the other fails CI instead of reaching a user.
package model

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// Date is a calendar day in "2006-01-02" form.
//
// Deliberately not a time.Time. A due date is a day in the team's timezone, not an
// instant: stored and transported as a timestamp it silently becomes due on the previous
// day for everybody west of the person who set it, and that bug is invisible until
// somebody in another country misses a deadline by a few hours.
type Date string

// Actor is who caused a change. Mirrors authz.Actor but lives here because it is part of
// the wire shape, not part of the authorisation logic.
type Actor struct {
	Type string     `json:"type"`
	ID   *uuid.UUID `json:"id,omitempty"`
}

type Workspace struct {
	ID      uuid.UUID `json:"id"`
	Name    string    `json:"name"`
	URLKey  string    `json:"urlKey"`
	LogoURL *string   `json:"logoUrl,omitempty"`
	Plan    string    `json:"plan"`

	// PlanExpiresAt is when the current plan lapses; nil means it does not.
	PlanExpiresAt *time.Time `json:"planExpiresAt,omitempty"`
	// PlanLapsedAt is set when a paid plan has actually lapsed. Reads keep working and
	// writes that need a paid feature do not — locking people out of their own data over
	// a failed card is not a business model.
	PlanLapsedAt *time.Time `json:"planLapsedAt,omitempty"`
	// SeatLimit overrides the plan's default seat count. nil means "whatever the plan says".
	SeatLimit *int `json:"seatLimit,omitempty"`

	// Default cadence for project update reminders (display + staleness; delivery is later).
	ProjectUpdateReminderIntervalDays int `json:"projectUpdateReminderIntervalDays"`
	ProjectUpdateReminderWeekday      int `json:"projectUpdateReminderWeekday"`
	ProjectUpdateReminderHour         int `json:"projectUpdateReminderHour"`

	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	ArchivedAt *time.Time `json:"archivedAt,omitempty"`
}

type User struct {
	ID          uuid.UUID `json:"id"`
	WorkspaceID uuid.UUID `json:"workspaceId"`
	Name        string    `json:"name"`
	DisplayName string    `json:"displayName"`
	AvatarURL   *string   `json:"avatarUrl,omitempty"`
	Timezone    string    `json:"timezone"`
	Role        string    `json:"role"`
	Status      string    `json:"status"`
	Kind        string    `json:"kind"`
	// Email is only populated for the viewer themselves and for admins. A member
	// listing a workspace's users does not receive everyone's address.
	Email      *string    `json:"email,omitempty"`
	LastSeenAt *time.Time `json:"lastSeenAt,omitempty"`

	// NotificationPrefs is a bag of per-channel, per-type toggles. Opaque here on purpose:
	// it is read whole at delivery time and never filtered on, so a column per toggle
	// would be a migration every time a notification type is added.
	NotificationPrefs json.RawMessage `json:"notificationPrefs,omitempty"`

	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	ArchivedAt *time.Time `json:"archivedAt,omitempty"`
}

type Team struct {
	ID           uuid.UUID  `json:"id"`
	WorkspaceID  uuid.UUID  `json:"workspaceId"`
	Key          string     `json:"key"`
	Name         string     `json:"name"`
	Description  *string    `json:"description,omitempty"`
	Icon         *string    `json:"icon,omitempty"`
	Color        *string    `json:"color,omitempty"`
	Timezone     string     `json:"timezone"`
	ParentTeamID *uuid.UUID `json:"parentTeamId,omitempty"`
	Private      bool       `json:"private"`

	// The estimate scale is a per-team decision, and only the scale lives here: the issue
	// stores the number. A team on t-shirt sizes and a team on Fibonacci both store 3 and
	// render it differently, so changing a team's scale does not rewrite its issues.
	EstimateScale     string `json:"estimateScale"`
	EstimateAllowZero bool   `json:"estimateAllowZero"`
	EstimateExtended  bool   `json:"estimateExtended"`

	// Cadence. Off by default; turning it on creates the current cycle and the
	// configured number of upcoming ones. A cooldown is a gap between cycles, not a
	// cycle, which is why it is a duration here rather than a row.
	CyclesEnabled         bool   `json:"cyclesEnabled"`
	CycleDurationWeeks    int    `json:"cycleDurationWeeks"`
	CycleCooldownWeeks    int    `json:"cycleCooldownWeeks"`
	CycleStartDay         string `json:"cycleStartDay"`
	CycleUpcomingCount    int    `json:"cycleUpcomingCount"`
	CycleAutoAddStarted   bool   `json:"cycleAutoAddStarted"`
	CycleAutoAddCompleted bool   `json:"cycleAutoAddCompleted"`

	// Triage is a status category and a per-team switch. Off, new issues land in the
	// default status; on, outsiders and the inbox itself file into the triage status.
	TriageEnabled         bool `json:"triageEnabled"`
	TriageRequirePriority bool `json:"triageRequirePriority"`

	// Auto-close and auto-archive periods, in days. Zero is off. The parent/child
	// flags close a parent when its last sub-issue is done, and the reverse.
	AutoCloseDays     int  `json:"autoCloseDays"`
	AutoArchiveDays   int  `json:"autoArchiveDays"`
	AutoCloseParent   bool `json:"autoCloseParent"`
	AutoCloseChildren bool `json:"autoCloseChildren"`

	// Default templates applied when an issue is filed without one. Members and
	// non-members are separate because an outsider filing into a triaged team should
	// not silently pick up the team's own bug template, and a member creating from C
	// should not pick up the intake form meant for everyone else.
	DefaultTemplateForMembersID    *uuid.UUID `json:"defaultTemplateForMembersId,omitempty"`
	DefaultTemplateForNonMembersID *uuid.UUID `json:"defaultTemplateForNonMembersId,omitempty"`

	// Email intake. The token that is the local-part of the address is not replicated:
	// the settings screen copies the address, and that is the only thing a client needs.
	EmailIntakeEnabled bool    `json:"emailIntakeEnabled"`
	EmailIntakeAddress *string `json:"emailIntakeAddress,omitempty"`

	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	RetiredAt  *time.Time `json:"retiredAt,omitempty"`
	ArchivedAt *time.Time `json:"archivedAt,omitempty"`
	// DeletedAt is only populated on deletedTeams rows, like Issue.deletedAt on deletedIssues.
	DeletedAt *time.Time `json:"deletedAt,omitempty"`
}

// EstimateScale values. "none" means the team does not estimate, which is not the same as
// every issue being unestimated — it hides the control rather than leaving it empty.
const (
	EstimateScaleNone        = "none"
	EstimateScaleExponential = "exponential"
	EstimateScaleFibonacci   = "fibonacci"
	EstimateScaleLinear      = "linear"
	EstimateScaleTShirt      = "tshirt"
)

type TeamMembership struct {
	ID          uuid.UUID `json:"id"`
	WorkspaceID uuid.UUID `json:"workspaceId"`
	TeamID      uuid.UUID `json:"teamId"`
	UserID      uuid.UUID `json:"userId"`
	Role        string    `json:"role"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// Cycle is a dated window on a team. Cooldown is a gap between cycles, not a row, so
// there is never a cycle whose job is "wait" — issues can only sit in a real window.
type Cycle struct {
	ID          uuid.UUID  `json:"id"`
	WorkspaceID uuid.UUID  `json:"workspaceId"`
	TeamID      uuid.UUID  `json:"teamId"`
	Number      int        `json:"number"`
	Name        string     `json:"name"`
	Description *string    `json:"description,omitempty"`
	StartsAt    time.Time  `json:"startsAt"`
	EndsAt      time.Time  `json:"endsAt"`
	CompletedAt *time.Time `json:"completedAt,omitempty"`
	ArchivedAt  *time.Time `json:"archivedAt,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

type WorkflowState struct {
	ID          uuid.UUID  `json:"id"`
	WorkspaceID uuid.UUID  `json:"workspaceId"`
	TeamID      uuid.UUID  `json:"teamId"`
	Name        string     `json:"name"`
	Description *string    `json:"description,omitempty"`
	Color       string     `json:"color"`
	Category    string     `json:"category"`
	Position    string     `json:"position"`
	IsDefault   bool       `json:"isDefault"`
	IsSystem    bool       `json:"isSystem"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	ArchivedAt  *time.Time `json:"archivedAt,omitempty"`
}

type Issue struct {
	ID          uuid.UUID `json:"id"`
	WorkspaceID uuid.UUID `json:"workspaceId"`
	TeamID      uuid.UUID `json:"teamId"`
	Number      int64     `json:"number"`

	// Identifier is derived, not stored: team key + number. It is computed here so the
	// API returns it, and the client recomputes it locally from the team it already
	// holds. Storing it would mean rewriting every issue in a team when its key changes.
	Identifier string `json:"identifier"`

	Title       string     `json:"title"`
	Description string     `json:"description"`
	StateID     uuid.UUID  `json:"stateId"`
	AssigneeID  *uuid.UUID `json:"assigneeId,omitempty"`
	CreatorID   *uuid.UUID `json:"creatorId,omitempty"`
	Priority    int        `json:"priority"`
	SortOrder   string     `json:"sortOrder"`

	// Estimate is the raw point value. nil means unestimated, which is not zero.
	Estimate *int `json:"estimate,omitempty"`

	DueDate *Date `json:"dueDate,omitempty"`
	// DueDateSource says which subsystem owns the date, and therefore whether a human may
	// edit it. SLAs will also want to set one and the two are mutually exclusive; without
	// this the provenance of every date already stored would have to be guessed.
	DueDateSource string `json:"dueDateSource"`

	// ParentID makes this a sub-issue. Cross-team is allowed on purpose: a platform task
	// blocking a product feature is the normal case.
	ParentID *uuid.UUID `json:"parentId,omitempty"`
	// SubIssueSortOrder is the order among siblings, independent of the workspace-global
	// SortOrder — a parent's checklist has an order unrelated to the team backlog's.
	SubIssueSortOrder *string `json:"subIssueSortOrder,omitempty"`

	// TemplateID records which template made this issue. Not for display: for the
	// question "is this template still worth having", which nothing else can answer.
	TemplateID *uuid.UUID `json:"templateId,omitempty"`
	// FormTemplateID records which form template made this issue — parallel provenance
	// for intake reporting.
	FormTemplateID *uuid.UUID `json:"formTemplateId,omitempty"`

	// RecurringIssueID names the schedule that minted this issue, or that this issue
	// was converted into. Filterable as "recurring". Absent means a one-off.
	RecurringIssueID *uuid.UUID `json:"recurringIssueId,omitempty"`

	// At most one project, as a column rather than a join: two projects on one issue is
	// a state the schema cannot represent. A milestone implies its project.
	ProjectID          *uuid.UUID `json:"projectId,omitempty"`
	ProjectMilestoneID *uuid.UUID `json:"projectMilestoneId,omitempty"`
	CycleID            *uuid.UUID `json:"cycleId,omitempty"`

	// Hidden from the triage inbox until this instant, or until the next edit or comment,
	// whichever comes first. Nil means not snoozed.
	SnoozedUntil *time.Time `json:"snoozedUntil,omitempty"`

	// Set when the auto-close engine moved this issue to a closed status. Cleared on reopen.
	AutoClosedAt *time.Time `json:"autoClosedAt,omitempty"`

	StartedAt   *time.Time `json:"startedAt,omitempty"`
	CompletedAt *time.Time `json:"completedAt,omitempty"`
	CanceledAt  *time.Time `json:"canceledAt,omitempty"`
	ArchivedAt  *time.Time `json:"archivedAt,omitempty"`

	// DeletedAt and DeletedBy are the trash's two facts: when the issue was thrown away and
	// by whom. Both are omitempty and both are nil on every issue a client ever stores,
	// because a deleted issue is never streamed and never bootstrapped — the delete is what
	// reaches the replica. They exist here so the one read that does return deleted rows,
	// ListDeletedIssues, can answer the two questions the trash screen is actually asking;
	// putting them on a second struct would be a second serialisation of an issue.
	//
	// DeletedBy is nil for deletions that predate the column and for the ones the retention
	// sweep performs, where there is no person to name.
	DeletedAt *time.Time `json:"deletedAt,omitempty"`
	DeletedBy *uuid.UUID `json:"deletedBy,omitempty"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// DueDateSource values.
const (
	DueDateManual = "manual"
	DueDateSLA    = "sla"
)

// IssueProgress is a parent issue's sub-issue completion, rolled up.
//
// Direct children only. A recursive rollup demos better and is unaffordable where it is
// actually used: a list view showing a hundred parents would walk the whole sub-tree once
// per visible row, and the depth is bounded only by the fifty levels the parent-cycle
// trigger tolerates. A parent's own children are the thing the user is looking at anyway.
//
// Not stored anywhere. It is derived on read rather than maintained on write because a
// stored counter has to be corrected by every path that can change a child's status —
// including the bulk edit, the restore and the cascade — and the first one that forgets
// leaves a parent stuck at "4 of 5" with nothing on screen to explain it.
type IssueProgress struct {
	Total     int `json:"total"`
	Completed int `json:"completed"`
	Canceled  int `json:"canceled"`

	// Percent is completed over the children that can still be completed, 0–100.
	//
	// Cancelled children leave the denominator. Counted as incomplete they would make 100%
	// unreachable for any parent that ever cancelled a child: the bar sits at 80% forever
	// with no remaining work that could move it, and the only fix a user can find is to
	// delete the cancelled sub-issue, which destroys the record of the decision.
	Percent int `json:"percent"`
}

// Label is both a label and a group of labels. A group is a label with IsGroup set, not a
// separate table: one entity on the change stream, one picker, one permission rule and one
// place where scoping is decided.
type Label struct {
	ID          uuid.UUID `json:"id"`
	WorkspaceID uuid.UUID `json:"workspaceId"`
	// TeamID nil means the label belongs to the whole workspace.
	TeamID *uuid.UUID `json:"teamId,omitempty"`
	// ParentID is the group this label sits in. Nesting is one level.
	ParentID *uuid.UUID `json:"parentId,omitempty"`
	// IsGroup is declared, not derived from "has children" — a group you have just made
	// has no children yet, and under that definition would be applicable until it did.
	IsGroup bool `json:"isGroup"`

	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
	Color       string  `json:"color"`
	Position    string  `json:"position"`

	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	ArchivedAt *time.Time `json:"archivedAt,omitempty"`
}

// IssueLabel is one label applied to one issue.
//
// It is an entity in its own right, with its own id, and that is the whole point. Labels
// are the first *set* the sync engine carries, and a set written as a whole loses writes:
// two people adding different labels a second apart both send the full new set and the
// second overwrites the first. As individual rows an add is an upsert of one row and a
// remove is a delete of one row, so both survive with no merge logic anywhere.
type IssueLabel struct {
	ID          uuid.UUID `json:"id"`
	WorkspaceID uuid.UUID `json:"workspaceId"`
	IssueID     uuid.UUID `json:"issueId"`
	LabelID     uuid.UUID `json:"labelId"`
	TeamID      uuid.UUID `json:"teamId"`
	// GroupID is denormalised from the label, so the one-per-group rule can be a unique
	// index rather than application code an importer bypasses.
	GroupID   *uuid.UUID `json:"groupId,omitempty"`
	CreatedBy *uuid.UUID `json:"createdBy,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
}

// ProjectLabel is both a label and a group of labels for projects. Workspace-scoped only.
type ProjectLabel struct {
	ID          uuid.UUID  `json:"id"`
	WorkspaceID uuid.UUID  `json:"workspaceId"`
	ParentID    *uuid.UUID `json:"parentId,omitempty"`
	IsGroup     bool       `json:"isGroup"`

	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
	Color       string  `json:"color"`
	Position    string  `json:"position"`

	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	ArchivedAt *time.Time `json:"archivedAt,omitempty"`
}

// ProjectLabelLink is one project label applied to one project.
type ProjectLabelLink struct {
	ID          uuid.UUID  `json:"id"`
	WorkspaceID uuid.UUID  `json:"workspaceId"`
	ProjectID   uuid.UUID  `json:"projectId"`
	LabelID     uuid.UUID  `json:"labelId"`
	GroupID     *uuid.UUID `json:"groupId,omitempty"`
	CreatedBy   *uuid.UUID `json:"createdBy,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
}

// IssueRelation links two issues.
//
// Only `blocks` is stored; "blocked by" is the same row read from the other end. Storing
// both would mean two rows that can disagree — an issue that blocks another without the
// other being blocked by it is a state no user can explain or repair.
type IssueRelation struct {
	ID             uuid.UUID `json:"id"`
	WorkspaceID    uuid.UUID `json:"workspaceId"`
	IssueID        uuid.UUID `json:"issueId"`
	RelatedIssueID uuid.UUID `json:"relatedIssueId"`
	Type           string    `json:"type"`
	TeamID         uuid.UUID `json:"teamId"`
	RelatedTeamID  uuid.UUID `json:"relatedTeamId"`

	CreatedBy *uuid.UUID `json:"createdBy,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
}

// IssueRelation types. `related` is symmetric and is stored with the smaller id first, so
// one unique index prevents A-related-B and B-related-A both existing.
const (
	RelationBlocks    = "blocks"
	RelationRelated   = "related"
	RelationDuplicate = "duplicate"
)

// IssueSubscription is who hears about an issue.
type IssueSubscription struct {
	ID          uuid.UUID `json:"id"`
	WorkspaceID uuid.UUID `json:"workspaceId"`
	IssueID     uuid.UUID `json:"issueId"`
	UserID      uuid.UUID `json:"userId"`
	// Reason lets the UI say "you were mentioned" rather than leaving somebody to guess
	// why an issue they never touched is in their inbox.
	Reason string `json:"reason"`
	// Unsubscribed is a flag rather than a deleted row. Deleting instead would mean the
	// next comment auto-subscribes the user again, so unsubscribe would be a button that
	// works for about four minutes.
	Unsubscribed bool      `json:"unsubscribed"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

// Subscription reasons.
const (
	SubscribedCreated    = "created"
	SubscribedAssigned   = "assigned"
	SubscribedMentioned  = "mentioned"
	SubscribedCommented  = "commented"
	SubscribedSubscribed = "subscribed"
	SubscribedManual     = "manual"
)

// Notification is one inbox row.
//
// Every one derives from a change_log row. That is the architectural commitment: "what
// happened" already has a definition, and re-deriving it from entities produces a second
// one that disagrees within a month.
type Notification struct {
	ID          uuid.UUID  `json:"id"`
	WorkspaceID uuid.UUID  `json:"workspaceId"`
	UserID      uuid.UUID  `json:"userId"`
	Type        string     `json:"type"`
	IssueID     *uuid.UUID `json:"issueId,omitempty"`
	CommentID   *uuid.UUID `json:"commentId,omitempty"`
	Actor       Actor      `json:"actor"`

	// ChangeVersion traces this row back to the exact mutation that produced it.
	ChangeVersion int64 `json:"changeVersion"`
	// GroupKey is the coalescing key, and the reason a bulk update of two hundred issues
	// produces one inbox row per person rather than two hundred.
	GroupKey string `json:"groupKey"`
	Count    int    `json:"count"`

	Payload json.RawMessage `json:"payload,omitempty"`

	ReadAt       *time.Time `json:"readAt,omitempty"`
	SnoozedUntil *time.Time `json:"snoozedUntil,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
}

// Notification types.
const (
	NotifyIssueAssigned      = "issue_assigned"
	NotifyIssueStatusChanged = "issue_status_changed"
	NotifyIssuePriorityUp    = "issue_priority_raised"
	NotifyIssueDue           = "issue_due"
	NotifyIssueBlocked       = "issue_blocked"
	NotifyComment            = "comment"
	NotifyMention            = "mention"
	NotifySubIssueCompleted  = "sub_issue_completed"
	NotifyViewIssueAdded     = "view_issue_added"
	NotifyViewIssueCompleted = "view_issue_completed"
)

// View is a saved filter plus how to display it.
type View struct {
	ID          uuid.UUID `json:"id"`
	WorkspaceID uuid.UUID `json:"workspaceId"`
	// TeamID nil means the view spans the workspace.
	TeamID *uuid.UUID `json:"teamId,omitempty"`
	// ProjectID set means the view is attached as a tab on that project.
	ProjectID *uuid.UUID `json:"projectId,omitempty"`
	// OwnerID nil means shared. Set means it is that person's private view, and its
	// change rows carry a user scope.
	OwnerID *uuid.UUID `json:"ownerId,omitempty"`

	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
	Icon        *string `json:"icon,omitempty"`
	Color       *string `json:"color,omitempty"`

	// Filter is the filter AST, exactly as the one compiler consumes it — the same bytes
	// the client evaluates against its replica and the server compiles to SQL.
	Filter json.RawMessage `json:"filter"`
	// Display is grouping, ordering, layout and which properties are shown.
	Display json.RawMessage `json:"display"`

	Position string `json:"position"`

	CreatedBy  *uuid.UUID `json:"createdBy,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	ArchivedAt *time.Time `json:"archivedAt,omitempty"`
}

// ViewSubscription is one person's watch on a saved view.
//
// Added fires when a newly created issue matches the view. Completed fires when an issue
// that currently matches is completed or canceled. Slack-channel subscriptions are a
// different row and a different milestone.
type ViewSubscription struct {
	ID          uuid.UUID `json:"id"`
	WorkspaceID uuid.UUID `json:"workspaceId"`
	ViewID      uuid.UUID `json:"viewId"`
	UserID      uuid.UUID `json:"userId"`
	Added       bool      `json:"added"`
	Completed   bool      `json:"completed"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// ViewPreference remembers display options for the views that have no row of their own —
// "Team issues", "My issues" and the rest. It lives on the server rather than in
// localStorage because the grouping you chose has to follow you to your other machine.
type ViewPreference struct {
	ID          uuid.UUID       `json:"id"`
	WorkspaceID uuid.UUID       `json:"workspaceId"`
	UserID      uuid.UUID       `json:"userId"`
	ViewKey     string          `json:"viewKey"`
	Display     json.RawMessage `json:"display"`
	CreatedAt   time.Time       `json:"createdAt"`
	UpdatedAt   time.Time       `json:"updatedAt"`
}

// Favorite is one entry in the user's own sidebar, in their own order.
type Favorite struct {
	ID          uuid.UUID `json:"id"`
	WorkspaceID uuid.UUID `json:"workspaceId"`
	UserID      uuid.UUID `json:"userId"`
	Kind        string    `json:"kind"`
	TargetID    uuid.UUID `json:"targetId"`
	Position    string    `json:"position"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// Favorite kinds.
const (
	FavoriteView  = "view"
	FavoriteTeam  = "team"
	FavoriteIssue = "issue"
	FavoriteLabel = "label"
)

// IssueTemplate prefills an issue.
type IssueTemplate struct {
	ID          uuid.UUID `json:"id"`
	WorkspaceID uuid.UUID `json:"workspaceId"`
	// TeamID nil means the template is offered in every team.
	TeamID *uuid.UUID `json:"teamId,omitempty"`

	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`

	Title string `json:"title"`
	Body  string `json:"body"`
	// Properties keys are the same names the create mutation takes.
	Properties json.RawMessage `json:"properties"`

	Position string `json:"position"`

	CreatedBy  *uuid.UUID `json:"createdBy,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	ArchivedAt *time.Time `json:"archivedAt,omitempty"`

	EmailIntakeEnabled bool    `json:"emailIntakeEnabled"`
	EmailIntakeAddress *string `json:"emailIntakeAddress,omitempty"`
}

// FormTemplateFieldType names a field kind in a form template.
type FormTemplateFieldType string

const (
	FormFieldText         FormTemplateFieldType = "text"
	FormFieldLongText     FormTemplateFieldType = "long_text"
	FormFieldDropdown     FormTemplateFieldType = "dropdown"
	FormFieldCheckboxes   FormTemplateFieldType = "checkboxes"
	FormFieldDate         FormTemplateFieldType = "date"
	FormFieldFileUpload   FormTemplateFieldType = "file_upload"
	FormFieldInstructions FormTemplateFieldType = "instructions"
	FormFieldLabelGroup   FormTemplateFieldType = "label_group"
	FormFieldPriority     FormTemplateFieldType = "priority"
	FormFieldTitle        FormTemplateFieldType = "title"
	FormFieldDueDate      FormTemplateFieldType = "due_date"
)

// FormTemplate is a structured intake template.
type FormTemplate struct {
	ID          uuid.UUID  `json:"id"`
	WorkspaceID uuid.UUID  `json:"workspaceId"`
	TeamID      *uuid.UUID `json:"teamId,omitempty"`

	Name        string          `json:"name"`
	Description *string         `json:"description,omitempty"`
	Properties  json.RawMessage `json:"properties"`

	Position string `json:"position"`

	CreatedBy  *uuid.UUID `json:"createdBy,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	ArchivedAt *time.Time `json:"archivedAt,omitempty"`
}

// RecurringIssue is a schedule that mints issues on a cadence.
//
// The title, body and properties are a snapshot taken when the schedule was created.
// Editing a source template afterwards does not change them — that is the product rule,
// and it is why they live here rather than being read back from issue_template at mint
// time. nextDueDate is the due date of the current occurrence; the worker files the next
// issue after that day has passed, at 00:01 in the team's timezone.
type RecurringIssue struct {
	ID          uuid.UUID `json:"id"`
	WorkspaceID uuid.UUID `json:"workspaceId"`
	TeamID      uuid.UUID `json:"teamId"`

	Title      string          `json:"title"`
	Body       string          `json:"body"`
	Properties json.RawMessage `json:"properties"`

	TemplateID *uuid.UUID `json:"templateId,omitempty"`

	Cadence     string `json:"cadence"`
	NextDueDate Date   `json:"nextDueDate"`

	LastCreatedAt *time.Time `json:"lastCreatedAt,omitempty"`

	CreatedBy  *uuid.UUID `json:"createdBy,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	ArchivedAt *time.Time `json:"archivedAt,omitempty"`
}

// FormTemplateField is one input in a form template.
type FormTemplateField struct {
	ID             uuid.UUID             `json:"id"`
	WorkspaceID    uuid.UUID             `json:"workspaceId"`
	FormTemplateID uuid.UUID             `json:"formTemplateId"`
	FieldType      FormTemplateFieldType `json:"fieldType"`
	Label          string                `json:"label"`
	Description    *string               `json:"description,omitempty"`
	Required       bool                  `json:"required"`
	SortOrder      string                `json:"sortOrder"`
	Config         json.RawMessage       `json:"config"`
	CreatedAt      time.Time             `json:"createdAt"`
	UpdatedAt      time.Time             `json:"updatedAt"`
}

// ProjectTemplate prefills a project with milestones and starter issues.
type ProjectTemplate struct {
	ID          uuid.UUID  `json:"id"`
	WorkspaceID uuid.UUID  `json:"workspaceId"`
	TeamID      *uuid.UUID `json:"teamId,omitempty"`

	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
	Summary     string  `json:"summary"`
	Body        string  `json:"body"`
	// Properties keys match createProject: statusId, priority, leadId, color, icon,
	// teamIds, memberIds, startDate, targetDate, initiativeIds.
	Properties json.RawMessage `json:"properties"`

	Position string `json:"position"`

	CreatedBy  *uuid.UUID `json:"createdBy,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	ArchivedAt *time.Time `json:"archivedAt,omitempty"`
}

// ProjectTemplateMilestone is a milestone to create when the template is applied.
type ProjectTemplateMilestone struct {
	ID                uuid.UUID `json:"id"`
	WorkspaceID       uuid.UUID `json:"workspaceId"`
	ProjectTemplateID uuid.UUID `json:"projectTemplateId"`
	Name              string    `json:"name"`
	Description       *string   `json:"description,omitempty"`
	TargetDate        *Date     `json:"targetDate,omitempty"`
	SortOrder         string    `json:"sortOrder"`
	CreatedAt         time.Time `json:"createdAt"`
	UpdatedAt         time.Time `json:"updatedAt"`
}

// ProjectTemplateIssue is a starter issue to create when the template is applied.
type ProjectTemplateIssue struct {
	ID                uuid.UUID       `json:"id"`
	WorkspaceID       uuid.UUID       `json:"workspaceId"`
	ProjectTemplateID uuid.UUID       `json:"projectTemplateId"`
	ParentID          *uuid.UUID      `json:"parentId,omitempty"`
	Title             string          `json:"title"`
	Description       string          `json:"description"`
	Properties        json.RawMessage `json:"properties"`
	SortOrder         string          `json:"sortOrder"`
	CreatedAt         time.Time       `json:"createdAt"`
	UpdatedAt         time.Time       `json:"updatedAt"`
}

const (
	CadenceDaily     = "daily"
	CadenceWeekly    = "weekly"
	CadenceBiweekly  = "biweekly"
	CadenceMonthly   = "monthly"
	CadenceQuarterly = "quarterly"
	CadenceYearly    = "yearly"
)

// APIKey is a personal key, which acts as its owner.
//
// Deliberately NOT on the sync stream. Every other entity here is replicated because it is
// rendered in a hot path; keys are listed on one settings screen, rarely, and replicating
// them would put a credential's metadata in every device's IndexedDB for no gain.
//
// The token itself never appears in this struct at all. It exists in the response to the
// call that created it and nowhere else, so a database leak does not hand out working
// credentials and neither does a replica.
type APIKey struct {
	ID          uuid.UUID `json:"id"`
	WorkspaceID uuid.UUID `json:"workspaceId"`
	UserID      uuid.UUID `json:"userId"`
	Name        string    `json:"name"`
	// Prefix is the leading characters, so a listing can say which key is which without
	// the listing itself being a credential.
	Prefix string   `json:"prefix"`
	Scopes []string `json:"scopes"`

	LastUsedAt *time.Time `json:"lastUsedAt,omitempty"`
	ExpiresAt  *time.Time `json:"expiresAt,omitempty"`
	RevokedAt  *time.Time `json:"revokedAt,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
}

// Webhook is an outbound HTTPS subscription.
//
// Not on the sync stream: it is an admin settings row that carries a signing secret we
// have to keep in order to sign deliveries. Replicating it would put a live credential
// on every device. The secret itself is absent here for the same reason APIKey has no
// token — it exists in the create response and in the database column the delivery path
// reads, and nowhere a listing or a replica can see it.
type Webhook struct {
	ID                  uuid.UUID  `json:"id"`
	WorkspaceID         uuid.UUID  `json:"workspaceId"`
	CreatorID           uuid.UUID  `json:"creatorId"`
	URL                 string     `json:"url"`
	Enabled             bool       `json:"enabled"`
	AllPublicTeams      bool       `json:"allPublicTeams"`
	TeamID              *uuid.UUID `json:"teamId,omitempty"`
	ResourceTypes       []string   `json:"resourceTypes"`
	ConsecutiveFailures int        `json:"consecutiveFailures"`
	DisabledAt          *time.Time `json:"disabledAt,omitempty"`
	CreatedAt           time.Time  `json:"createdAt"`
	UpdatedAt           time.Time  `json:"updatedAt"`
}

// WebhookDelivery is one attempt log an admin can read to self-diagnose. The signed body
// is not here: a listing of payloads is a second copy of every issue that went out.
type WebhookDelivery struct {
	ID             uuid.UUID  `json:"id"`
	WebhookID      uuid.UUID  `json:"webhookId"`
	ChangeVersion  int64      `json:"changeVersion"`
	EntityType     string     `json:"entityType"`
	Attempt        int        `json:"attempt"`
	LastStatus     *int       `json:"lastStatus,omitempty"`
	LastError      *string    `json:"lastError,omitempty"`
	LastDurationMs *int       `json:"lastDurationMs,omitempty"`
	DeliveredAt    *time.Time `json:"deliveredAt,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
}

// OauthClient is a third-party application this workspace owns.
//
// Not on the sync stream: it is an admin settings row whose secret is a credential, and
// putting either in every device's replica would be an exfiltration path. The secret itself
// is absent here exactly as APIKey has no token.
type OauthClient struct {
	ID                       uuid.UUID  `json:"id"`
	WorkspaceID              uuid.UUID  `json:"workspaceId"`
	CreatorID                uuid.UUID  `json:"creatorId"`
	ClientID                 string     `json:"clientId"`
	Name                     string     `json:"name"`
	Description              *string    `json:"description,omitempty"`
	Developer                *string    `json:"developer,omitempty"`
	DeveloperURL             *string    `json:"developerUrl,omitempty"`
	ImageURL                 *string    `json:"imageUrl,omitempty"`
	RedirectURIs             []string   `json:"redirectUris"`
	AllowedScopes            []string   `json:"allowedScopes"`
	PublicEnabled            bool       `json:"publicEnabled"`
	ClientCredentialsEnabled bool       `json:"clientCredentialsEnabled"`
	WebhookURL               *string    `json:"webhookUrl,omitempty"`
	CreatedAt                time.Time  `json:"createdAt"`
	UpdatedAt                time.Time  `json:"updatedAt"`
	ArchivedAt               *time.Time `json:"archivedAt,omitempty"`
}

// OauthClientInfo is the public metadata a consent screen may show. No secret, no
// redirect-URI list — those are checked on the server, not advertised.
type OauthClientInfo struct {
	ClientID      string   `json:"clientId"`
	Name          string   `json:"name"`
	Description   *string  `json:"description,omitempty"`
	Developer     *string  `json:"developer,omitempty"`
	DeveloperURL  *string  `json:"developerUrl,omitempty"`
	ImageURL      *string  `json:"imageUrl,omitempty"`
	AllowedScopes []string `json:"allowedScopes"`
}

// Invite is an outstanding invitation to the workspace.
//
// Not on the sync stream, for the same reason APIKey is not: it is read on one settings
// screen by admins, and it is a list of the email addresses of people who do not work here
// yet — which is not something to replicate to every device in the workspace.
//
// The token is absent here exactly as it is on APIKey. It exists in the email that went
// out and nowhere else, so a database leak does not hand out workspace access.
type Invite struct {
	ID          uuid.UUID   `json:"id"`
	WorkspaceID uuid.UUID   `json:"workspaceId"`
	Email       string      `json:"email"`
	Role        string      `json:"role"`
	InvitedBy   *uuid.UUID  `json:"invitedBy,omitempty"`
	TeamIDs     []uuid.UUID `json:"teamIds"`

	AcceptedAt *time.Time `json:"acceptedAt,omitempty"`
	RevokedAt  *time.Time `json:"revokedAt,omitempty"`
	ExpiresAt  time.Time  `json:"expiresAt"`
	CreatedAt  time.Time  `json:"createdAt"`
}

type Comment struct {
	ID          uuid.UUID  `json:"id"`
	WorkspaceID uuid.UUID  `json:"workspaceId"`
	IssueID     uuid.UUID  `json:"issueId"`
	ParentID    *uuid.UUID `json:"parentId,omitempty"`
	Body        string     `json:"body"`
	Actor       Actor      `json:"actor"`
	EditedAt    *time.Time `json:"editedAt,omitempty"`
	ResolvedAt  *time.Time `json:"resolvedAt,omitempty"`
	ResolvedBy  *uuid.UUID `json:"resolvedBy,omitempty"`
	// AnchorStart/AnchorEnd/Quote pin a comment to a span of the issue description.
	// All three are set together on an inline comment and omitted on a thread comment.
	AnchorStart *int      `json:"anchorStart,omitempty"`
	AnchorEnd   *int      `json:"anchorEnd,omitempty"`
	Quote       *string   `json:"quote,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// Attachment is a link card on an issue. The URL is unique per issue: posting the same
// URL again updates the existing row. Integrations stay stateless because of that.
type Attachment struct {
	ID          uuid.UUID       `json:"id"`
	WorkspaceID uuid.UUID       `json:"workspaceId"`
	IssueID     uuid.UUID       `json:"issueId"`
	TeamID      uuid.UUID       `json:"teamId"`
	URL         string          `json:"url"`
	Title       string          `json:"title"`
	Subtitle    *string         `json:"subtitle,omitempty"`
	IconURL     *string         `json:"iconUrl,omitempty"`
	Metadata    json.RawMessage `json:"metadata,omitempty"`
	CreatorID   *uuid.UUID      `json:"creatorId,omitempty"`
	CreatedAt   time.Time       `json:"createdAt"`
	UpdatedAt   time.Time       `json:"updatedAt"`
}

const (
	InitiativeStatusProposed  = "proposed"
	InitiativeStatusPlanned   = "planned"
	InitiativeStatusActive    = "active"
	InitiativeStatusCompleted = "completed"
	InitiativeStatusCanceled  = "canceled"
)

// Initiative groups a manually curated set of projects around one objective.
type Initiative struct {
	ID                    uuid.UUID  `json:"id"`
	WorkspaceID           uuid.UUID  `json:"workspaceId"`
	Name                  string     `json:"name"`
	Description           string     `json:"description"`
	Status                string     `json:"status"`
	Priority              int16      `json:"priority"`
	OwnerID               *uuid.UUID `json:"ownerId,omitempty"`
	LeadTeamID            *uuid.UUID `json:"leadTeamId,omitempty"`
	CreatorID             *uuid.UUID `json:"creatorId,omitempty"`
	SortOrder             string     `json:"sortOrder"`
	TargetDate            *Date      `json:"targetDate,omitempty"`
	TargetDateGranularity *string    `json:"targetDateGranularity,omitempty"`
	ArchivedAt            *time.Time `json:"archivedAt,omitempty"`
	DeletedAt             *time.Time `json:"deletedAt,omitempty"`
	DeletedBy             *uuid.UUID `json:"deletedBy,omitempty"`
	CreatedAt             time.Time  `json:"createdAt"`
	UpdatedAt             time.Time  `json:"updatedAt"`
}

type InitiativeProject struct {
	ID           uuid.UUID `json:"id"`
	WorkspaceID  uuid.UUID `json:"workspaceId"`
	InitiativeID uuid.UUID `json:"initiativeId"`
	ProjectID    uuid.UUID `json:"projectId"`
	CreatedAt    time.Time `json:"createdAt"`
}

const (
	CustomerStatusActive   = "active"
	CustomerStatusProspect = "prospect"
	CustomerStatusChurned  = "churned"
)

// Customer is an external organisation whose feedback is attributed onto issues and projects.
type Customer struct {
	ID          uuid.UUID  `json:"id"`
	WorkspaceID uuid.UUID  `json:"workspaceId"`
	Name        string     `json:"name"`
	Domains     []string   `json:"domains"`
	Revenue     *int32     `json:"revenue,omitempty"`
	Size        *int32     `json:"size,omitempty"`
	Tier        *string    `json:"tier,omitempty"`
	Status      string     `json:"status"`
	OwnerID     *uuid.UUID `json:"ownerId,omitempty"`
	LogoURL     string     `json:"logoUrl"`
	CreatorID   *uuid.UUID `json:"creatorId,omitempty"`
	SortOrder   string     `json:"sortOrder"`
	ArchivedAt  *time.Time `json:"archivedAt,omitempty"`
	DeletedAt   *time.Time `json:"deletedAt,omitempty"`
	DeletedBy   *uuid.UUID `json:"deletedBy,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

// CustomerRequest is feedback attached to an issue and/or a project, optionally a customer.
type CustomerRequest struct {
	ID          uuid.UUID  `json:"id"`
	WorkspaceID uuid.UUID  `json:"workspaceId"`
	CustomerID  *uuid.UUID `json:"customerId,omitempty"`
	IssueID     *uuid.UUID `json:"issueId,omitempty"`
	ProjectID   *uuid.UUID `json:"projectId,omitempty"`
	Body        string     `json:"body"`
	Important   bool       `json:"important"`
	CreatorID   *uuid.UUID `json:"creatorId,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

const (
	SlaActionApply  = "apply"
	SlaActionRemove = "remove"
)

// SlaRule is a workspace policy: first match wins. Applying one sets the issue's due date
// and marks dueDateSource as sla; removing one clears an SLA-owned date.
type SlaRule struct {
	ID              uuid.UUID       `json:"id"`
	WorkspaceID     uuid.UUID       `json:"workspaceId"`
	Position        string          `json:"position"`
	Filter          json.RawMessage `json:"filter"`
	Action          string          `json:"action"`
	DurationMinutes *int32          `json:"durationMinutes,omitempty"`
	CreatedAt       time.Time       `json:"createdAt"`
	UpdatedAt       time.Time       `json:"updatedAt"`
}

const (
	DashboardMeasureCount     = "count"
	DashboardMeasureEffort    = "effort"
	DashboardMeasureCycleTime = "cycle_time"
	DashboardMeasureLeadTime  = "lead_time"
	DashboardMeasureIssueAge  = "issue_age"
	DashboardMeasureBurnUp    = "burn_up"

	DashboardSliceAssignee      = "assignee"
	DashboardSlicePriority      = "priority"
	DashboardSliceStateCategory = "state_category"
	DashboardSliceTeam          = "team"
	DashboardSliceProject       = "project"
	DashboardSliceLabel         = "label"

	DashboardDisplayChart  = "chart"
	DashboardDisplayTable  = "table"
	DashboardDisplayMetric = "metric"
)

// Dashboard is a page of Insights tiles. Personal when OwnerID is set, team-scoped when
// TeamID is set, otherwise workspace-wide.
type Dashboard struct {
	ID          uuid.UUID       `json:"id"`
	WorkspaceID uuid.UUID       `json:"workspaceId"`
	TeamID      *uuid.UUID      `json:"teamId,omitempty"`
	OwnerID     *uuid.UUID      `json:"ownerId,omitempty"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Filter      json.RawMessage `json:"filter"`
	CreatorID   *uuid.UUID      `json:"creatorId,omitempty"`
	SortOrder   string          `json:"sortOrder"`
	ArchivedAt  *time.Time      `json:"archivedAt,omitempty"`
	DeletedAt   *time.Time      `json:"deletedAt,omitempty"`
	DeletedBy   *uuid.UUID      `json:"deletedBy,omitempty"`
	CreatedAt   time.Time       `json:"createdAt"`
	UpdatedAt   time.Time       `json:"updatedAt"`
}

// DashboardTile is one Insights chart on a dashboard.
type DashboardTile struct {
	ID          uuid.UUID       `json:"id"`
	WorkspaceID uuid.UUID       `json:"workspaceId"`
	DashboardID uuid.UUID       `json:"dashboardId"`
	Title       string          `json:"title"`
	Measure     string          `json:"measure"`
	Slice       string          `json:"slice"`
	Display     string          `json:"display"`
	Filter      json.RawMessage `json:"filter"`
	SortOrder   string          `json:"sortOrder"`
	CreatedAt   time.Time       `json:"createdAt"`
	UpdatedAt   time.Time       `json:"updatedAt"`
}

// AskForm is a shareable intake form. Submitting it creates an issue in the team's
// triage (or default status, if triage is off). The token is the public URL secret.
type AskForm struct {
	ID          uuid.UUID  `json:"id"`
	WorkspaceID uuid.UUID  `json:"workspaceId"`
	TeamID      uuid.UUID  `json:"teamId"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	Token       string     `json:"token"`
	CreatorID   *uuid.UUID `json:"creatorId,omitempty"`
	ArchivedAt  *time.Time `json:"archivedAt,omitempty"`
	DeletedAt   *time.Time `json:"deletedAt,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

// Document is long-form markdown attached to a team or a project. The body is plain markdown
// until collaborative editing lands; it is not a CRDT snapshot yet.
type Document struct {
	ID          uuid.UUID  `json:"id"`
	WorkspaceID uuid.UUID  `json:"workspaceId"`
	TeamID      uuid.UUID  `json:"teamId"`
	ProjectID   *uuid.UUID `json:"projectId,omitempty"`
	Title       string     `json:"title"`
	Body        string     `json:"body"`
	SortOrder   string     `json:"sortOrder"`
	CreatorID   *uuid.UUID `json:"creatorId,omitempty"`
	UpdatedBy   *uuid.UUID `json:"updatedBy,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	ArchivedAt  *time.Time `json:"archivedAt,omitempty"`
	DeletedAt   *time.Time `json:"deletedAt,omitempty"`
}

const (
	ProjectUpdateHealthOnTrack  = "on_track"
	ProjectUpdateHealthAtRisk   = "at_risk"
	ProjectUpdateHealthOffTrack = "off_track"
)

// ProjectUpdate is a status post on a project — health plus narrative markdown. Health on
// the project row itself is not stored; it is derived from the latest live update.
type ProjectUpdate struct {
	ID          uuid.UUID  `json:"id"`
	WorkspaceID uuid.UUID  `json:"workspaceId"`
	ProjectID   uuid.UUID  `json:"projectId"`
	Health      string     `json:"health"`
	Body        string     `json:"body"`
	AuthorID    uuid.UUID  `json:"authorId"`
	EditedAt    *time.Time `json:"editedAt,omitempty"`
	DeletedAt   *time.Time `json:"deletedAt,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

// ProjectDependency is an end→start link: the blocking project must finish before the
// blocked project may start.
type ProjectDependency struct {
	ID                uuid.UUID `json:"id"`
	WorkspaceID       uuid.UUID `json:"workspaceId"`
	BlockingProjectID uuid.UUID `json:"blockingProjectId"`
	BlockedProjectID  uuid.UUID `json:"blockedProjectId"`
	CreatedAt         time.Time `json:"createdAt"`
}

type IssueHistoryEntry struct {
	ID        uuid.UUID `json:"id"`
	IssueID   uuid.UUID `json:"issueId"`
	Actor     Actor     `json:"actor"`
	Kind      string    `json:"kind"`
	FromValue any       `json:"fromValue,omitempty"`
	ToValue   any       `json:"toValue,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// Identifier builds the human-readable issue id from a team key and issue number.
// Exported because the bootstrap serialiser, the API and the seeder all need it and
// none of them should reimplement the format.
func Identifier(teamKey string, number int64) string {
	return teamKey + "-" + itoa(number)
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// ProjectStatusCategory values. `started` is what the UI calls In Progress — the same
// word the issue workflow already uses, so progress rollups branch on one vocabulary.
const (
	ProjectCategoryBacklog   = "backlog"
	ProjectCategoryPlanned   = "planned"
	ProjectCategoryStarted   = "started"
	ProjectCategoryCompleted = "completed"
	ProjectCategoryCanceled  = "canceled"
)

// ProjectUpdateSchedule values for per-project reminder overrides.
const (
	ProjectUpdateScheduleDefault = "default"
	ProjectUpdateScheduleNever   = "never"
	ProjectUpdateScheduleCustom  = "custom"
)

// TimeframeGranularity is how coarsely a project date is meant. A date without one is
// just a day; "Q3" is a date in that quarter plus this flag, never an instant.
const (
	GranularityDay     = "day"
	GranularityMonth   = "month"
	GranularityQuarter = "quarter"
	GranularityHalf    = "half"
	GranularityYear    = "year"
)

// ProjectStatus is a workspace-defined status a project may sit in.
type ProjectStatus struct {
	ID          uuid.UUID  `json:"id"`
	WorkspaceID uuid.UUID  `json:"workspaceId"`
	Name        string     `json:"name"`
	Description *string    `json:"description,omitempty"`
	Color       string     `json:"color"`
	Category    string     `json:"category"`
	Position    string     `json:"position"`
	IsDefault   bool       `json:"isDefault"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	ArchivedAt  *time.Time `json:"archivedAt,omitempty"`
}

// Project is a unit of work with a clear outcome. It spans teams; each issue still
// belongs to exactly one team and to at most one project.
type Project struct {
	ID          uuid.UUID  `json:"id"`
	WorkspaceID uuid.UUID  `json:"workspaceId"`
	Name        string     `json:"name"`
	Summary     *string    `json:"summary,omitempty"`
	Description string     `json:"description"`
	Icon        *string    `json:"icon,omitempty"`
	Color       string     `json:"color"`
	StatusID    uuid.UUID  `json:"statusId"`
	Priority    int        `json:"priority"`
	LeadID      *uuid.UUID `json:"leadId,omitempty"`
	CreatorID   *uuid.UUID `json:"creatorId,omitempty"`
	SortOrder   string     `json:"sortOrder"`

	StartDate             *Date   `json:"startDate,omitempty"`
	StartDateGranularity  *string `json:"startDateGranularity,omitempty"`
	TargetDate            *Date   `json:"targetDate,omitempty"`
	TargetDateGranularity *string `json:"targetDateGranularity,omitempty"`

	// Update schedule: default (workspace cadence), custom, or never.
	UpdateSchedule             string `json:"updateSchedule"`
	UpdateReminderIntervalDays *int   `json:"updateReminderIntervalDays,omitempty"`
	UpdateReminderWeekday      *int   `json:"updateReminderWeekday,omitempty"`
	UpdateReminderHour         *int   `json:"updateReminderHour,omitempty"`

	ProjectTemplateID *uuid.UUID `json:"projectTemplateId,omitempty"`

	ArchivedAt *time.Time `json:"archivedAt,omitempty"`
	DeletedAt  *time.Time `json:"deletedAt,omitempty"`
	DeletedBy  *uuid.UUID `json:"deletedBy,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
}

// ProjectTeam is one team on one project, as its own entity — the labels lesson.
type ProjectTeam struct {
	ID          uuid.UUID `json:"id"`
	WorkspaceID uuid.UUID `json:"workspaceId"`
	ProjectID   uuid.UUID `json:"projectId"`
	TeamID      uuid.UUID `json:"teamId"`
	CreatedAt   time.Time `json:"createdAt"`
}

// ProjectMember is one person on one project, as its own entity for the same reason.
type ProjectMember struct {
	ID          uuid.UUID `json:"id"`
	WorkspaceID uuid.UUID `json:"workspaceId"`
	ProjectID   uuid.UUID `json:"projectId"`
	UserID      uuid.UUID `json:"userId"`
	CreatedAt   time.Time `json:"createdAt"`
}

// ProjectMilestone is an ordered checkpoint inside one project. It cannot be shared.
type ProjectMilestone struct {
	ID          uuid.UUID  `json:"id"`
	WorkspaceID uuid.UUID  `json:"workspaceId"`
	ProjectID   uuid.UUID  `json:"projectId"`
	Name        string     `json:"name"`
	Description *string    `json:"description,omitempty"`
	TargetDate  *Date      `json:"targetDate,omitempty"`
	SortOrder   string     `json:"sortOrder"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	ArchivedAt  *time.Time `json:"archivedAt,omitempty"`
}

// Draft is an unsent issue or comment the author asked to keep.
//
// Not on the sync stream. A draft is personal: the Drafts page loads the caller's rows on
// demand, the same way invites and webhooks load, and a replica that held everybody's
// abandoned titles would be both a leak and a waste. The payload is opaque JSON so an
// issue draft and a comment draft share one table without a pile of nullable columns.
type Draft struct {
	ID          uuid.UUID       `json:"id"`
	WorkspaceID uuid.UUID       `json:"workspaceId"`
	UserID      uuid.UUID       `json:"userId"`
	Kind        string          `json:"kind"`
	Payload     json.RawMessage `json:"payload"`
	CreatedAt   time.Time       `json:"createdAt"`
	UpdatedAt   time.Time       `json:"updatedAt"`
}
