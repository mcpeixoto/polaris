package domain

import (
	"context"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// AI credits.
//
// The unit is a **micro of a US dollar**, chosen because model prices are quoted per million
// tokens: one micro per token is exactly one dollar per million, so a charge is a
// multiplication and nothing rounds. Integers throughout — money in floats is a class of bug
// that only shows up in a reconciliation months later.
//
// Metering is off unless a deployment turns it on. That is the packaging split
// docs/06-product-model/02-plans-and-packaging.md commits to: a self-hosted install brings
// its own key and pays its provider directly, and metering it would be charging twice for
// something we did not provide.

// modelRate is a model's price in micros per token, which equals dollars per million tokens.
type modelRate struct{ in, out int64 }

// Anthropic list prices, June 2026. A model that is not listed is charged at the most
// expensive known rate rather than free: under-billing silently is worse than over-billing
// visibly, and an unknown model here means somebody configured one this table has not caught
// up with.
var modelRates = map[string]modelRate{
	"claude-opus-5":     {in: 5, out: 25},
	"claude-opus-4-8":   {in: 5, out: 25},
	"claude-sonnet-5":   {in: 2, out: 10},
	"claude-sonnet-4-6": {in: 3, out: 15},
	"claude-haiku-4-5":  {in: 1, out: 5},
	"claude-fable-5-1":  {in: 10, out: 50},
	"claude-fable-5":    {in: 10, out: 50},
}

var fallbackRate = modelRate{in: 10, out: 50}

// CostMicros prices one turn.
func CostMicros(model string, inputTokens, outputTokens int) int64 {
	rate, ok := modelRates[model]
	if !ok {
		rate = fallbackRate
	}
	return int64(inputTokens)*rate.in + int64(outputTokens)*rate.out
}

// SetAgentMetered turns credit accounting on. Our cloud sets it; a self-hosted install does
// not, and every credit path below then does nothing.
func (s *Service) SetAgentMetered(on bool) { s.agentMetered = on }

// AgentMetered reports whether this deployment charges for agent runs.
func (s *Service) AgentMetered() bool { return s.agentMetered }

// AgentCreditsRemaining is the workspace's balance, or nil where nothing is metered — which
// the client renders as "no limit" rather than "none left".
func (s *Service) AgentCreditsRemaining(
	ctx context.Context, p *authz.Principal,
) (*int64, error) {
	if p == nil {
		return nil, platform.Unauthorized("")
	}
	if !s.agentMetered {
		return nil, nil
	}
	micros, err := s.db.Queries().GetAiCreditBalance(ctx, p.WorkspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			zero := int64(0)
			return &zero, nil
		}
		return nil, platform.Internal(err)
	}
	return &micros, nil
}

// CheckAgentCredits refuses a run a workspace cannot pay for.
//
// Checked before the run rather than after, because the alternative is telling somebody
// their balance ran out by handing them work they have already been charged for. Reads are
// never gated: the packaging rule is that running out narrows what you can do, never hides
// what you have.
func (s *Service) CheckAgentCredits(ctx context.Context, workspaceID uuid.UUID) error {
	if !s.agentMetered {
		return nil
	}
	micros, err := s.db.Queries().GetAiCreditBalance(ctx, workspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			micros = 0
		} else {
			return platform.Internal(err)
		}
	}
	if micros <= 0 {
		return platform.Forbidden("this workspace has no AI credits left")
	}
	return nil
}

// ChargeAgentRun records what a turn cost.
//
// Charged after the fact from the provider's own reported usage, not estimated beforehand:
// an estimate that runs low is revenue quietly lost, and one that runs high is a customer
// charged for tokens nobody used. A balance is allowed to go negative — the turn happened,
// the money was spent, and refusing to record it would make the ledger a work of fiction.
func (s *Service) ChargeAgentRun(
	ctx context.Context, workspaceID, sessionID uuid.UUID, model string, inputTokens, outputTokens int,
) error {
	if !s.agentMetered {
		return nil
	}
	cost := CostMicros(model, inputTokens, outputTokens)
	if cost == 0 {
		return nil
	}
	return s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		session := &sessionID
		if sessionID == uuid.Nil {
			session = nil
		}
		if _, err := q.AppendAiCreditEntry(ctx, store.AppendAiCreditEntryParams{
			ID:           id,
			WorkspaceID:  workspaceID,
			Micros:       -cost,
			Reason:       "agent run",
			SessionID:    session,
			Model:        &model,
			InputTokens:  int32(inputTokens),
			OutputTokens: int32(outputTokens),
		}); err != nil {
			return platform.Internal(err)
		}
		if _, err := q.AdjustAiCreditBalance(ctx, store.AdjustAiCreditBalanceParams{
			WorkspaceID: workspaceID, Micros: -cost,
		}); err != nil {
			return platform.Internal(err)
		}
		return nil
	})
}

// GrantAgentCredits adds to a workspace's balance: a plan's monthly allowance, a top-up, or
// a goodwill credit. Admin-only, and it never writes a plan — plan state belongs to
// billing.go alone, for the reason stated there.
func (s *Service) GrantAgentCredits(
	ctx context.Context, p *authz.Principal, micros int64, reason string,
) (int64, error) {
	if p == nil {
		return 0, platform.Unauthorized("")
	}
	if !authz.Can(p, authz.ActionWorkspaceUpdate) {
		return 0, platform.Forbidden("only admins can grant AI credits")
	}
	if micros <= 0 {
		return 0, platform.Validation("micros", "a grant adds credit")
	}
	if reason == "" {
		reason = "grant"
	}

	var balance int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		if _, err := q.AppendAiCreditEntry(ctx, store.AppendAiCreditEntryParams{
			ID: id, WorkspaceID: p.WorkspaceID, Micros: micros, Reason: reason,
		}); err != nil {
			return platform.Internal(err)
		}
		balance, err = q.AdjustAiCreditBalance(ctx, store.AdjustAiCreditBalanceParams{
			WorkspaceID: p.WorkspaceID, Micros: micros,
		})
		if err != nil {
			return platform.Internal(err)
		}
		return nil
	})
	return balance, err
}
