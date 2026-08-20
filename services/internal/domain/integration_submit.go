package domain

import (
	"context"
	"net/url"
	"strings"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

const (
	integrationNameMax    = 80
	integrationWebsiteMax = 500
	integrationSummaryMax = 280
)

type SubmitIntegrationInput struct {
	Name    string
	Website string
	Summary string
}

func (s *Service) SubmitIntegration(
	ctx context.Context, p *authz.Principal, in SubmitIntegrationInput,
) (model.IntegrationSubmission, error) {
	if p.Role == authz.RoleGuest {
		return model.IntegrationSubmission{}, platform.Forbidden("guests cannot submit integrations")
	}

	name := strings.TrimSpace(in.Name)
	if name == "" {
		return model.IntegrationSubmission{}, platform.Validation("name", "an integration needs a name")
	}
	if len(name) > integrationNameMax {
		return model.IntegrationSubmission{}, platform.Validation("name", "that name is too long")
	}

	website, err := normaliseIntegrationWebsite(in.Website)
	if err != nil {
		return model.IntegrationSubmission{}, err
	}

	summary := strings.TrimSpace(in.Summary)
	if summary == "" {
		return model.IntegrationSubmission{}, platform.Validation("summary", "say what the integration does")
	}
	if len(summary) > integrationSummaryMax {
		return model.IntegrationSubmission{}, platform.Validation("summary", "that summary is too long")
	}

	id, err := uuid.NewV7()
	if err != nil {
		return model.IntegrationSubmission{}, platform.Internal(err)
	}

	row, err := s.db.Queries().CreateIntegrationSubmission(ctx, store.CreateIntegrationSubmissionParams{
		ID:          id,
		WorkspaceID: p.WorkspaceID,
		SubmittedBy: p.UserID,
		Name:        name,
		Website:     website,
		Summary:     summary,
	})
	if err != nil {
		return model.IntegrationSubmission{}, platform.Internal(err)
	}
	return toIntegrationSubmission(row), nil
}

func (s *Service) ListIntegrationSubmissions(
	ctx context.Context, p *authz.Principal,
) ([]model.IntegrationSubmission, error) {
	if p.Role == authz.RoleGuest {
		return nil, platform.Forbidden("guests cannot list integration submissions")
	}
	rows, err := s.db.Queries().ListIntegrationSubmissions(ctx, p.WorkspaceID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.IntegrationSubmission, 0, len(rows))
	for _, row := range rows {
		out = append(out, toIntegrationSubmission(row))
	}
	return out, nil
}

func normaliseIntegrationWebsite(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", platform.Validation("website", "an integration needs a website")
	}
	if len(s) > integrationWebsiteMax {
		return "", platform.Validation("website", "that URL is too long")
	}
	u, err := url.Parse(s)
	if err != nil || u.Host == "" {
		return "", platform.Validation("website", "that is not a website URL")
	}
	if u.Scheme != "https" {
		return "", platform.Validation("website", "the website must be https")
	}
	return s, nil
}

func toIntegrationSubmission(r store.IntegrationSubmission) model.IntegrationSubmission {
	return model.IntegrationSubmission{
		ID: r.ID, WorkspaceID: r.WorkspaceID, SubmittedBy: r.SubmittedBy,
		Name: r.Name, Website: r.Website, Summary: r.Summary,
		CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}
