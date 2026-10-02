package domain

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
	"github.com/peixotolabs/polaris/services/internal/integrations/apple"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// ApplyAppStoreTransaction grants Cloud Pro from a StoreKit 2 signed transaction.
//
// The signature is checked here, not in the resolver. A resolver that trusted the
// client and called ApplySubscription with a plan of the caller's choosing would be
// the bypass billing.go exists to prevent.
func (s *Service) ApplyAppStoreTransaction(
	ctx context.Context, p *authz.Principal, signedTransaction string,
) (model.Workspace, int64, error) {
	if p == nil || p.UserID == uuid.Nil {
		return model.Workspace{}, 0, platform.Unauthorized("")
	}
	if p.ActorType == authz.ActorAppUser || !p.Role.IsAdmin() {
		return model.Workspace{}, 0, platform.Forbidden("only an administrator can subscribe this workspace")
	}

	parse := s.parseApple
	if parse == nil {
		parse = apple.Parse
	}
	tx, err := parse(signedTransaction)
	if err != nil {
		return model.Workspace{}, 0, platform.Validation("signedTransaction", "that App Store transaction could not be verified")
	}
	if tx.BundleID != apple.BundleID {
		return model.Workspace{}, 0, platform.Validation("signedTransaction", "that transaction is for a different app")
	}
	if !apple.IsCloudPro(tx.ProductID) {
		return model.Workspace{}, 0, platform.Validation("signedTransaction", "that product is not Cloud Pro")
	}
	if tx.Revoked || tx.ExpiresAt.IsZero() || !tx.ExpiresAt.After(time.Now()) {
		return model.Workspace{}, 0, platform.Validation("signedTransaction", "that subscription is not active")
	}

	current, err := s.db.Queries().GetWorkspace(ctx, p.WorkspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return model.Workspace{}, 0, platform.NotFound("workspace")
		}
		return model.Workspace{}, 0, platform.Internal(err)
	}
	plan := entitlement.Plan(current.Plan)
	if plan == entitlement.PlanSelfHosted {
		return model.Workspace{}, 0, platform.Validation("plan", "Cloud Pro is not sold on a self-hosted server")
	}
	// Enterprise is negotiated. An App Store receipt must not downgrade it to Pro.
	if plan == entitlement.PlanEnterprise {
		return s.workspaceAsIs(ctx, current)
	}
	existing, err := s.db.Queries().GetSubscription(ctx, p.WorkspaceID)
	if err != nil && !store.IsNotFound(err) {
		return model.Workspace{}, 0, platform.Internal(err)
	}
	if err == nil && existing.Provider == "stripe" && SubscriptionStatus(existing.Status).healthy() {
		// One subscription row per workspace. Replacing a live Stripe customer with
		// this receipt would keep charging the card and forget the customer id the
		// portal uses to cancel it.
		return s.workspaceAsIs(ctx, current)
	}

	subID := tx.OriginalTransactionID
	return s.ApplySubscription(ctx, SubscriptionState{
		WorkspaceID:      p.WorkspaceID,
		Provider:         "apple",
		CustomerID:       tx.OriginalTransactionID,
		SubscriptionID:   &subID,
		Status:           SubscriptionActive,
		CurrentPeriodEnd: &tx.ExpiresAt,
		Plan:             entitlement.PlanPro,
	})
}

func (s *Service) workspaceAsIs(ctx context.Context, row store.Workspace) (model.Workspace, int64, error) {
	version, err := syncWatermark(ctx, s.db.Queries(), row.ID)
	if err != nil {
		return model.Workspace{}, 0, err
	}
	return toWorkspace(row), version, nil
}
