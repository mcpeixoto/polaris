package authz

import (
	"encoding/json"

	"github.com/google/uuid"
)

// TeamSet is a principal's accessible team ids. Membership is checked on every delta
// row fanned out to every session, so it is a map rather than a slice.
type TeamSet map[uuid.UUID]struct{}

func NewTeamSet(ids ...uuid.UUID) TeamSet {
	s := make(TeamSet, len(ids))
	for _, id := range ids {
		s[id] = struct{}{}
	}
	return s
}

func (s TeamSet) Has(id uuid.UUID) bool {
	_, ok := s[id]
	return ok
}

func (s TeamSet) HasAny(ids []uuid.UUID) bool {
	for _, id := range ids {
		if _, ok := s[id]; ok {
			return true
		}
	}
	return false
}

func (s TeamSet) IDs() []uuid.UUID {
	out := make([]uuid.UUID, 0, len(s))
	for id := range s {
		out = append(out, id)
	}
	return out
}

// ScopeKind classifies what an entity's visibility depends on.
type ScopeKind string

const (
	// ScopeWorkspace: visible to every non-guest member. Labels, initiatives, customers,
	// workspace templates, project statuses.
	ScopeWorkspace ScopeKind = "workspace"
	// ScopeTeam: visible to members of one team. Issues, statuses, cycles, team labels.
	ScopeTeam ScopeKind = "team"
	// ScopeProject: visible to members of any of the project's teams.
	ScopeProject ScopeKind = "project"
	// ScopeIssueShared: a team-scoped entity additionally shared with named users.
	ScopeIssueShared ScopeKind = "issue_shared"
	// ScopeUser: visible only to one user. Notifications, drafts, personal views.
	ScopeUser ScopeKind = "user"
)

// Scope travels on every change_log row and is the only thing the sync hub consults when
// deciding whether a session may see a change.
//
// It has to be self-contained. By the time the hub reads the row the entity may have
// been deleted, moved to another team, or made private — re-querying it would give the
// wrong answer, and doing so per row per session would not be affordable anyway.
type Scope struct {
	Kind ScopeKind `json:"kind"`

	// Private marks a team-scoped entity whose team is private. Kept explicit rather
	// than derived so a change emitted before a privacy flip is judged by the state at
	// the time it was written.
	Private bool `json:"private,omitempty"`

	// TeamIDs carries every team that grants access, for project- and multi-team scopes.
	TeamIDs []uuid.UUID `json:"team_ids,omitempty"`

	// SharedWith carries individually granted user ids.
	SharedWith []uuid.UUID `json:"shared_with,omitempty"`

	// UserID is the sole recipient for ScopeUser.
	UserID *uuid.UUID `json:"user_id,omitempty"`
}

func WorkspaceScope() Scope { return Scope{Kind: ScopeWorkspace} }

func TeamScope(teamID uuid.UUID, private bool) Scope {
	return Scope{Kind: ScopeTeam, Private: private, TeamIDs: []uuid.UUID{teamID}}
}

func ProjectScope(teamIDs []uuid.UUID) Scope {
	return Scope{Kind: ScopeProject, TeamIDs: teamIDs}
}

func UserScope(userID uuid.UUID) Scope {
	return Scope{Kind: ScopeUser, UserID: &userID}
}

func (s Scope) MarshalJSONB() (json.RawMessage, error) {
	b, err := json.Marshal(s)
	if err != nil {
		return nil, err
	}
	return json.RawMessage(b), nil
}

func ParseScope(raw json.RawMessage) (Scope, error) {
	var s Scope
	if len(raw) == 0 {
		return Scope{Kind: ScopeWorkspace}, nil
	}
	err := json.Unmarshal(raw, &s)
	return s, err
}

// Visible is THE visibility predicate.
//
// Every read path in the product funnels through it: GraphQL resolvers filter query
// results with it, the sync hub filters deltas with it, search filters hits with it, and
// exports filter rows with it. If you are about to write an access check somewhere else,
// you are about to introduce the bug this function exists to prevent.
//
// It is intentionally total and intentionally closed: an unrecognised scope kind denies.
// A new entity type that forgets to set a scope is invisible, which is a bug that gets
// reported immediately. The opposite default leaks data silently.
func Visible(p *Principal, s Scope) bool {
	if p == nil {
		return false
	}

	switch s.Kind {
	case ScopeWorkspace:
		// Guests are scoped to their teams and never see workspace-wide entities.
		return !p.IsGuest()

	case ScopeTeam:
		return p.Teams.HasAny(s.TeamIDs)

	case ScopeProject:
		// A project is visible if the principal is in any of its teams.
		return p.Teams.HasAny(s.TeamIDs)

	case ScopeIssueShared:
		if p.Teams.HasAny(s.TeamIDs) {
			return true
		}
		for _, id := range s.SharedWith {
			if id == p.UserID {
				return true
			}
		}
		// Sharing may also have been recorded on the principal rather than the row.
		_, ok := p.SharedEntities[p.UserID]
		return ok

	case ScopeUser:
		return s.UserID != nil && *s.UserID == p.UserID
	}

	return false
}

// VisibleEntity is the same predicate for a specific entity id, used where individual
// sharing is recorded against the principal rather than inline on the row.
func VisibleEntity(p *Principal, entityID uuid.UUID, s Scope) bool {
	if Visible(p, s) {
		return true
	}
	if p == nil {
		return false
	}
	_, shared := p.SharedEntities[entityID]
	return shared
}

// TeamListable is whether a team row may appear in directory queries.
//
// Admins see private teams they have not joined so settings can discover and manage them;
// issue content still requires membership via Visible.
func TeamListable(p *Principal, teamID uuid.UUID, private bool) bool {
	if Visible(p, TeamScope(teamID, private)) {
		return true
	}
	return private && p != nil && p.Role.IsAdmin()
}
