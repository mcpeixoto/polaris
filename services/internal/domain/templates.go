package domain

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/fractional"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

const maxTemplateNameLength = 256

type CreateIssueTemplateInput struct {
	// TeamID confines the template to one team. Nil offers it in every team, which is why
	// nil is the admin case.
	TeamID *uuid.UUID

	Name        string
	Description *string

	// Title and Body prefill the issue. Both are optional: a template that fills in nothing
	// but a set of properties — a team, an assignee, three labels — is a legitimate thing
	// to want, and the column defaults to empty for exactly that.
	Title *string
	Body  *string

	// Properties keys are the same names the create mutation takes.
	Properties json.RawMessage

	// SubIssues are children filed with the issue. Empty means a parent only.
	SubIssues []model.TemplateSubIssue
}

// CreateIssueTemplate saves a prefilled issue.
//
// The scope split is the same one views use, minus the personal case: issue_template has
// no owner column, because a template exists to be offered to somebody in the create
// dialog and a template only its author can see is a draft, not a template.
func (s *Service) CreateIssueTemplate(
	ctx context.Context, p *authz.Principal, in CreateIssueTemplateInput,
) (model.IssueTemplate, int64, error) {
	name, err := templateName(in.Name)
	if err != nil {
		return model.IssueTemplate{}, 0, err
	}
	if err := validateTemplateContent(in.Title, in.Body); err != nil {
		return model.IssueTemplate{}, 0, err
	}
	propertiesJSON, err := jsonObject("properties", in.Properties)
	if err != nil {
		return model.IssueTemplate{}, 0, err
	}
	subIssues, err := normalizeSubIssues(in.SubIssues)
	if err != nil {
		return model.IssueTemplate{}, 0, err
	}
	subIssuesJSON, err := encodeSubIssues(subIssues)
	if err != nil {
		return model.IssueTemplate{}, 0, err
	}

	var out model.IssueTemplate
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		scope, err := s.requireTemplateScope(ctx, q, p, in.TeamID)
		if err != nil {
			return err
		}

		pos, err := nextTemplatePosition(ctx, q, p.WorkspaceID)
		if err != nil {
			return err
		}
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}

		row, err := q.CreateIssueTemplate(ctx, store.CreateIssueTemplateParams{
			ID:          id,
			WorkspaceID: p.WorkspaceID,
			TeamID:      in.TeamID,
			Name:        name,
			Description: in.Description,
			Title:       in.Title,
			Body:        in.Body,
			Properties:  propertiesJSON,
			SubIssues:   subIssuesJSON,
			Position:    pos,
			CreatedBy:   &p.UserID,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toIssueTemplate(store.GetIssueTemplateRow(row))

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "issueTemplate", EntityID: out.ID, Op: OpUpsert,
			TeamID: scopeTeamID(scope, out.TeamID), Scope: scope, Payload: out,
		})
		return err
	})
	return out, version, err
}

// UpdateIssueTemplateInput carries no team id, for the reason UpdateViewInput carries none:
// moving a template between a team and the workspace changes who can see it, and that needs
// the people who lose it to be told, not a COALESCE.
type UpdateIssueTemplateInput struct {
	ID          uuid.UUID
	Name        *string
	Description *string
	Title       *string
	Body        *string
	Properties  json.RawMessage
	// SubIssues replaces the stored list when non-nil, including an empty list.
	SubIssues *[]model.TemplateSubIssue
}

func (s *Service) UpdateIssueTemplate(
	ctx context.Context, p *authz.Principal, in UpdateIssueTemplateInput,
) (model.IssueTemplate, int64, error) {
	var name *string
	if in.Name != nil {
		n, err := templateName(*in.Name)
		if err != nil {
			return model.IssueTemplate{}, 0, err
		}
		name = &n
	}
	if err := validateTemplateContent(in.Title, in.Body); err != nil {
		return model.IssueTemplate{}, 0, err
	}
	var propertiesJSON json.RawMessage
	if !isAbsentJSON(in.Properties) {
		props, err := jsonObject("properties", in.Properties)
		if err != nil {
			return model.IssueTemplate{}, 0, err
		}
		propertiesJSON = props
	}
	var subIssuesJSON json.RawMessage
	if in.SubIssues != nil {
		items, err := normalizeSubIssues(*in.SubIssues)
		if err != nil {
			return model.IssueTemplate{}, 0, err
		}
		encoded, err := encodeSubIssues(items)
		if err != nil {
			return model.IssueTemplate{}, 0, err
		}
		subIssuesJSON = encoded
	}

	var out model.IssueTemplate
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		before, err := s.requireTemplateAccess(ctx, q, p, in.ID)
		if err != nil {
			return err
		}
		scope, err := s.requireTemplateScope(ctx, q, p, before.TeamID)
		if err != nil {
			return err
		}

		row, err := q.UpdateIssueTemplate(ctx, store.UpdateIssueTemplateParams{
			ID:          in.ID,
			Name:        name,
			Description: in.Description,
			Title:       in.Title,
			Body:        in.Body,
			Properties:  propertiesJSON,
			SubIssues:   subIssuesJSON,
		})
		if err != nil {
			if store.IsNotFound(err) {
				// Archived between the read above and this write.
				return platform.NotFound("template")
			}
			return platform.Internal(err)
		}
		out = toIssueTemplate(store.GetIssueTemplateRow(row))

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "issueTemplate", EntityID: out.ID, Op: OpUpsert,
			TeamID: scopeTeamID(scope, out.TeamID), Scope: scope, Payload: out,
		})
		return err
	})
	return out, version, err
}

// ArchiveIssueTemplate retires a template, or brings one back. There is no delete:
// issue.template_id points at this row, and the question that column exists to answer — is
// this template still worth having — needs the template to still be there after somebody
// retires it.
//
// The change is an OpDelete all the same. A retired template must not go on being offered
// in the create dialog, and the client's copy is what that dialog reads. Un-archiving is
// therefore an upsert carrying the whole row, because that copy is gone.
//
// Nothing else stands in the way of the return trip. A template has no group to be filed
// under and no unique index on its name, so unlike a label or a status it cannot come back
// to find its place taken.
func (s *Service) ArchiveIssueTemplate(
	ctx context.Context, p *authz.Principal, id uuid.UUID, archived bool,
) (uuid.UUID, int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		before, err := s.loadTemplateForArchive(ctx, q, p, id, archived)
		if err != nil {
			return err
		}
		scope, err := s.requireTemplateScope(ctx, q, p, before.TeamID)
		if err != nil {
			return err
		}

		change := Change{
			EntityType: "issueTemplate", EntityID: id, Op: OpDelete,
			TeamID: scopeTeamID(scope, before.TeamID), Scope: scope,
		}
		if archived {
			if _, err := q.ArchiveIssueTemplate(ctx, id); err != nil {
				if store.IsNotFound(err) {
					return platform.NotFound("template")
				}
				return platform.Internal(err)
			}
		} else {
			row, err := q.UnarchiveIssueTemplate(ctx, id)
			if err != nil {
				if store.IsNotFound(err) {
					// Restored between the read above and here.
					return platform.NotFound("template")
				}
				return platform.Internal(err)
			}
			change.Op = OpUpsert
			change.Payload = toIssueTemplate(store.GetIssueTemplateRow(row))
		}

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), change)
		if err != nil {
			return err
		}
		if archived {
			return s.clearDefaultsPointingAt(ctx, q, p, id)
		}
		return nil
	})
	return id, version, err
}

// loadTemplateForArchive reads the row in whichever state the caller is about to change.
//
// requireTemplateAccess deliberately treats an archived template as missing — it is absent
// from every listing and every replica — so the way back needs the mirror of it. Both give
// the same not-found answer for a row in the wrong state, which is what stops either
// direction being a way to ask whether a template exists.
func (s *Service) loadTemplateForArchive(
	ctx context.Context, q *store.Queries, p *authz.Principal, id uuid.UUID, archived bool,
) (store.GetIssueTemplateRow, error) {
	if archived {
		return s.requireTemplateAccess(ctx, q, p, id)
	}
	row, err := q.GetIssueTemplate(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return store.GetIssueTemplateRow{}, platform.NotFound("template")
		}
		return store.GetIssueTemplateRow{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID || row.ArchivedAt == nil {
		return store.GetIssueTemplateRow{}, platform.NotFound("template")
	}
	return row, nil
}

// ListIssueTemplates returns what the create dialog may offer.
//
// With a team: the workspace's templates, which are offered everywhere, plus that team's
// own. Without: every template the caller can see, which is what the settings screen and
// the bootstrap snapshot want.
func (s *Service) ListIssueTemplates(
	ctx context.Context, p *authz.Principal, teamID *uuid.UUID,
) ([]model.IssueTemplate, error) {
	q := s.db.Queries()

	if teamID != nil {
		team, err := q.GetTeam(ctx, *teamID)
		if err != nil {
			if store.IsNotFound(err) {
				return nil, platform.NotFound("team")
			}
			return nil, platform.Internal(err)
		}
		if team.WorkspaceID != p.WorkspaceID || !authz.Visible(p, authz.TeamScope(team.ID, team.Private)) {
			return nil, platform.NotFound("team")
		}

		rows, err := q.ListIssueTemplatesForTeam(ctx, store.ListIssueTemplatesForTeamParams{
			WorkspaceID: p.WorkspaceID,
			TeamID:      teamID,
		})
		if err != nil {
			return nil, platform.Internal(err)
		}
		out := make([]model.IssueTemplate, 0, len(rows))
		for _, r := range rows {
			// A guest is in the team but is never handed workspace-wide entities, and the
			// query's "team_id IS NULL" arm returns exactly those.
			if r.TeamID == nil && !authz.Visible(p, authz.WorkspaceScope()) {
				continue
			}
			out = append(out, toIssueTemplate(store.GetIssueTemplateRow(r)))
		}
		return out, nil
	}

	rows, err := q.ListIssueTemplatesInWorkspace(ctx, p.WorkspaceID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.IssueTemplate, 0, len(rows))
	for _, r := range rows {
		// Unlike the per-team query, this one applies no visibility rule of its own, so
		// every row is put through the predicate the sync hub uses. A template belonging to
		// a private team the caller is not in must not be listed here, or the API becomes
		// the leak the sync engine was careful not to be. The team lookup that costs is
		// affordable because this is a settings-screen listing: a workspace has tens of
		// templates, not tens of thousands.
		scope, err := scopeForTemplate(ctx, q, r.TeamID)
		if err != nil {
			return nil, err
		}
		if !authz.Visible(p, scope) {
			continue
		}
		out = append(out, toIssueTemplate(store.GetIssueTemplateRow(r)))
	}
	return out, nil
}

// GetIssueTemplate reads one template. It exists because a template is linkable — somebody
// opens a create dialog from a URL without ever having listed the team's templates — and
// because the same not-found answer has to be given whether the id is wrong or the team is
// one the caller cannot see.
func (s *Service) GetIssueTemplate(
	ctx context.Context, p *authz.Principal, id uuid.UUID,
) (model.IssueTemplate, error) {
	q := s.db.Queries()
	row, err := s.requireTemplateAccess(ctx, q, p, id)
	if err != nil {
		return model.IssueTemplate{}, err
	}
	scope, err := scopeForTemplate(ctx, q, row.TeamID)
	if err != nil {
		return model.IssueTemplate{}, err
	}
	if !authz.Visible(p, scope) {
		return model.IssueTemplate{}, platform.NotFound("template")
	}
	return toIssueTemplate(row), nil
}

// --- shared plumbing ---------------------------------------------------------------

// requireTemplateScope decides whether the caller may manage templates at this scope, and
// returns the scope the resulting change travels under — the two answers coming out of one
// place, so a template can never be written with permissions from one scope and visibility
// from another.
func (s *Service) requireTemplateScope(
	ctx context.Context, q *store.Queries, p *authz.Principal, teamID *uuid.UUID,
) (authz.Scope, error) {
	if teamID == nil {
		// A workspace template is offered in every team's create dialog. That reach is what
		// makes it an admin action while a team's own template is not.
		if !authz.Can(p, authz.ActionWorkspaceTemplateManage) {
			return authz.Scope{}, platform.Forbidden(
				"only admins can manage templates for the whole workspace")
		}
		return authz.WorkspaceScope(), nil
	}
	team, err := s.requireTeamAccess(ctx, q, p, *teamID, authz.ActionTeamTemplateManage)
	if err != nil {
		return authz.Scope{}, err
	}
	return authz.TeamScope(team.ID, team.Private), nil
}

// requireTemplateAccess loads a live template, or reports it missing.
//
// Not-found rather than forbidden on a workspace mismatch: confirming that an id exists in
// another workspace is itself a leak. Permission on the row it returns is the caller's next
// step, through requireTemplateScope.
func (s *Service) requireTemplateAccess(
	ctx context.Context, q *store.Queries, p *authz.Principal, id uuid.UUID,
) (store.GetIssueTemplateRow, error) {
	row, err := q.GetIssueTemplate(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return store.GetIssueTemplateRow{}, platform.NotFound("template")
		}
		return store.GetIssueTemplateRow{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID || row.ArchivedAt != nil {
		return store.GetIssueTemplateRow{}, platform.NotFound("template")
	}
	return row, nil
}

// scopeForTemplate is the read-side half of requireTemplateScope: the scope a template's
// rows travel under, with no permission attached.
func scopeForTemplate(ctx context.Context, q *store.Queries, teamID *uuid.UUID) (authz.Scope, error) {
	if teamID == nil {
		return authz.WorkspaceScope(), nil
	}
	team, err := q.GetTeam(ctx, *teamID)
	if err != nil {
		if store.IsNotFound(err) {
			// The team cascade-deletes its templates, so this cannot happen from a
			// consistent database — and a scope guessed here would be a scope that decides
			// who sees the row.
			return authz.Scope{}, platform.NotFound("team")
		}
		return authz.Scope{}, platform.Internal(err)
	}
	return authz.TeamScope(team.ID, team.Private), nil
}

func templateName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", platform.Validation("name", "a template needs a name")
	}
	if len(name) > maxTemplateNameLength {
		return "", platform.Validation("name", "that name is too long")
	}
	return name, nil
}

// validateTemplateContent holds the prefilled title and body to the same limits an issue
// is held to. A template that prefills a title the create mutation would reject is a
// template nobody can use, and the failure surfaces on the issue the user was trying to
// file rather than on the template somebody else saved.
//
// The title is deliberately not required to be non-blank the way an issue's is: the
// template editor is where you leave the title empty on purpose, so the person filing the
// issue has to write one.
func validateTemplateContent(title, body *string) error {
	if title != nil && len(*title) > maxTitleLength {
		return platform.Validation("title", "title is too long")
	}
	if body != nil && len(*body) > maxDescriptionLength {
		return platform.Validation("body", "body is too long")
	}
	return nil
}

// nextTemplatePosition appends to the end. Positions are compared across the workspace so
// that a team's templates and the workspace's interleave in one stated order rather than
// in whichever order the two lists happened to be concatenated.
func nextTemplatePosition(ctx context.Context, q *store.Queries, workspaceID uuid.UUID) (string, error) {
	last, err := q.GetLastIssueTemplatePosition(ctx, workspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return fractional.First(), nil
		}
		return "", platform.Internal(err)
	}
	return fractional.After(last), nil
}

// toIssueTemplate takes the row type GetIssueTemplate returns; the other queries convert
// their identically-shaped row into it, so a column list that drifts fails the build. See
// the note above toView.
func toIssueTemplate(t store.GetIssueTemplateRow) model.IssueTemplate {
	return model.IssueTemplate{
		ID:                 t.ID,
		WorkspaceID:        t.WorkspaceID,
		TeamID:             t.TeamID,
		Name:               t.Name,
		Description:        t.Description,
		Title:              t.Title,
		Body:               t.Body,
		Properties:         t.Properties,
		SubIssues:          mustDecodeSubIssues(t.SubIssues),
		Position:           t.Position,
		CreatedBy:          t.CreatedBy,
		CreatedAt:          t.CreatedAt,
		UpdatedAt:          t.UpdatedAt,
		ArchivedAt:         t.ArchivedAt,
		EmailIntakeEnabled: t.EmailIntakeEnabled,
		EmailIntakeAddress: emailIntakeAddressFor(t.EmailIntakeEnabled, t.EmailIntakeAddress),
	}
}

type UpdateTeamTemplatesInput struct {
	TeamID uuid.UUID

	DefaultTemplateForMembersID       *uuid.UUID
	DefaultTemplateForNonMembersID    *uuid.UUID
	ClearDefaultTemplateForMembers    bool
	ClearDefaultTemplateForNonMembers bool
}

func (s *Service) UpdateTeamTemplates(
	ctx context.Context, p *authz.Principal, in UpdateTeamTemplatesInput,
) (model.Team, int64, error) {
	var out model.Team
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		team, err := s.requireTeamAccess(ctx, q, p, in.TeamID, authz.ActionTeamUpdate)
		if err != nil {
			return err
		}
		if err := s.validateDefaultTemplate(ctx, q, p, in.TeamID, in.DefaultTemplateForMembersID, false); err != nil {
			return err
		}
		if err := s.validateDefaultTemplate(ctx, q, p, in.TeamID, in.DefaultTemplateForNonMembersID, true); err != nil {
			return err
		}
		row, err := q.UpdateTeamTemplates(ctx, store.UpdateTeamTemplatesParams{
			ID:                             in.TeamID,
			DefaultTemplateForMembersID:    in.DefaultTemplateForMembersID,
			ClearMembers:                   in.ClearDefaultTemplateForMembers,
			DefaultTemplateForNonMembersID: in.DefaultTemplateForNonMembersID,
			ClearNonMembers:                in.ClearDefaultTemplateForNonMembers,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toTeam(row)
		_ = team
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "team", EntityID: out.ID, Op: OpUpsert, TeamID: &out.ID,
			Scope: authz.TeamScope(out.ID, out.Private), Payload: out,
		})
		return err
	})
	return out, version, err
}

// validateDefaultTemplate checks a template can be a default for this team.
//
// Form templates can only be defaults for non-members; this codebase has no form
// templates yet, so both pointers accept any template the team can use.
func (s *Service) validateDefaultTemplate(
	ctx context.Context, q *store.Queries, p *authz.Principal,
	teamID uuid.UUID, templateID *uuid.UUID, _ bool,
) error {
	if templateID == nil {
		return nil
	}
	return s.validateTemplate(ctx, q, p, teamID, templateID)
}

// applyDefaultTemplate fills an omitted templateId from the team's member/non-member
// default, then copies unset fields from that template. Explicit templateId still
// records provenance and still fills blanks — the composer already typed over the
// rest, and an API caller that named a template but left description empty is asking
// for the template's body.
func (s *Service) applyDefaultTemplate(
	ctx context.Context, q *store.Queries, p *authz.Principal,
	team store.Team, member bool, in *CreateIssueInput,
) error {
	if in.TemplateID == nil && !in.SkipDefaultTemplate {
		if member {
			in.TemplateID = team.DefaultTemplateForMembersID
		} else {
			in.TemplateID = team.DefaultTemplateForNonMembersID
		}
	}
	if in.TemplateID == nil {
		return nil
	}
	row, err := s.requireTemplateAccess(ctx, q, p, *in.TemplateID)
	if err != nil {
		if platform.CodeOf(err) == platform.CodeNotFound {
			// A default that now points at an archived template is "no default",
			// not a create failure. The filer still gets an issue.
			if !in.SkipDefaultTemplate {
				in.TemplateID = nil
				return nil
			}
			return platform.Validation("templateId", "no such template")
		}
		return err
	}
	if in.Description == "" && strings.TrimSpace(row.Body) != "" {
		in.Description = row.Body
	}
	props, err := decodeTemplateProperties(row.Properties)
	if err != nil {
		return err
	}
	props.applyTo(in)
	return nil
}

func (s *Service) clearDefaultsPointingAt(
	ctx context.Context, q *store.Queries, p *authz.Principal, templateID uuid.UUID,
) error {
	teams, err := q.ListTeamsUsingTemplateAsDefault(ctx, &templateID)
	if err != nil {
		return platform.Internal(err)
	}
	for _, team := range teams {
		clearMembers := team.DefaultTemplateForMembersID != nil && *team.DefaultTemplateForMembersID == templateID
		clearNon := team.DefaultTemplateForNonMembersID != nil && *team.DefaultTemplateForNonMembersID == templateID
		row, err := q.UpdateTeamTemplates(ctx, store.UpdateTeamTemplatesParams{
			ID:              team.ID,
			ClearMembers:    clearMembers,
			ClearNonMembers: clearNon,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out := toTeam(row)
		if _, err := s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "team", EntityID: out.ID, Op: OpUpsert, TeamID: &out.ID,
			Scope: authz.TeamScope(out.ID, out.Private), Payload: out,
		}); err != nil {
			return err
		}
	}
	return nil
}
