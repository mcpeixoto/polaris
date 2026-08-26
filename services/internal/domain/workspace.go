package domain

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

var urlKeyPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,47}$`)

type CreateWorkspaceInput struct {
	// AccountID is the person creating it. They become its first admin.
	AccountID uuid.UUID

	Name   string
	URLKey string

	UserName        string
	UserDisplayName string
	UserTimezone    string

	FirstTeamKey  string
	FirstTeamName string

	// MaxPerAccount bounds how many workspaces this account may belong to. Zero means
	// unlimited, which is what a caller that has no opinion gets — the composition root
	// passes the configured number, and a test that is not about the cap need not know it
	// exists.
	MaxPerAccount int

	// Plan the workspace is created on. Empty means self-hosted.
	//
	// It is an input rather than a constant because the answer depends on which product
	// this build is, and only the composition root knows that: a self-hosted install is
	// unlimited, and a cloud signup starts on the free tier and moves with billing.
	//
	// It used to be the literal "free" for everybody, which is the cloud answer applied to
	// the open-source one. That gave every self-hosted workspace a five-seat cap, a
	// two-team cap and ninety days of history — directly against what the README promises
	// ("self-host free and unlimited on seats") and against the comment on PlanSelfHosted
	// in internal/entitlement, which says a seat count there "would make the project a
	// trial with a licence file". Nothing enforced those caps yet, so the damage so far was
	// a settings screen quoting a limit that did not exist; the day anything did enforce
	// them, every self-hoster would have hit a paywall nobody meant to ship.
	Plan entitlement.Plan
}

// CreateWorkspaceResult carries everything the caller needs to send the new owner
// straight into a usable workspace without a second round trip.
type CreateWorkspaceResult struct {
	Workspace model.Workspace
	User      model.User
	Team      model.Team
	States    []model.WorkflowState
	Version   int64
}

// CreateWorkspace provisions a complete, usable workspace in one transaction.
//
// There is no principal here: this is the signup path, and the caller has an
// authenticated *account* but no user anywhere yet. It is also the one place that writes
// several entity types at once, because a workspace with no team, no statuses and no
// members is not a thing anybody can do anything with — a partial failure that left one
// behind would strand the account in a workspace it cannot use and cannot delete.
func (s *Service) CreateWorkspace(ctx context.Context, in CreateWorkspaceInput) (CreateWorkspaceResult, error) {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return CreateWorkspaceResult{}, platform.Validation("name", "workspace name is required")
	}
	in.URLKey = strings.ToLower(strings.TrimSpace(in.URLKey))
	if in.URLKey == "" {
		in.URLKey = SuggestURLKey(in.Name)
	}
	key, err := normalizeURLKey(in.URLKey)
	if err != nil {
		return CreateWorkspaceResult{}, err
	}
	in.URLKey = key
	if in.FirstTeamKey == "" {
		in.FirstTeamKey = SuggestTeamKey(in.FirstTeamName, in.Name)
	}
	if in.FirstTeamName == "" {
		in.FirstTeamName = in.Name
	}
	if err := validateTeamKey(in.FirstTeamKey); err != nil {
		return CreateWorkspaceResult{}, err
	}
	if in.UserDisplayName == "" {
		in.UserDisplayName = in.UserName
	}
	if in.UserTimezone == "" {
		in.UserTimezone = "UTC"
	}

	// Empty means self-hosted, so a caller that has no opinion gets the unlimited plan
	// rather than the cloud's free tier. The zero value is the open-source answer, because
	// this repository is the open-source product and the cloud is the deployment that
	// knows it is special.
	plan := in.Plan
	if plan == "" {
		plan = entitlement.PlanSelfHosted
	}
	if !plan.Valid() {
		return CreateWorkspaceResult{}, platform.Validation("plan",
			fmt.Sprintf("%q is not a plan", plan))
	}

	var out CreateWorkspaceResult
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		// The ceiling, checked inside the transaction so it cannot be raced past by two
		// requests that both read the count before either wrote a row.
		//
		// There was no restriction here at all: POST /auth/workspaces needed a session and
		// nothing else, and every workspace is one the sync hub, the bootstrap endpoint and
		// the fan-out job carry from then on. This is a resource bound and not a statement
		// about who deserves a workspace — see the comment on MaxWorkspacesPerAccount for
		// why the product question is left to the operator.
		if in.MaxPerAccount > 0 {
			existing, err := q.CountWorkspacesForAccount(ctx, &in.AccountID)
			if err != nil {
				return platform.Internal(err)
			}
			if int(existing) >= in.MaxPerAccount {
				return platform.Validation("name", fmt.Sprintf(
					"this account is already in %d workspaces, which is the limit on this server",
					existing))
			}
		}

		wsID, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		ws, err := q.CreateWorkspace(ctx, store.CreateWorkspaceParams{
			ID:       wsID,
			Name:     in.Name,
			UrlKey:   in.URLKey,
			Plan:     string(plan),
			Settings: json.RawMessage(`{}`),
		})
		if err != nil {
			if urlKeyTaken(err) {
				return platform.Validation("urlKey", fmt.Sprintf("the address %s is already taken", in.URLKey))
			}
			return platform.Internal(err)
		}
		out.Workspace = toWorkspace(ws)

		if err := q.InitWorkspaceVersion(ctx, wsID); err != nil {
			return platform.Internal(err)
		}

		userID, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		user, err := q.CreateUser(ctx, store.CreateUserParams{
			ID:          userID,
			WorkspaceID: wsID,
			AccountID:   &in.AccountID,
			Name:        in.UserName,
			DisplayName: in.UserDisplayName,
			Timezone:    in.UserTimezone,
			// The creator is an admin, not an owner: the owner role only exists on
			// Enterprise, and handing it out on the free plan would mean quietly
			// downgrading people's roles the day the entitlement check ships.
			Role: string(authz.RoleAdmin),
			Kind: "human",
		})
		if err != nil {
			return platform.Internal(err)
		}
		out.User = toUser(user)

		teamID, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		team, err := q.CreateTeam(ctx, store.CreateTeamParams{
			ID:          teamID,
			WorkspaceID: wsID,
			Key:         in.FirstTeamKey,
			Name:        in.FirstTeamName,
			Timezone:    in.UserTimezone,
			Private:     false,
			Settings:    json.RawMessage(`{}`),
		})
		if err != nil {
			return platform.Internal(err)
		}
		out.Team = toTeam(team)

		out.States, err = seedWorkflowStates(ctx, q, wsID, teamID)
		if err != nil {
			return err
		}

		projectStatuses, err := seedProjectStatuses(ctx, q, wsID)
		if err != nil {
			return err
		}

		membership, err := s.addMember(ctx, q, wsID, teamID, userID, "owner")
		if err != nil {
			return err
		}

		// Emitted even though nobody is listening yet: the change log is the workspace's
		// complete history, and a workspace whose first entities are missing from it
		// would produce an activity feed and an audit trail that both start mid-story.
		actor := authz.UserActor(userID)
		changes := []Change{
			{EntityType: "workspace", EntityID: wsID, Op: OpUpsert,
				Scope: authz.WorkspaceScope(), Payload: out.Workspace},
			{EntityType: "user", EntityID: userID, Op: OpUpsert,
				Scope: authz.WorkspaceScope(), Payload: out.User},
			{EntityType: "team", EntityID: teamID, Op: OpUpsert, TeamID: &teamID,
				Scope: authz.TeamScope(teamID, false), Payload: out.Team},
		}
		for _, st := range out.States {
			changes = append(changes, Change{
				EntityType: "workflowState", EntityID: st.ID, Op: OpUpsert, TeamID: &teamID,
				Scope: authz.TeamScope(teamID, false), Payload: st,
			})
		}
		for _, st := range projectStatuses {
			changes = append(changes, Change{
				EntityType: "projectStatus", EntityID: st.ID, Op: OpUpsert,
				Scope: authz.WorkspaceScope(), Payload: st,
			})
		}
		changes = append(changes, Change{
			EntityType: "teamMembership", EntityID: membership.ID, Op: OpUpsert, TeamID: &teamID,
			Scope: authz.TeamScope(teamID, false), Payload: membership,
		})

		out.Version, err = s.em.Emit(ctx, q, wsID, actor, changes...)
		return err
	})
	return out, err
}

func (s *Service) GetWorkspace(ctx context.Context, p *authz.Principal) (model.Workspace, error) {
	ws, err := s.db.Queries().GetWorkspace(ctx, p.WorkspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return model.Workspace{}, platform.NotFound("workspace")
		}
		return model.Workspace{}, platform.Internal(err)
	}
	return toWorkspace(ws), nil
}

type UpdateWorkspaceInput struct {
	Name    *string
	LogoURL *string
	URLKey  *string

	ProjectUpdateReminderIntervalDays *int
	ProjectUpdateReminderWeekday      *int
	ProjectUpdateReminderHour         *int
	PulseEnabled                      *bool
	PulseDigestCadence                *string

	CustomerRequestsEnabled  *bool
	CustomerDefaultTeamID    *uuid.UUID
	ClearCustomerDefaultTeam bool
	CustomerRevenueUnit      *string
	CustomerTiers            []string
	SetCustomerTiers         bool
}

func (s *Service) UpdateWorkspace(ctx context.Context, p *authz.Principal, in UpdateWorkspaceInput) (model.Workspace, int64, error) {
	if !authz.Can(p, authz.ActionWorkspaceUpdate) {
		return model.Workspace{}, 0, platform.Forbidden("only admins can change workspace settings")
	}
	if in.Name != nil {
		trimmed := strings.TrimSpace(*in.Name)
		if trimmed == "" {
			return model.Workspace{}, 0, platform.Validation("name", "workspace name is required")
		}
		in.Name = &trimmed
	}
	if in.URLKey != nil {
		key, err := normalizeURLKey(*in.URLKey)
		if err != nil {
			return model.Workspace{}, 0, err
		}
		in.URLKey = &key
	}
	if err := validateProjectUpdateReminderFields(
		in.ProjectUpdateReminderIntervalDays,
		in.ProjectUpdateReminderWeekday,
		in.ProjectUpdateReminderHour,
	); err != nil {
		return model.Workspace{}, 0, err
	}
	if err := validatePulseDigestCadence(in.PulseDigestCadence); err != nil {
		return model.Workspace{}, 0, err
	}
	if in.CustomerRevenueUnit != nil {
		unit, err := normalizeRevenueUnit(*in.CustomerRevenueUnit)
		if err != nil {
			return model.Workspace{}, 0, err
		}
		in.CustomerRevenueUnit = &unit
	}
	var tiers []string
	if in.SetCustomerTiers {
		normalized, err := normalizeCustomerTiers(in.CustomerTiers)
		if err != nil {
			return model.Workspace{}, 0, err
		}
		tiers = normalized
	}

	var out model.Workspace
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if in.CustomerDefaultTeamID != nil && !in.ClearCustomerDefaultTeam {
			if err := requirePublicFeedbackTeam(ctx, q, p, *in.CustomerDefaultTeamID); err != nil {
				return err
			}
		}
		if in.URLKey != nil {
			current, err := q.GetWorkspace(ctx, p.WorkspaceID)
			if err != nil {
				if store.IsNotFound(err) {
					return platform.NotFound("workspace")
				}
				return platform.Internal(err)
			}
			if current.UrlKey != *in.URLKey {
				// Reclaim first so renaming back onto a previous slug is a write, not a
				// unique-violation against our own alias.
				if err := q.DeleteWorkspaceURLAlias(ctx, store.DeleteWorkspaceURLAliasParams{
					UrlKey:      *in.URLKey,
					WorkspaceID: p.WorkspaceID,
				}); err != nil {
					return platform.Internal(err)
				}
				if err := q.InsertWorkspaceURLAlias(ctx, store.InsertWorkspaceURLAliasParams{
					UrlKey:      current.UrlKey,
					WorkspaceID: p.WorkspaceID,
				}); err != nil {
					if urlKeyTaken(err) {
						return platform.Validation("urlKey", fmt.Sprintf("the address %s is already taken", *in.URLKey))
					}
					return platform.Internal(err)
				}
			}
		}
		row, err := q.UpdateWorkspace(ctx, store.UpdateWorkspaceParams{
			ID:                                p.WorkspaceID,
			Name:                              in.Name,
			LogoUrl:                           in.LogoURL,
			UrlKey:                            in.URLKey,
			ProjectUpdateReminderIntervalDays: int16PtrFromInt(in.ProjectUpdateReminderIntervalDays),
			ProjectUpdateReminderWeekday:      int16PtrFromInt(in.ProjectUpdateReminderWeekday),
			ProjectUpdateReminderHour:         int16PtrFromInt(in.ProjectUpdateReminderHour),
			PulseEnabled:                      in.PulseEnabled,
			PulseDigestCadence:                in.PulseDigestCadence,
			CustomerRequestsEnabled:           in.CustomerRequestsEnabled,
			CustomerDefaultTeamID:             in.CustomerDefaultTeamID,
			ClearCustomerDefaultTeam:          in.ClearCustomerDefaultTeam,
			CustomerRevenueUnit:               in.CustomerRevenueUnit,
			SetCustomerTiers:                  in.SetCustomerTiers,
			CustomerTiers:                     tiers,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("workspace")
			}
			if urlKeyTaken(err) {
				taken := ""
				if in.URLKey != nil {
					taken = *in.URLKey
				}
				return platform.Validation("urlKey", fmt.Sprintf("the address %s is already taken", taken))
			}
			return platform.Internal(err)
		}
		out = toWorkspace(row)

		// The settings the workspace runs under. The whole resulting row rather than a diff,
		// because there is no `before` read on this path and inventing one would mean an
		// extra query on every workspace edit to serve a screen nobody has opened yet. The
		// previous values are recoverable by reading the previous entry, which is what an
		// append-only log is for.
		entry := s.auditBy(ctx, q, p, AuditWorkspaceUpdated)
		entry.TargetType = "workspace"
		entry.TargetID = &out.ID
		entry.TargetLabel = out.Name
		entry.After = out
		if err := s.recordAudit(ctx, q, entry); err != nil {
			return err
		}

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "workspace", EntityID: out.ID, Op: OpUpsert,
			Scope: authz.WorkspaceScope(), Payload: out,
		})
		return err
	})
	return out, version, err
}

// WorkspaceVersion is the current sync watermark, read by the bootstrap endpoint before
// it starts streaming.
func (s *Service) WorkspaceVersion(ctx context.Context, workspaceID uuid.UUID) (int64, error) {
	v, err := s.db.Queries().GetWorkspaceVersion(ctx, workspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return 0, platform.NotFound("workspace")
		}
		return 0, platform.Internal(err)
	}
	return v, nil
}

// SuggestURLKey turns a workspace name into a plausible URL segment. Best-effort: the
// caller still has to handle the address being taken.
func SuggestURLKey(name string) string {
	var b strings.Builder
	lastHyphen := true // suppress a leading hyphen
	for _, r := range strings.ToLower(name) {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
			lastHyphen = false
		case !lastHyphen:
			b.WriteByte('-')
			lastHyphen = true
		}
	}
	key := strings.Trim(b.String(), "-")
	if len(key) > 48 {
		key = strings.Trim(key[:48], "-")
	}
	if len(key) < 2 {
		return ""
	}
	return key
}

func normalizeURLKey(raw string) (string, error) {
	key := strings.ToLower(strings.TrimSpace(raw))
	if !urlKeyPattern.MatchString(key) {
		return "", platform.Validation("urlKey",
			"the workspace URL must be 2-48 characters of lowercase letters, digits and hyphens, starting with a letter or digit")
	}
	return key, nil
}

func urlKeyTaken(err error) bool {
	return store.IsUniqueViolation(err, "workspace_url_key_key") ||
		store.IsUniqueViolation(err, "workspace_url_alias_pkey") ||
		store.IsUniqueViolation(err, "workspace_url_key_reserved")
}

const (
	maxCustomerTiers       = 32
	maxCustomerTierName    = 64
	maxCustomerRevenueUnit = 32
)

func normalizeRevenueUnit(raw string) (string, error) {
	unit := strings.TrimSpace(raw)
	if len(unit) > maxCustomerRevenueUnit {
		return "", platform.Validation("customerRevenueUnit", "revenue unit is too long")
	}
	return unit, nil
}

func normalizeCustomerTiers(raw []string) ([]string, error) {
	if len(raw) > maxCustomerTiers {
		return nil, platform.Validation("customerTiers", "at most 32 tiers")
	}
	seen := make(map[string]struct{}, len(raw))
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		name := strings.TrimSpace(item)
		if name == "" {
			continue
		}
		if len(name) > maxCustomerTierName {
			return nil, platform.Validation("customerTiers", "a tier name is too long")
		}
		key := strings.ToLower(name)
		if _, ok := seen[key]; ok {
			return nil, platform.Validation("customerTiers", "tier names must be unique")
		}
		seen[key] = struct{}{}
		out = append(out, name)
	}
	return out, nil
}

func requirePublicFeedbackTeam(
	ctx context.Context, q *store.Queries, p *authz.Principal, teamID uuid.UUID,
) error {
	team, err := q.GetTeam(ctx, teamID)
	if err != nil {
		if store.IsNotFound(err) {
			return platform.NotFound("team")
		}
		return platform.Internal(err)
	}
	if team.WorkspaceID != p.WorkspaceID {
		return platform.NotFound("team")
	}
	if team.DeletedAt != nil || team.ArchivedAt != nil || team.RetiredAt != nil {
		return platform.NotFound("team")
	}
	if team.Private {
		return platform.Validation("customerDefaultTeamId", "customer requests can only default to a public team")
	}
	return nil
}

// SuggestTeamKey derives an initial team key from a name, falling back to the workspace
// name. Returns "" when nothing usable can be derived, so the caller can ask.
func SuggestTeamKey(names ...string) string {
	for _, name := range names {
		var b strings.Builder
		for _, r := range strings.ToUpper(name) {
			if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
				b.WriteRune(r)
			}
			if b.Len() == 4 {
				break
			}
		}
		key := b.String()
		// The pattern requires a leading letter.
		if key != "" && key[0] >= 'A' && key[0] <= 'Z' {
			return key
		}
	}
	return ""
}
