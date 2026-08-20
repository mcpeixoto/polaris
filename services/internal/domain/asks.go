package domain

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

const (
	maxAskFormNameLength = 256
	askFormTokenBytes    = 16
)

type CreateAskFormInput struct {
	TeamID      uuid.UUID
	Name        string
	Description string
}

type UpdateAskFormInput struct {
	ID          uuid.UUID
	Name        *string
	Description *string
}

type SubmitAskInput struct {
	Token          string
	Title          string
	Description    string
	RequesterName  string
	RequesterEmail string
}

// PublicAskForm is the unsigned-in page: a name, a blurb, and which team it files into.
// The token is already in the URL; it is not repeated here.
type PublicAskForm struct {
	Name        string
	Description string
	TeamName    string
}

func (s *Service) CreateAskForm(
	ctx context.Context, p *authz.Principal, in CreateAskFormInput,
) (model.AskForm, int64, error) {
	if p.IsGuest() {
		return model.AskForm{}, 0, platform.Forbidden("askForm")
	}
	name, err := askFormName(in.Name)
	if err != nil {
		return model.AskForm{}, 0, err
	}

	var out model.AskForm
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		team, err := s.requireTeamAccess(ctx, q, p, in.TeamID, authz.ActionTeamUpdate)
		if err != nil {
			return err
		}
		token, err := mintAskFormToken()
		if err != nil {
			return err
		}
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		creator := p.UserID
		row, err := q.CreateAskForm(ctx, store.CreateAskFormParams{
			ID:          id,
			WorkspaceID: p.WorkspaceID,
			TeamID:      team.ID,
			Name:        name,
			Description: strings.TrimSpace(in.Description),
			Token:       token,
			CreatorID:   &creator,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toAskForm(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "askForm", EntityID: id, Op: OpUpsert,
			TeamID: &team.ID, Scope: authz.TeamScope(team.ID, team.Private), Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) UpdateAskForm(
	ctx context.Context, p *authz.Principal, in UpdateAskFormInput,
) (model.AskForm, int64, error) {
	if p.IsGuest() {
		return model.AskForm{}, 0, platform.Forbidden("askForm")
	}
	var name *string
	if in.Name != nil {
		n, err := askFormName(*in.Name)
		if err != nil {
			return model.AskForm{}, 0, err
		}
		name = &n
	}

	var out model.AskForm
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, team, err := s.requireAskFormWrite(ctx, q, p, in.ID)
		if err != nil {
			return err
		}
		row, err := q.UpdateAskForm(ctx, store.UpdateAskFormParams{
			ID:          existing.ID,
			Name:        name,
			Description: in.Description,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("askForm")
			}
			return platform.Internal(err)
		}
		out = toAskForm(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "askForm", EntityID: out.ID, Op: OpUpsert,
			TeamID: &team.ID, Scope: authz.TeamScope(team.ID, team.Private), Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) ArchiveAskForm(
	ctx context.Context, p *authz.Principal, id uuid.UUID, archived bool,
) (int64, error) {
	if p.IsGuest() {
		return 0, platform.Forbidden("askForm")
	}
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, team, err := s.requireAskFormWrite(ctx, q, p, id)
		if err != nil {
			return err
		}
		scope := authz.TeamScope(team.ID, team.Private)
		if archived {
			if err := q.ArchiveAskForm(ctx, existing.ID); err != nil {
				return platform.Internal(err)
			}
			version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
				EntityType: "askForm", EntityID: id, Op: OpDelete,
				TeamID: &team.ID, Scope: scope,
			})
			return err
		}
		row, err := q.UnarchiveAskForm(ctx, existing.ID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("askForm")
			}
			return platform.Internal(err)
		}
		out := toAskForm(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "askForm", EntityID: id, Op: OpUpsert,
			TeamID: &team.ID, Scope: scope, Payload: out,
		})
		return err
	})
	return version, err
}

func (s *Service) DeleteAskForm(
	ctx context.Context, p *authz.Principal, id uuid.UUID,
) (int64, error) {
	if p.IsGuest() {
		return 0, platform.Forbidden("askForm")
	}
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, team, err := s.requireAskFormWrite(ctx, q, p, id)
		if err != nil {
			return err
		}
		if _, err := q.SoftDeleteAskForm(ctx, existing.ID); err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("askForm")
			}
			return platform.Internal(err)
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "askForm", EntityID: id, Op: OpDelete,
			TeamID: &team.ID, Scope: authz.TeamScope(team.ID, team.Private),
		})
		return err
	})
	return version, err
}

func (s *Service) GetPublicAskForm(ctx context.Context, token string) (PublicAskForm, error) {
	row, err := s.lookupLiveAskForm(ctx, token)
	if err != nil {
		return PublicAskForm{}, err
	}
	team, err := s.db.Queries().GetTeam(ctx, row.TeamID)
	if err != nil {
		if store.IsNotFound(err) {
			return PublicAskForm{}, platform.NotFound("askForm")
		}
		return PublicAskForm{}, platform.Internal(err)
	}
	return PublicAskForm{
		Name:        row.Name,
		Description: row.Description,
		TeamName:    team.Name,
	}, nil
}

func (s *Service) SubmitAsk(ctx context.Context, in SubmitAskInput) error {
	row, err := s.lookupLiveAskForm(ctx, in.Token)
	if err != nil {
		return err
	}

	title := strings.TrimSpace(in.Title)
	if title == "" {
		return platform.Validation("title", "an issue needs a title")
	}
	if utf8.RuneCountInString(title) > maxTitleLength {
		return platform.Validation("title", "title is too long")
	}

	name := strings.TrimSpace(in.RequesterName)
	email := strings.TrimSpace(in.RequesterEmail)
	if name == "" {
		return platform.Validation("requesterName", "a name is required")
	}
	if email == "" || !strings.Contains(email, "@") {
		return platform.Validation("requesterEmail", "an email address is required")
	}

	body := strings.TrimSpace(in.Description)
	if utf8.RuneCountInString(body) > maxDescriptionLength {
		return platform.Validation("description", "description is too long")
	}

	var b strings.Builder
	fmt.Fprintf(&b, "Submitted by %s <%s> via Asks.\n", name, email)
	if body != "" {
		b.WriteString("\n")
		b.WriteString(body)
	}

	p := askIntakePrincipal(row.WorkspaceID, row.TeamID)
	_, _, err = s.CreateIssue(ctx, p, CreateIssueInput{
		TeamID:              row.TeamID,
		Title:               title,
		Description:         b.String(),
		SkipDefaultTemplate: true,
	})
	return err
}

func (s *Service) lookupLiveAskForm(ctx context.Context, token string) (store.AskForm, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return store.AskForm{}, platform.NotFound("askForm")
	}
	row, err := s.db.Queries().GetAskFormByToken(ctx, token)
	if err != nil {
		if store.IsNotFound(err) {
			return store.AskForm{}, platform.NotFound("askForm")
		}
		return store.AskForm{}, platform.Internal(err)
	}
	return row, nil
}

func (s *Service) requireAskFormWrite(
	ctx context.Context, q *store.Queries, p *authz.Principal, id uuid.UUID,
) (store.AskForm, store.Team, error) {
	row, err := q.GetAskFormForUpdate(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return store.AskForm{}, store.Team{}, platform.NotFound("askForm")
		}
		return store.AskForm{}, store.Team{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID || row.DeletedAt != nil {
		return store.AskForm{}, store.Team{}, platform.NotFound("askForm")
	}
	team, err := s.requireTeamAccess(ctx, q, p, row.TeamID, authz.ActionTeamUpdate)
	if err != nil {
		return store.AskForm{}, store.Team{}, err
	}
	return row, team, nil
}

func askFormName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", platform.Validation("name", "a form needs a name")
	}
	if utf8.RuneCountInString(name) > maxAskFormNameLength {
		return "", platform.Validation("name", "name is too long")
	}
	return name, nil
}

func mintAskFormToken() (string, error) {
	var raw [askFormTokenBytes]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", platform.Internal(err)
	}
	return hex.EncodeToString(raw[:]), nil
}

func askIntakePrincipal(workspaceID, teamID uuid.UUID) *authz.Principal {
	return &authz.Principal{
		WorkspaceID: workspaceID,
		Role:        authz.RoleMember,
		Teams:       authz.NewTeamSet(teamID),
	}
}

func toAskForm(row store.AskForm) model.AskForm {
	return model.AskForm{
		ID:          row.ID,
		WorkspaceID: row.WorkspaceID,
		TeamID:      row.TeamID,
		Name:        row.Name,
		Description: row.Description,
		Token:       row.Token,
		CreatorID:   row.CreatorID,
		ArchivedAt:  row.ArchivedAt,
		DeletedAt:   row.DeletedAt,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
}
