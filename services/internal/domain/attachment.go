package domain

import (
	"context"
	"encoding/json"
	"net/url"
	"strings"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

const (
	maxAttachmentURL      = 2048
	maxAttachmentTitle    = 512
	maxAttachmentSubtitle = 1024
)

type CreateAttachmentInput struct {
	IssueID  uuid.UUID
	URL      string
	Title    string
	Subtitle *string
	IconURL  *string
	Metadata json.RawMessage
}

type UpdateAttachmentInput struct {
	ID       uuid.UUID
	Title    *string
	Subtitle *string
	IconURL  *string
	Metadata json.RawMessage
}

// CreateAttachment puts a link card on an issue. The URL is unique per issue: posting
// the same URL again updates the existing card rather than minting a second one, which
// is what lets an integration stay stateless.
func (s *Service) CreateAttachment(ctx context.Context, p *authz.Principal, in CreateAttachmentInput) (model.Attachment, int64, error) {
	parsed, err := parseAttachmentURL(in.URL)
	if err != nil {
		return model.Attachment{}, 0, err
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = parsed.Host
	}
	if len(title) > maxAttachmentTitle {
		return model.Attachment{}, 0, platform.Validation("title", "that title is too long")
	}
	subtitle, err := optionalText(in.Subtitle, maxAttachmentSubtitle, "subtitle")
	if err != nil {
		return model.Attachment{}, 0, err
	}
	iconURL, err := optionalURL(in.IconURL, "iconUrl")
	if err != nil {
		return model.Attachment{}, 0, err
	}
	meta, err := attachmentMetadata(in.Metadata)
	if err != nil {
		return model.Attachment{}, 0, err
	}

	var out model.Attachment
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		issue, err := q.GetIssue(ctx, in.IssueID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("issue")
			}
			return platform.Internal(err)
		}
		team, err := s.requireTeamAccess(ctx, q, p, issue.TeamID, authz.ActionIssueUpdate)
		if err != nil {
			return err
		}

		existing, err := q.GetAttachmentByIssueURL(ctx, store.GetAttachmentByIssueURLParams{
			IssueID: in.IssueID,
			Url:     parsed.String(),
		})
		if err != nil && !store.IsNotFound(err) {
			return platform.Internal(err)
		}
		if err == nil {
			row, err := q.UpdateAttachment(ctx, store.UpdateAttachmentParams{
				ID:       existing.ID,
				Title:    title,
				Subtitle: subtitle,
				IconUrl:  iconURL,
				Metadata: meta,
			})
			if err != nil {
				return platform.Internal(err)
			}
			out = toAttachment(row)
			version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
				EntityType: "attachment", EntityID: existing.ID, Op: OpUpsert, TeamID: &issue.TeamID,
				Scope: authz.TeamScope(issue.TeamID, team.Private), Payload: out,
				ChangedFields: []string{"title", "subtitle", "iconUrl", "metadata"},
			})
			return err
		}

		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		creator := p.UserID
		row, err := q.CreateAttachment(ctx, store.CreateAttachmentParams{
			ID:          id,
			WorkspaceID: p.WorkspaceID,
			IssueID:     in.IssueID,
			TeamID:      issue.TeamID,
			Url:         parsed.String(),
			Title:       title,
			Subtitle:    subtitle,
			IconUrl:     iconURL,
			Metadata:    meta,
			CreatorID:   &creator,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toAttachment(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "attachment", EntityID: id, Op: OpUpsert, TeamID: &issue.TeamID,
			Scope: authz.TeamScope(issue.TeamID, team.Private), Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) UpdateAttachment(ctx context.Context, p *authz.Principal, in UpdateAttachmentInput) (model.Attachment, int64, error) {
	var out model.Attachment
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := q.GetAttachment(ctx, in.ID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("attachment")
			}
			return platform.Internal(err)
		}
		issue, err := q.GetIssue(ctx, existing.IssueID)
		if err != nil {
			return platform.Internal(err)
		}
		team, err := s.requireTeamAccess(ctx, q, p, issue.TeamID, authz.ActionIssueUpdate)
		if err != nil {
			return err
		}

		title := existing.Title
		if in.Title != nil {
			title = strings.TrimSpace(*in.Title)
			if title == "" {
				return platform.Validation("title", "a link needs a title")
			}
			if len(title) > maxAttachmentTitle {
				return platform.Validation("title", "that title is too long")
			}
		}
		subtitle := existing.Subtitle
		if in.Subtitle != nil {
			subtitle, err = optionalText(in.Subtitle, maxAttachmentSubtitle, "subtitle")
			if err != nil {
				return err
			}
		}
		iconURL := existing.IconUrl
		if in.IconURL != nil {
			iconURL, err = optionalURL(in.IconURL, "iconUrl")
			if err != nil {
				return err
			}
		}
		meta := existing.Metadata
		if len(in.Metadata) > 0 {
			meta, err = attachmentMetadata(in.Metadata)
			if err != nil {
				return err
			}
		}

		row, err := q.UpdateAttachment(ctx, store.UpdateAttachmentParams{
			ID:       existing.ID,
			Title:    title,
			Subtitle: subtitle,
			IconUrl:  iconURL,
			Metadata: meta,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toAttachment(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "attachment", EntityID: existing.ID, Op: OpUpsert, TeamID: &issue.TeamID,
			Scope: authz.TeamScope(issue.TeamID, team.Private), Payload: out,
			ChangedFields: []string{"title", "subtitle", "iconUrl", "metadata"},
		})
		return err
	})
	return out, version, err
}

func (s *Service) DeleteAttachment(ctx context.Context, p *authz.Principal, id uuid.UUID) (int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := q.GetAttachment(ctx, id)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("attachment")
			}
			return platform.Internal(err)
		}
		issue, err := q.GetIssue(ctx, existing.IssueID)
		if err != nil {
			return platform.Internal(err)
		}
		team, err := s.requireTeamAccess(ctx, q, p, issue.TeamID, authz.ActionIssueUpdate)
		if err != nil {
			return err
		}
		if err := q.DeleteAttachment(ctx, id); err != nil {
			return platform.Internal(err)
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "attachment", EntityID: id, Op: OpDelete, TeamID: &issue.TeamID,
			Scope: authz.TeamScope(issue.TeamID, team.Private),
		})
		return err
	})
	return version, err
}

func (s *Service) ListAttachments(ctx context.Context, p *authz.Principal, issueID uuid.UUID) ([]model.Attachment, error) {
	q := s.db.Queries()
	issue, err := q.GetIssue(ctx, issueID)
	if err != nil {
		if store.IsNotFound(err) {
			return nil, platform.NotFound("issue")
		}
		return nil, platform.Internal(err)
	}
	team, err := q.GetTeam(ctx, issue.TeamID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	if !authz.Visible(p, authz.TeamScope(issue.TeamID, team.Private)) {
		return nil, platform.NotFound("issue")
	}
	rows, err := q.ListAttachmentsForIssue(ctx, issueID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.Attachment, 0, len(rows))
	for _, r := range rows {
		out = append(out, toAttachment(r))
	}
	return out, nil
}

// ListAttachmentsForURL is the integration lookup: every live issue in this workspace
// that already carries this exact URL. Private-team rows the caller cannot see are omitted.
func (s *Service) ListAttachmentsForURL(ctx context.Context, p *authz.Principal, raw string) ([]model.Attachment, error) {
	parsed, err := parseAttachmentURL(raw)
	if err != nil {
		return nil, err
	}
	q := s.db.Queries()
	rows, err := q.ListAttachmentsForURL(ctx, store.ListAttachmentsForURLParams{
		WorkspaceID: p.WorkspaceID,
		Url:         parsed.String(),
	})
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.Attachment, 0, len(rows))
	for _, r := range rows {
		team, err := q.GetTeam(ctx, r.TeamID)
		if err != nil {
			return nil, platform.Internal(err)
		}
		if !authz.Visible(p, authz.TeamScope(r.TeamID, team.Private)) {
			continue
		}
		out = append(out, toAttachment(r))
	}
	return out, nil
}

func parseAttachmentURL(raw string) (*url.URL, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, platform.Validation("url", "a link needs a URL")
	}
	if len(trimmed) > maxAttachmentURL {
		return nil, platform.Validation("url", "that URL is too long")
	}
	u, err := url.Parse(trimmed)
	if err != nil || u.Host == "" {
		return nil, platform.Validation("url", "that is not a URL")
	}
	switch strings.ToLower(u.Scheme) {
	case "http", "https":
	default:
		return nil, platform.Validation("url", "a link has to be http or https")
	}
	u.Scheme = strings.ToLower(u.Scheme)
	u.Host = strings.ToLower(u.Host)
	return u, nil
}

func optionalText(v *string, max int, field string) (*string, error) {
	if v == nil {
		return nil, nil
	}
	s := strings.TrimSpace(*v)
	if s == "" {
		return nil, nil
	}
	if len(s) > max {
		return nil, platform.Validation(field, "that "+field+" is too long")
	}
	return &s, nil
}

func optionalURL(v *string, field string) (*string, error) {
	if v == nil {
		return nil, nil
	}
	s := strings.TrimSpace(*v)
	if s == "" {
		return nil, nil
	}
	u, err := parseAttachmentURL(s)
	if err != nil {
		return nil, platform.Validation(field, "that is not a URL")
	}
	out := u.String()
	return &out, nil
}

func attachmentMetadata(raw json.RawMessage) (json.RawMessage, error) {
	if len(raw) == 0 {
		return json.RawMessage(`{}`), nil
	}
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil {
		return nil, platform.Validation("metadata", "metadata has to be a JSON object")
	}
	b, err := json.Marshal(obj)
	if err != nil {
		return nil, platform.Internal(err)
	}
	return b, nil
}

// moveAttachmentsOnDuplicate relocates every link on the duplicate onto the canonical
// issue. A URL the canonical already has is dropped rather than duplicated — the
// idempotency rule still holds after a merge.
func (s *Service) moveAttachmentsOnDuplicate(
	ctx context.Context, q *store.Queries,
	from, to store.GetIssueRow, private bool,
) ([]Change, error) {
	rows, err := q.ListAttachmentsForIssue(ctx, from.ID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	scope := authz.TeamScope(to.TeamID, private)
	var changes []Change
	for _, row := range rows {
		_, err := q.GetAttachmentByIssueURL(ctx, store.GetAttachmentByIssueURLParams{
			IssueID: to.ID,
			Url:     row.Url,
		})
		if err == nil {
			if err := q.DeleteAttachment(ctx, row.ID); err != nil {
				return nil, platform.Internal(err)
			}
			changes = append(changes, Change{
				EntityType: "attachment", EntityID: row.ID, Op: OpDelete, TeamID: &from.TeamID,
				Scope: authz.TeamScope(from.TeamID, private),
			})
			continue
		}
		if !store.IsNotFound(err) {
			return nil, platform.Internal(err)
		}
		moved, err := q.RelocateAttachment(ctx, store.RelocateAttachmentParams{
			ID:      row.ID,
			IssueID: to.ID,
			TeamID:  to.TeamID,
		})
		if err != nil {
			return nil, platform.Internal(err)
		}
		out := toAttachment(moved)
		changes = append(changes, Change{
			EntityType: "attachment", EntityID: row.ID, Op: OpUpsert, TeamID: &to.TeamID,
			Scope: scope, Payload: out, ChangedFields: []string{"issueId", "teamId"},
		})
	}
	return changes, nil
}
