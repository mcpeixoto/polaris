package graph

import (
	"encoding/json"
	"fmt"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// The model-to-GraphQL conversions for everything M1 added.
//
// A separate file from convert.go for one mechanical reason and one editorial one. The
// mechanical: gqlgen rewrites schema.resolvers.go on every generate and silently comments
// out anything it does not recognise, so nothing that must survive generation goes near it
// — a helper in the wrong file cost a whole build once already. The editorial: convert.go
// is the M0 set and is stable; keeping the new work beside it rather than woven through it
// means a reviewer can read either one without the other.
//
// Every function here is total and every enum conversion is closed: an unrecognised value
// is an error rather than a zero value. A silent zero here means the API returns
// "ISSUE_ASSIGNED" for a notification type nobody has implemented yet, which is worse than
// a 500 because nothing reports it.

// ---------------------------------------------------------------------------------- labels

func toLabel(l model.Label) generated.Label {
	return generated.Label{
		ID:          l.ID,
		WorkspaceID: l.WorkspaceID,
		TeamID:      l.TeamID,
		ParentID:    l.ParentID,
		IsGroup:     l.IsGroup,
		Name:        l.Name,
		Description: l.Description,
		Color:       l.Color,
		Position:    l.Position,
		CreatedAt:   l.CreatedAt,
		UpdatedAt:   l.UpdatedAt,
		ArchivedAt:  l.ArchivedAt,
	}
}

func toLabels(labels []model.Label) []generated.Label {
	out := make([]generated.Label, 0, len(labels))
	for _, l := range labels {
		out = append(out, toLabel(l))
	}
	return out
}

// toIssueLabel leaves the nested Label nil for the field resolver to fill.
//
// Resolving it here would mean a read per application per issue — the N+1 that the
// dataloaders exist to prevent, and the one place it would hurt most, since a filtered list
// renders every visible issue's labels.
func toIssueLabel(il model.IssueLabel) generated.IssueLabel {
	return generated.IssueLabel{
		ID:          il.ID,
		WorkspaceID: il.WorkspaceID,
		IssueID:     il.IssueID,
		LabelID:     il.LabelID,
		TeamID:      il.TeamID,
		GroupID:     il.GroupID,
		CreatedBy:   il.CreatedBy,
		CreatedAt:   il.CreatedAt,
	}
}

func toIssueLabels(rows []model.IssueLabel) []generated.IssueLabel {
	out := make([]generated.IssueLabel, 0, len(rows))
	for _, il := range rows {
		out = append(out, toIssueLabel(il))
	}
	return out
}

// ------------------------------------------------------------------------------- relations

func toIssueRelation(r model.IssueRelation) (generated.IssueRelation, error) {
	kind, err := toRelationType(r.Type)
	if err != nil {
		return generated.IssueRelation{}, err
	}
	return generated.IssueRelation{
		ID:             r.ID,
		WorkspaceID:    r.WorkspaceID,
		IssueID:        r.IssueID,
		RelatedIssueID: r.RelatedIssueID,
		Type:           kind,
		TeamID:         r.TeamID,
		RelatedTeamID:  r.RelatedTeamID,
		CreatedBy:      r.CreatedBy,
		CreatedAt:      r.CreatedAt,
	}, nil
}

func toIssueRelations(rows []model.IssueRelation) ([]generated.IssueRelation, error) {
	out := make([]generated.IssueRelation, 0, len(rows))
	for _, r := range rows {
		converted, err := toIssueRelation(r)
		if err != nil {
			return nil, err
		}
		out = append(out, converted)
	}
	return out, nil
}

func toRelationType(v string) (generated.RelationType, error) {
	switch v {
	case model.RelationBlocks:
		return generated.RelationTypeBlocks, nil
	case model.RelationRelated:
		return generated.RelationTypeRelated, nil
	case model.RelationDuplicate:
		return generated.RelationTypeDuplicate, nil
	}
	return "", platform.Internal(fmt.Errorf("unknown relation type %q", v))
}

func fromRelationType(t generated.RelationType) (string, error) {
	switch t {
	case generated.RelationTypeBlocks:
		return model.RelationBlocks, nil
	case generated.RelationTypeRelated:
		return model.RelationRelated, nil
	case generated.RelationTypeDuplicate:
		return model.RelationDuplicate, nil
	}
	return "", platform.Validation("type", "that is not a relation type")
}

func toIssueProgress(p *model.IssueProgress) *generated.IssueProgress {
	// Nil rather than a zeroed struct, and the schema says so: an issue with no children
	// has no progress, which is a different statement from nought per cent complete.
	if p == nil {
		return nil
	}
	return &generated.IssueProgress{
		Total:     p.Total,
		Completed: p.Completed,
		Canceled:  p.Canceled,
		Percent:   p.Percent,
	}
}

// --------------------------------------------------------------------------- subscriptions

func toIssueSubscription(s model.IssueSubscription) (generated.IssueSubscription, error) {
	reason, err := toSubscriptionReason(s.Reason)
	if err != nil {
		return generated.IssueSubscription{}, err
	}
	return generated.IssueSubscription{
		ID:           s.ID,
		WorkspaceID:  s.WorkspaceID,
		IssueID:      s.IssueID,
		UserID:       s.UserID,
		Reason:       reason,
		Unsubscribed: s.Unsubscribed,
		CreatedAt:    s.CreatedAt,
		UpdatedAt:    s.UpdatedAt,
	}, nil
}

func toIssueSubscriptions(rows []model.IssueSubscription) ([]generated.IssueSubscription, error) {
	out := make([]generated.IssueSubscription, 0, len(rows))
	for _, s := range rows {
		converted, err := toIssueSubscription(s)
		if err != nil {
			return nil, err
		}
		out = append(out, converted)
	}
	return out, nil
}

func toSubscriptionReason(v string) (generated.SubscriptionReason, error) {
	switch v {
	case model.SubscribedCreated:
		return generated.SubscriptionReasonCreated, nil
	case model.SubscribedAssigned:
		return generated.SubscriptionReasonAssigned, nil
	case model.SubscribedMentioned:
		return generated.SubscriptionReasonMentioned, nil
	case model.SubscribedCommented:
		return generated.SubscriptionReasonCommented, nil
	case model.SubscribedSubscribed:
		return generated.SubscriptionReasonSubscribed, nil
	case model.SubscribedManual:
		return generated.SubscriptionReasonManual, nil
	}
	return "", platform.Internal(fmt.Errorf("unknown subscription reason %q", v))
}

// --------------------------------------------------------------------------- notifications

func toNotification(n model.Notification) (generated.Notification, error) {
	kind, err := toNotificationType(n.Type)
	if err != nil {
		return generated.Notification{}, err
	}
	actor, err := toActor(n.Actor)
	if err != nil {
		return generated.Notification{}, err
	}
	return generated.Notification{
		ID:            n.ID,
		WorkspaceID:   n.WorkspaceID,
		UserID:        n.UserID,
		Type:          kind,
		IssueID:       n.IssueID,
		CommentID:     n.CommentID,
		Actor:         actor,
		ChangeVersion: int(n.ChangeVersion),
		GroupKey:      n.GroupKey,
		Count:         n.Count,
		Payload:       n.Payload,
		ReadAt:        n.ReadAt,
		SnoozedUntil:  n.SnoozedUntil,
		CreatedAt:     n.CreatedAt,
		UpdatedAt:     n.UpdatedAt,
	}, nil
}

func toNotifications(rows []model.Notification) ([]generated.Notification, error) {
	out := make([]generated.Notification, 0, len(rows))
	for _, n := range rows {
		converted, err := toNotification(n)
		if err != nil {
			return nil, err
		}
		out = append(out, converted)
	}
	return out, nil
}

func toNotificationType(v string) (generated.NotificationType, error) {
	switch v {
	case model.NotifyIssueAssigned:
		return generated.NotificationTypeIssueAssigned, nil
	case model.NotifyIssueStatusChanged:
		return generated.NotificationTypeIssueStatusChanged, nil
	case model.NotifyIssuePriorityUp:
		return generated.NotificationTypeIssuePriorityRaised, nil
	case model.NotifyIssueDue:
		return generated.NotificationTypeIssueDue, nil
	case model.NotifyIssueBlocked:
		return generated.NotificationTypeIssueBlocked, nil
	case model.NotifyComment:
		return generated.NotificationTypeComment, nil
	case model.NotifyMention:
		return generated.NotificationTypeMention, nil
	case model.NotifySubIssueCompleted:
		return generated.NotificationTypeSubIssueCompleted, nil
	}
	return "", platform.Internal(fmt.Errorf("unknown notification type %q", v))
}

// ----------------------------------------------------------------------------------- views

func toView(v model.View) generated.View {
	return generated.View{
		ID:          v.ID,
		WorkspaceID: v.WorkspaceID,
		TeamID:      v.TeamID,
		OwnerID:     v.OwnerID,
		Name:        v.Name,
		Description: v.Description,
		Icon:        v.Icon,
		Color:       v.Color,
		Filter:      jsonOrEmptyObject(v.Filter),
		Display:     jsonOrEmptyObject(v.Display),
		Position:    v.Position,
		CreatedBy:   v.CreatedBy,
		CreatedAt:   v.CreatedAt,
		UpdatedAt:   v.UpdatedAt,
		ArchivedAt:  v.ArchivedAt,
	}
}

func toViews(rows []model.View) []generated.View {
	out := make([]generated.View, 0, len(rows))
	for _, v := range rows {
		out = append(out, toView(v))
	}
	return out
}

func toViewPreference(p model.ViewPreference) generated.ViewPreference {
	return generated.ViewPreference{
		ID:          p.ID,
		WorkspaceID: p.WorkspaceID,
		UserID:      p.UserID,
		ViewKey:     p.ViewKey,
		Display:     jsonOrEmptyObject(p.Display),
		CreatedAt:   p.CreatedAt,
		UpdatedAt:   p.UpdatedAt,
	}
}

func toViewPreferences(rows []model.ViewPreference) []generated.ViewPreference {
	out := make([]generated.ViewPreference, 0, len(rows))
	for _, p := range rows {
		out = append(out, toViewPreference(p))
	}
	return out
}

/*
jsonOrEmptyObject keeps a non-null JSON field non-null.

The schema declares `filter: JSON!` and `display: JSON!`, and a nil json.RawMessage
marshals to `null` rather than to nothing — which violates the non-null contract and, worse,
reaches the client as a filter it then has to special-case. `{}` is the canonical empty
filter and the canonical empty display, so it is what absence means here.
*/
func jsonOrEmptyObject(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage(`{}`)
	}
	return raw
}

// ------------------------------------------------------------------------------- favourites

func toFavorite(f model.Favorite) (generated.Favorite, error) {
	kind, err := toFavoriteKind(f.Kind)
	if err != nil {
		return generated.Favorite{}, err
	}
	return generated.Favorite{
		ID:          f.ID,
		WorkspaceID: f.WorkspaceID,
		UserID:      f.UserID,
		Kind:        kind,
		TargetID:    f.TargetID,
		Position:    f.Position,
		CreatedAt:   f.CreatedAt,
		UpdatedAt:   f.UpdatedAt,
	}, nil
}

func toFavorites(rows []model.Favorite) ([]generated.Favorite, error) {
	out := make([]generated.Favorite, 0, len(rows))
	for _, f := range rows {
		converted, err := toFavorite(f)
		if err != nil {
			return nil, err
		}
		out = append(out, converted)
	}
	return out, nil
}

func toFavoriteKind(v string) (generated.FavoriteKind, error) {
	switch v {
	case model.FavoriteView:
		return generated.FavoriteKindView, nil
	case model.FavoriteTeam:
		return generated.FavoriteKindTeam, nil
	case model.FavoriteIssue:
		return generated.FavoriteKindIssue, nil
	case model.FavoriteLabel:
		return generated.FavoriteKindLabel, nil
	}
	return "", platform.Internal(fmt.Errorf("unknown favourite kind %q", v))
}

func fromFavoriteKind(k generated.FavoriteKind) (string, error) {
	switch k {
	case generated.FavoriteKindView:
		return model.FavoriteView, nil
	case generated.FavoriteKindTeam:
		return model.FavoriteTeam, nil
	case generated.FavoriteKindIssue:
		return model.FavoriteIssue, nil
	case generated.FavoriteKindLabel:
		return model.FavoriteLabel, nil
	}
	return "", platform.Validation("kind", "that is not something you can favourite")
}

// -------------------------------------------------------------------------------- templates

func toIssueTemplate(t model.IssueTemplate) generated.IssueTemplate {
	return generated.IssueTemplate{
		ID:          t.ID,
		WorkspaceID: t.WorkspaceID,
		TeamID:      t.TeamID,
		Name:        t.Name,
		Description: t.Description,
		Title:       t.Title,
		Body:        t.Body,
		Properties:  jsonOrEmptyObject(t.Properties),
		Position:    t.Position,
		CreatedBy:   t.CreatedBy,
		CreatedAt:   t.CreatedAt,
		UpdatedAt:   t.UpdatedAt,
		ArchivedAt:  t.ArchivedAt,
	}
}

func toIssueTemplates(rows []model.IssueTemplate) []generated.IssueTemplate {
	out := make([]generated.IssueTemplate, 0, len(rows))
	for _, t := range rows {
		out = append(out, toIssueTemplate(t))
	}
	return out
}

// --------------------------------------------------------------------------------- api keys

// toAPIKey never carries the token, because model.APIKey has no field for one.
//
// That is the design and it is worth not undoing: the plaintext exists in the response to
// the call that created it and nowhere else. If you find yourself wanting to add it here,
// the thing you actually want is for the user to make a new key.
func toAPIKey(k model.APIKey) generated.APIKey {
	return generated.APIKey{
		ID:          k.ID,
		WorkspaceID: k.WorkspaceID,
		UserID:      k.UserID,
		Name:        k.Name,
		Prefix:      k.Prefix,
		Scopes:      k.Scopes,
		LastUsedAt:  k.LastUsedAt,
		ExpiresAt:   k.ExpiresAt,
		RevokedAt:   k.RevokedAt,
		CreatedAt:   k.CreatedAt,
		UpdatedAt:   k.UpdatedAt,
	}
}

func toAPIKeys(rows []model.APIKey) []generated.APIKey {
	out := make([]generated.APIKey, 0, len(rows))
	for _, k := range rows {
		out = append(out, toAPIKey(k))
	}
	return out
}

func toWebhook(w model.Webhook) generated.Webhook {
	return generated.Webhook{
		ID:                  w.ID,
		WorkspaceID:         w.WorkspaceID,
		CreatorID:           w.CreatorID,
		URL:                 w.URL,
		Enabled:             w.Enabled,
		AllPublicTeams:      w.AllPublicTeams,
		TeamID:              w.TeamID,
		ResourceTypes:       w.ResourceTypes,
		ConsecutiveFailures: w.ConsecutiveFailures,
		DisabledAt:          w.DisabledAt,
		CreatedAt:           w.CreatedAt,
		UpdatedAt:           w.UpdatedAt,
	}
}

func toWebhooks(rows []model.Webhook) []generated.Webhook {
	out := make([]generated.Webhook, 0, len(rows))
	for _, w := range rows {
		out = append(out, toWebhook(w))
	}
	return out
}

func toWebhookDelivery(d model.WebhookDelivery) generated.WebhookDelivery {
	return generated.WebhookDelivery{
		ID:             d.ID,
		WebhookID:      d.WebhookID,
		ChangeVersion:  int(d.ChangeVersion),
		EntityType:     d.EntityType,
		Attempt:        d.Attempt,
		LastStatus:     d.LastStatus,
		LastError:      d.LastError,
		LastDurationMs: d.LastDurationMs,
		DeliveredAt:    d.DeliveredAt,
		CreatedAt:      d.CreatedAt,
	}
}

func toWebhookDeliveries(rows []model.WebhookDelivery) []generated.WebhookDelivery {
	out := make([]generated.WebhookDelivery, 0, len(rows))
	for _, d := range rows {
		out = append(out, toWebhookDelivery(d))
	}
	return out
}

// --------------------------------------------------------------------------------- invites

func toInvite(i model.Invite) (generated.Invite, error) {
	role, err := toUserRole(i.Role)
	if err != nil {
		return generated.Invite{}, err
	}
	// Non-null list on the wire: a nil slice marshals to null, and a client iterating
	// `teamIds` should not have to check.
	teams := i.TeamIDs
	if teams == nil {
		teams = []uuid.UUID{}
	}
	return generated.Invite{
		ID:          i.ID,
		WorkspaceID: i.WorkspaceID,
		Email:       i.Email,
		Role:        role,
		InvitedBy:   i.InvitedBy,
		TeamIds:     teams,
		AcceptedAt:  i.AcceptedAt,
		RevokedAt:   i.RevokedAt,
		ExpiresAt:   i.ExpiresAt,
		CreatedAt:   i.CreatedAt,
	}, nil
}

func toInvites(rows []model.Invite) ([]generated.Invite, error) {
	out := make([]generated.Invite, 0, len(rows))
	for _, i := range rows {
		converted, err := toInvite(i)
		if err != nil {
			return nil, err
		}
		out = append(out, converted)
	}
	return out, nil
}

// ---------------------------------------------------------------------------- entitlements

// limitOrNull translates the entitlement package's sentinel into the schema's null.
//
// Two representations of "no ceiling", and each is right where it lives: a sentinel keeps
// the matrix a plain table of numbers that reads at a glance, while the API says null
// because a client comparing `seatsUsed < seatLimit` against -1 would report every
// workspace as full. Converting at the boundary is the whole job of this layer.
func limitOrNull(v int) *int {
	if v == entitlement.Unlimited {
		return nil
	}
	limit := v
	return &limit
}

func toEntitlements(f entitlement.Features, plan string, seatsUsed int, lapsed bool) generated.Entitlements {
	return generated.Entitlements{
		Plan:         plan,
		SeatLimit:    limitOrNull(f.SeatLimit),
		SeatsUsed:    seatsUsed,
		TeamLimit:    limitOrNull(f.TeamLimit),
		HistoryDays:  limitOrNull(f.HistoryDays),
		PrivateTeams: f.PrivateTeams,
		CustomViews:  f.CustomViews,
		APIKeys:      f.APIKeys,
		Sso:          f.SSO,
		AuditLog:     f.AuditLog,
		Lapsed:       lapsed,
	}
}

// ---------------------------------------------------------------------------------- bulk

func toBulkSkips(skips []domain.BulkSkip) []generated.BulkSkip {
	// Non-null list: an empty bulk result must be `[]`, not `null`, so a caller can report
	// "nothing was skipped" without a branch.
	out := make([]generated.BulkSkip, 0, len(skips))
	for _, s := range skips {
		out = append(out, generated.BulkSkip{ID: s.ID, Reason: s.Reason})
	}
	return out
}

// There is deliberately no toIssues here, and there was one until it was deleted.
//
// It had no caller anywhere: every list of issues in the API goes through
// Resolver.hydrateIssues, which converts and then fills in the relations the query asked
// for. A bare converter beside it is an invitation to return issues with a null `state` and
// a null `team` — both non-null in the schema — from whichever call site reaches for the
// shorter name.

// ------------------------------------------------------------------------------- estimates

func toEstimateScale(v string) (generated.EstimateScale, error) {
	switch v {
	case model.EstimateScaleNone:
		return generated.EstimateScaleNone, nil
	case model.EstimateScaleExponential:
		return generated.EstimateScaleExponential, nil
	case model.EstimateScaleFibonacci:
		return generated.EstimateScaleFibonacci, nil
	case model.EstimateScaleLinear:
		return generated.EstimateScaleLinear, nil
	case model.EstimateScaleTShirt:
		return generated.EstimateScaleTshirt, nil
	}
	return "", platform.Internal(fmt.Errorf("unknown estimate scale %q", v))
}

func fromEstimateScale(s generated.EstimateScale) (string, error) {
	switch s {
	case generated.EstimateScaleNone:
		return model.EstimateScaleNone, nil
	case generated.EstimateScaleExponential:
		return model.EstimateScaleExponential, nil
	case generated.EstimateScaleFibonacci:
		return model.EstimateScaleFibonacci, nil
	case generated.EstimateScaleLinear:
		return model.EstimateScaleLinear, nil
	case generated.EstimateScaleTshirt:
		return model.EstimateScaleTShirt, nil
	}
	return "", platform.Validation("scale", "that is not an estimate scale")
}

// toDate converts a wire string to the domain's calendar day.
//
// The string is passed through unparsed: the domain validates the format, because it is the
// layer that knows the error message a user should see, and parsing here would mean two
// places that both believe they own what a date is.
func toDate(s *string) *model.Date {
	if s == nil {
		return nil
	}
	d := model.Date(*s)
	return &d
}

// fromDate is the way back out. model.Date is already the wire format — a calendar day
// written 2006-01-02, never a timestamp — so this widens the type and nothing else.
func fromDate(d *model.Date) *string {
	if d == nil {
		return nil
	}
	s := string(*d)
	return &s
}

// ------------------------------------------------------------------------------ due dates

// toDueDateSource maps the column's value onto the schema's enum.
//
// Closed, like every other enum conversion here, and this one earns it twice over. The
// schema declares `dueDateSource: DueDateSource!`, the column is NOT NULL DEFAULT 'manual',
// and the Go zero value is the empty string — so a conversion that fell through would put a
// value outside the enum on a non-null field, which gqlgen marshals happily and every
// generated client rejects at the point where it is hardest to trace back to here.
func toDueDateSource(v string) (generated.DueDateSource, error) {
	switch v {
	case model.DueDateManual:
		return generated.DueDateSourceManual, nil
	case model.DueDateSLA:
		return generated.DueDateSourceSLA, nil
	}
	return "", platform.Internal(fmt.Errorf("unknown due date source %q", v))
}
