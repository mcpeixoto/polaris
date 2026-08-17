package graph

import (
	"context"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
)

// idempotent wraps a keyed mutation so a client's retry replays the original result
// instead of applying the write a second time.
//
// The client generates (clientId, opId) when it appends to its offline outbox, and
// replays the same pair on every attempt. Without this wrapper a dropped response — a
// closing laptop lid, a proxy timeout, a deploy mid-flight — produces a duplicate issue
// that the user did not create and cannot account for. That is acceptance test 2 in
// docs/07-milestones/00-milestone-0.md.
//
// The pair is optional: an integration, a script or the seeder has no outbox, so a nil
// key runs fn directly. Demanding a key everywhere would mean minting a throwaway at
// those call sites, and a throwaway key protects nothing.
//
// `request` is hashed so that reusing an opId with different arguments is rejected rather
// than silently answered with the earlier result.
func idempotent[T any](
	ctx context.Context,
	svc *domain.Service,
	p *authz.Principal,
	clientID, opID *uuid.UUID,
	request any,
	fn func(context.Context) (T, int64, error),
) (T, int64, error) {
	key := domain.IdempotencyKey{Request: request}
	if clientID != nil {
		key.ClientID = *clientID
	}
	if opID != nil {
		key.OpID = *opID
	}
	return domain.Idempotent(ctx, svc, p.WorkspaceID, key, fn)
}

// deletedEntity is the recorded result of a mutation whose only output is the id it acted
// on. It exists so those mutations can go through the same replay machinery as the ones
// that return an entity — a delete that is not replay-protected is just as capable of
// running twice as a create, and the second run would fail with "not found" and surface
// to the user as an error for something that actually succeeded.
type deletedEntity struct {
	ID uuid.UUID `json:"id"`
}
