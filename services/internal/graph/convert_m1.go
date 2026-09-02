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

func toProjectLabel(l model.ProjectLabel) generated.ProjectLabel {
	return generated.ProjectLabel{
		ID:          l.ID,
		WorkspaceID: l.WorkspaceID,
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

func toProjectLabels(labels []model.ProjectLabel) []generated.ProjectLabel {
	out := make([]generated.ProjectLabel, 0, len(labels))
	for _, l := range labels {
		out = append(out, toProjectLabel(l))
	}
	return out
}

func toProjectLabelLink(link model.ProjectLabelLink) generated.ProjectLabelLink {
	return generated.ProjectLabelLink{
		ID:          link.ID,
		WorkspaceID: link.WorkspaceID,
		ProjectID:   link.ProjectID,
		LabelID:     link.LabelID,
		GroupID:     link.GroupID,
		CreatedBy:   link.CreatedBy,
		CreatedAt:   link.CreatedAt,
	}
}

func toInitiativeLabel(l model.InitiativeLabel) generated.InitiativeLabel {
	return generated.InitiativeLabel{
		ID:          l.ID,
		WorkspaceID: l.WorkspaceID,
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

func toInitiativeLabels(labels []model.InitiativeLabel) []generated.InitiativeLabel {
	out := make([]generated.InitiativeLabel, 0, len(labels))
	for _, l := range labels {
		out = append(out, toInitiativeLabel(l))
	}
	return out
}

func toInitiativeLabelLink(link model.InitiativeLabelLink) generated.InitiativeLabelLink {
	return generated.InitiativeLabelLink{
		ID:           link.ID,
		WorkspaceID:  link.WorkspaceID,
		InitiativeID: link.InitiativeID,
		LabelID:      link.LabelID,
		GroupID:      link.GroupID,
		CreatedBy:    link.CreatedBy,
		CreatedAt:    link.CreatedAt,
	}
}

func toInitiativeRelation(rel model.InitiativeRelation) generated.InitiativeRelation {
	return generated.InitiativeRelation{
		ID:                 rel.ID,
		WorkspaceID:        rel.WorkspaceID,
		ParentInitiativeID: rel.ParentInitiativeID,
		ChildInitiativeID:  rel.ChildInitiativeID,
		SortOrder:          rel.SortOrder,
		CreatedBy:          rel.CreatedBy,
		CreatedAt:          rel.CreatedAt,
	}
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

// ----------------------------------------------------------------------------- reactions

func toReaction(r model.Reaction) generated.Reaction {
	return generated.Reaction{
		ID:          r.ID,
		WorkspaceID: r.WorkspaceID,
		CommentID:   r.CommentID,
		UserID:      r.UserID,
		Emoji:       r.Emoji,
		CreatedAt:   r.CreatedAt,
	}
}

func toReactions(rows []model.Reaction) []generated.Reaction {
	// Minted empty rather than nil: Comment.reactions is non-null, and a comment with no
	// reactions is the ordinary case rather than a failure.
	out := make([]generated.Reaction, 0, len(rows))
	for _, r := range rows {
		out = append(out, toReaction(r))
	}
	return out
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
	case model.NotifyViewIssueAdded:
		return generated.NotificationTypeViewIssueAdded, nil
	case model.NotifyViewIssueCompleted:
		return generated.NotificationTypeViewIssueCompleted, nil
	case model.NotifyPulseDigest:
		return generated.NotificationTypePulseDigest, nil
	case model.NotifyProjectIssueAdded:
		return generated.NotificationTypeProjectIssueAdded, nil
	case model.NotifyProjectIssueCompleted:
		return generated.NotificationTypeProjectIssueCompleted, nil
	case model.NotifyProjectUpdate:
		return generated.NotificationTypeProjectUpdate, nil
	case model.NotifyInitiativeIssueAdded:
		return generated.NotificationTypeInitiativeIssueAdded, nil
	case model.NotifyInitiativeIssueCompleted:
		return generated.NotificationTypeInitiativeIssueCompleted, nil
	case model.NotifyInitiativeUpdate:
		return generated.NotificationTypeInitiativeUpdate, nil
	case model.NotifyCustomerRequestAdded:
		return generated.NotificationTypeCustomerRequestAdded, nil
	case model.NotifyCustomerRequestImportant:
		return generated.NotificationTypeCustomerRequestImportant, nil
	case model.NotifyCustomerRequestCompleted:
		return generated.NotificationTypeCustomerRequestCompleted, nil
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
		ProjectID:   v.ProjectID,
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

func toViewSubscription(v model.ViewSubscription) generated.ViewSubscription {
	return generated.ViewSubscription{
		ID:          v.ID,
		WorkspaceID: v.WorkspaceID,
		ViewID:      v.ViewID,
		UserID:      v.UserID,
		Added:       v.Added,
		Completed:   v.Completed,
		CreatedAt:   v.CreatedAt,
		UpdatedAt:   v.UpdatedAt,
	}
}

func toProjectSubscription(v model.ProjectSubscription) generated.ProjectSubscription {
	return generated.ProjectSubscription{
		ID:              v.ID,
		WorkspaceID:     v.WorkspaceID,
		ProjectID:       v.ProjectID,
		UserID:          v.UserID,
		IssuesAdded:     v.IssuesAdded,
		IssuesCompleted: v.IssuesCompleted,
		Updates:         v.Updates,
		CreatedAt:       v.CreatedAt,
		UpdatedAt:       v.UpdatedAt,
	}
}

func toInitiativeSubscription(v model.InitiativeSubscription) generated.InitiativeSubscription {
	return generated.InitiativeSubscription{
		ID:              v.ID,
		WorkspaceID:     v.WorkspaceID,
		InitiativeID:    v.InitiativeID,
		UserID:          v.UserID,
		IssuesAdded:     v.IssuesAdded,
		IssuesCompleted: v.IssuesCompleted,
		Updates:         v.Updates,
		CreatedAt:       v.CreatedAt,
		UpdatedAt:       v.UpdatedAt,
	}
}

func toCustomerSubscription(v model.CustomerSubscription) generated.CustomerSubscription {
	return generated.CustomerSubscription{
		ID:               v.ID,
		WorkspaceID:      v.WorkspaceID,
		CustomerID:       v.CustomerID,
		UserID:           v.UserID,
		RequestAdded:     v.RequestAdded,
		RequestImportant: v.RequestImportant,
		RequestCompleted: v.RequestCompleted,
		CreatedAt:        v.CreatedAt,
		UpdatedAt:        v.UpdatedAt,
	}
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
		FolderID:    f.FolderID,
		Name:        f.Name,
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
	case model.FavoriteFolder:
		return generated.FavoriteKindFolder, nil
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
	case generated.FavoriteKindFolder:
		return model.FavoriteFolder, nil
	}
	return "", platform.Validation("kind", "that is not something you can favourite")
}

// -------------------------------------------------------------------------------- templates

func toIssueTemplate(t model.IssueTemplate) generated.IssueTemplate {
	return generated.IssueTemplate{
		ID:                 t.ID,
		WorkspaceID:        t.WorkspaceID,
		TeamID:             t.TeamID,
		Name:               t.Name,
		Description:        t.Description,
		Title:              t.Title,
		Body:               t.Body,
		Properties:         jsonOrEmptyObject(t.Properties),
		SubIssues:          toTemplateSubIssues(t.SubIssues),
		Position:           t.Position,
		CreatedBy:          t.CreatedBy,
		CreatedAt:          t.CreatedAt,
		UpdatedAt:          t.UpdatedAt,
		ArchivedAt:         t.ArchivedAt,
		EmailIntakeEnabled: t.EmailIntakeEnabled,
		EmailIntakeAddress: t.EmailIntakeAddress,
	}
}

func toIssueTemplates(rows []model.IssueTemplate) []generated.IssueTemplate {
	out := make([]generated.IssueTemplate, 0, len(rows))
	for _, t := range rows {
		out = append(out, toIssueTemplate(t))
	}
	return out
}

func toTemplateSubIssues(items []model.TemplateSubIssue) []generated.TemplateSubIssue {
	if items == nil {
		return []generated.TemplateSubIssue{}
	}
	out := make([]generated.TemplateSubIssue, len(items))
	for i, item := range items {
		out[i] = generated.TemplateSubIssue{Title: item.Title}
	}
	return out
}

func templateSubIssuesFromInput(items []generated.TemplateSubIssueInput) []model.TemplateSubIssue {
	out := make([]model.TemplateSubIssue, len(items))
	for i, item := range items {
		out[i] = model.TemplateSubIssue{Title: item.Title}
	}
	return out
}

func toFormTemplate(t model.FormTemplate) generated.FormTemplate {
	return generated.FormTemplate{
		ID:          t.ID,
		WorkspaceID: t.WorkspaceID,
		TeamID:      t.TeamID,
		Name:        t.Name,
		Description: t.Description,
		Properties:  jsonOrEmptyObject(t.Properties),
		Position:    t.Position,
		CreatedBy:   t.CreatedBy,
		CreatedAt:   t.CreatedAt,
		UpdatedAt:   t.UpdatedAt,
		ArchivedAt:  t.ArchivedAt,
	}
}

func toFormTemplates(rows []model.FormTemplate) []generated.FormTemplate {
	out := make([]generated.FormTemplate, 0, len(rows))
	for _, t := range rows {
		out = append(out, toFormTemplate(t))
	}
	return out
}

func toFormTemplateField(f model.FormTemplateField) generated.FormTemplateField {
	return generated.FormTemplateField{
		ID:             f.ID,
		WorkspaceID:    f.WorkspaceID,
		FormTemplateID: f.FormTemplateID,
		FieldType:      generated.FormTemplateFieldType(f.FieldType),
		Label:          f.Label,
		Description:    f.Description,
		Required:       f.Required,
		SortOrder:      f.SortOrder,
		Config:         jsonOrEmptyObject(f.Config),
		CreatedAt:      f.CreatedAt,
		UpdatedAt:      f.UpdatedAt,
	}
}

func toFormTemplateFields(rows []model.FormTemplateField) []generated.FormTemplateField {
	out := make([]generated.FormTemplateField, 0, len(rows))
	for _, f := range rows {
		out = append(out, toFormTemplateField(f))
	}
	return out
}

func toProjectTemplate(t model.ProjectTemplate) generated.ProjectTemplate {
	return generated.ProjectTemplate{
		ID:          t.ID,
		WorkspaceID: t.WorkspaceID,
		TeamID:      t.TeamID,
		Name:        t.Name,
		Description: t.Description,
		Summary:     t.Summary,
		Body:        t.Body,
		Properties:  jsonOrEmptyObject(t.Properties),
		Position:    t.Position,
		CreatedBy:   t.CreatedBy,
		CreatedAt:   t.CreatedAt,
		UpdatedAt:   t.UpdatedAt,
		ArchivedAt:  t.ArchivedAt,
	}
}

func toProjectTemplates(rows []model.ProjectTemplate) []generated.ProjectTemplate {
	out := make([]generated.ProjectTemplate, 0, len(rows))
	for _, t := range rows {
		out = append(out, toProjectTemplate(t))
	}
	return out
}

func toProjectTemplateMilestone(m model.ProjectTemplateMilestone) generated.ProjectTemplateMilestone {
	return generated.ProjectTemplateMilestone{
		ID:                m.ID,
		WorkspaceID:       m.WorkspaceID,
		ProjectTemplateID: m.ProjectTemplateID,
		Name:              m.Name,
		Description:       m.Description,
		TargetDate:        fromDate(m.TargetDate),
		SortOrder:         m.SortOrder,
		CreatedAt:         m.CreatedAt,
		UpdatedAt:         m.UpdatedAt,
	}
}

func toProjectTemplateMilestones(rows []model.ProjectTemplateMilestone) []generated.ProjectTemplateMilestone {
	out := make([]generated.ProjectTemplateMilestone, 0, len(rows))
	for _, m := range rows {
		out = append(out, toProjectTemplateMilestone(m))
	}
	return out
}

func toProjectTemplateIssue(i model.ProjectTemplateIssue) generated.ProjectTemplateIssue {
	return generated.ProjectTemplateIssue{
		ID:                i.ID,
		WorkspaceID:       i.WorkspaceID,
		ProjectTemplateID: i.ProjectTemplateID,
		ParentID:          i.ParentID,
		Title:             i.Title,
		Description:       i.Description,
		Properties:        jsonOrEmptyObject(i.Properties),
		SortOrder:         i.SortOrder,
		CreatedAt:         i.CreatedAt,
		UpdatedAt:         i.UpdatedAt,
	}
}

func toProjectTemplateIssues(rows []model.ProjectTemplateIssue) []generated.ProjectTemplateIssue {
	out := make([]generated.ProjectTemplateIssue, 0, len(rows))
	for _, i := range rows {
		out = append(out, toProjectTemplateIssue(i))
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

// ----------------------------------------------------------------------------- audit log

// A straight field-for-field copy: the model shape was designed against this schema type,
// and the audit log has no enum to case-convert and no id to rewrite. Kept explicit rather
// than done by reflection for the reason every converter here is — a field added to one
// side and not the other should be a compile error, not a silently absent value.
func toAuditLogEntry(e model.AuditLogEntry) generated.AuditLogEntry {
	return generated.AuditLogEntry{
		ID:          e.ID,
		ActorUserID: e.ActorUserID,
		ActorType:   e.ActorType,
		ActorLabel:  e.ActorLabel,
		Action:      e.Action,
		TargetType:  e.TargetType,
		TargetID:    e.TargetID,
		TargetLabel: e.TargetLabel,
		Before:      e.Before,
		After:       e.After,
		IP:          e.IP,
		UserAgent:   e.UserAgent,
		CreatedAt:   e.CreatedAt,
	}
}

func toAuditLogEntries(rows []model.AuditLogEntry) []generated.AuditLogEntry {
	out := make([]generated.AuditLogEntry, 0, len(rows))
	for _, e := range rows {
		out = append(out, toAuditLogEntry(e))
	}
	return out
}

// --------------------------------------------------------------------------------- oauth

func toOauthClient(c model.OauthClient) generated.OauthClient {
	return generated.OauthClient{
		ID:                       c.ID,
		WorkspaceID:              c.WorkspaceID,
		CreatorID:                c.CreatorID,
		ClientID:                 c.ClientID,
		Name:                     c.Name,
		Description:              c.Description,
		Developer:                c.Developer,
		DeveloperURL:             c.DeveloperURL,
		ImageURL:                 c.ImageURL,
		RedirectUris:             c.RedirectURIs,
		AllowedScopes:            c.AllowedScopes,
		PublicEnabled:            c.PublicEnabled,
		ClientCredentialsEnabled: c.ClientCredentialsEnabled,
		WebhookURL:               c.WebhookURL,
		CreatedAt:                c.CreatedAt,
		UpdatedAt:                c.UpdatedAt,
		ArchivedAt:               c.ArchivedAt,
	}
}

func toOauthClients(rows []model.OauthClient) []generated.OauthClient {
	out := make([]generated.OauthClient, 0, len(rows))
	for _, c := range rows {
		out = append(out, toOauthClient(c))
	}
	return out
}

func toOauthClientInfo(c model.OauthClientInfo) generated.OauthClientInfo {
	return generated.OauthClientInfo{
		ClientID:      c.ClientID,
		Name:          c.Name,
		Description:   c.Description,
		Developer:     c.Developer,
		DeveloperURL:  c.DeveloperURL,
		ImageURL:      c.ImageURL,
		AllowedScopes: c.AllowedScopes,
	}
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
		Plan:               plan,
		SeatLimit:          limitOrNull(f.SeatLimit),
		SeatsUsed:          seatsUsed,
		TeamLimit:          limitOrNull(f.TeamLimit),
		HistoryDays:        limitOrNull(f.HistoryDays),
		PrivateTeams:       f.PrivateTeams,
		SubTeams:           f.SubTeams,
		MultiLevelSubTeams: f.MultiLevelSubTeams,
		CustomViews:        f.CustomViews,
		APIKeys:            f.APIKeys,
		Sso:                f.SSO,
		AuditLog:           f.AuditLog,
		Slas:               f.SLAs,
		Slack:              f.Slack,
		Lapsed:             lapsed,
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
