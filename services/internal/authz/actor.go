// Package authz holds the single authorisation implementation used by GraphQL
// resolvers, the sync hub's delta filter, search and exports.
//
// There is exactly one visibility predicate in this codebase, and it lives here. Two
// implementations means one of them eventually leaks a private team — the resolver gets
// the fix and the sync stream does not, or the other way round. This package therefore
// deliberately has no dependency on store, graph or syncsrv: it operates on plain
// values that any of them can construct.
package authz

import (
	"context"

	"github.com/google/uuid"
)

// ActorType names the four kinds of thing that can cause a write. All four exist from
// the first commit: the product surfaces actors in the activity feed, webhooks, audit
// log, insights and filters, and adding a fourth kind later would be a migration across
// every event table.
type ActorType string

const (
	ActorUser        ActorType = "user"
	ActorAppUser     ActorType = "app_user"
	ActorIntegration ActorType = "integration"
	ActorSystem      ActorType = "system"
)

func (a ActorType) Valid() bool {
	switch a {
	case ActorUser, ActorAppUser, ActorIntegration, ActorSystem:
		return true
	}
	return false
}

// Actor is who did something. Every domain mutation takes one — it is a required
// parameter, not a context lookup, so that a caller physically cannot write to the
// database without saying who is responsible.
type Actor struct {
	Type ActorType
	// ID is the user id for ActorUser and ActorAppUser, the integration id for
	// ActorIntegration, and nil for ActorSystem.
	ID *uuid.UUID
}

func UserActor(id uuid.UUID) Actor { return Actor{Type: ActorUser, ID: &id} }
func AppActor(id uuid.UUID) Actor  { return Actor{Type: ActorAppUser, ID: &id} }
func SystemActor() Actor           { return Actor{Type: ActorSystem} }
func IntegrationActor(id uuid.UUID) Actor {
	return Actor{Type: ActorIntegration, ID: &id}
}

// Role is a user's workspace-level role.
type Role string

const (
	RoleOwner  Role = "owner"
	RoleAdmin  Role = "admin"
	RoleMember Role = "member"
	RoleGuest  Role = "guest"
)

// rank orders roles for "at least this role" checks. Guests are deliberately outside
// the ladder: a guest is not a weaker member, it is a differently-scoped principal that
// can only see teams it was explicitly added to.
func (r Role) rank() int {
	switch r {
	case RoleOwner:
		return 3
	case RoleAdmin:
		return 2
	case RoleMember:
		return 1
	default:
		return 0
	}
}

func (r Role) AtLeast(other Role) bool { return r.rank() >= other.rank() }
func (r Role) IsAdmin() bool           { return r == RoleOwner || r == RoleAdmin }

// Principal is an authenticated caller resolved against one workspace. It is built once
// per request (and once per socket connect) and then passed down; nothing below the
// entry point re-reads permissions from the database.
type Principal struct {
	AccountID   uuid.UUID
	UserID      uuid.UUID
	WorkspaceID uuid.UUID
	Role        Role

	// Teams the principal can see: public teams plus private teams they belong to, plus
	// (from M3) the descendants of those teams.
	Teams TeamSet

	// Entities shared with this principal individually, out of a team they cannot
	// otherwise see. Empty until per-issue sharing ships.
	SharedEntities map[uuid.UUID]struct{}

	// Set when the caller authenticated with an API key or OAuth token rather than a
	// session, in which case the granted scopes further narrow what they may do.
	Scopes []string
}

func (p *Principal) IsGuest() bool { return p.Role == RoleGuest }

func (p *Principal) Actor() Actor { return UserActor(p.UserID) }

// HasScope reports whether an API-key or OAuth caller was granted a scope. A session
// caller has no scope restrictions and always passes.
func (p *Principal) HasScope(want string) bool {
	if len(p.Scopes) == 0 {
		return true
	}
	for _, s := range p.Scopes {
		if s == want || s == "admin" {
			return true
		}
	}
	return false
}

type principalKey struct{}

func WithPrincipal(ctx context.Context, p *Principal) context.Context {
	return context.WithValue(ctx, principalKey{}, p)
}

// PrincipalFrom returns the caller on the context, if any. Domain functions do not use
// this — they take an explicit Actor — but transport layers do, to build one.
func PrincipalFrom(ctx context.Context) (*Principal, bool) {
	p, ok := ctx.Value(principalKey{}).(*Principal)
	return p, ok && p != nil
}
