-- The billing record for one workspace: what the payment provider believes it is owed for.
--
-- Not to be confused with project_subscription / initiative_subscription /
-- customer_subscription (000076), which are notification watches. This one is money.
--
-- It is deliberately separate from the plan columns on `workspace` (000016), and the split
-- is the whole point of the table. `workspace.plan` is what the product enforces right now,
-- read on every gated write; this row is what the provider last told us, which is a
-- different fact with a different lifetime — it arrives out of order, it can be replayed by
-- a webhook retry, and it keeps describing a cancelled subscription long after the
-- workspace has been moved back to free. Folding the two together would mean either
-- re-deriving entitlements from provider state on every request, or losing the audit trail
-- of what we were told and when.
--
-- `status` holds OUR vocabulary, not the provider's raw string. The provider adapter maps
-- into this set, so a payment processor inventing a new state is a mapping change in Go and
-- not a webhook that fails to persist — a billing event we could not write down is the one
-- failure mode here that silently costs money.

CREATE TABLE subscription (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,

  -- Which payment processor this row came from ('stripe' today). Named rather than
  -- assumed, because provider_customer_id and provider_subscription_id are only
  -- meaningful next to it, and a second provider must not be a schema change.
  provider                 text NOT NULL,
  provider_customer_id     text NOT NULL,
  -- NULL while a customer exists but has never completed a checkout: the customer record
  -- is created first, and a row that could not be written until both ids existed would
  -- lose the link between the workspace and the customer it already has.
  provider_subscription_id text,

  status text NOT NULL,

  -- The end of the period that has been paid for. This is what the lapse job measures its
  -- grace against, and what `workspace.plan_expires_at` is set from.
  current_period_end timestamptz,

  -- How many seats are being billed. Recorded for reconciliation against the actual seat
  -- count; it is not itself the ceiling — `workspace.seat_limit` is, and stays NULL unless
  -- a deal pins it. See internal/domain/billing.go.
  seats_paid integer,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT subscription_status_check CHECK (
    status IN ('trialing', 'active', 'past_due', 'canceled', 'paused')
  ),
  CONSTRAINT subscription_provider_not_blank CHECK (
    provider <> '' AND provider_customer_id <> ''
  ),
  -- Mirrors workspace_seat_limit_positive: a zero or negative seat count is not a deal, it
  -- is a bad write, and it would otherwise reconcile a paying workspace down to nothing.
  CONSTRAINT subscription_seats_paid_positive CHECK (
    seats_paid IS NULL OR seats_paid > 0
  )
);

-- One row per workspace. The upsert keys on this, so it is what makes a replayed webhook an
-- update instead of a second, contradictory subscription for the same workspace.
CREATE UNIQUE INDEX subscription_workspace_key ON subscription (workspace_id);

-- And one workspace per provider subscription, in the other direction. Without it a
-- mis-linked customer id can point one provider subscription at two workspaces, which bills
-- one company and entitles two.
CREATE UNIQUE INDEX subscription_provider_subscription_key
  ON subscription (provider, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

-- The lapse job's sweep, and the only reason it does not read the whole table every minute:
-- past-due rows are a rounding error against total workspaces, so the partial index keeps
-- the tick proportional to the problem rather than to the customer base.
CREATE INDEX subscription_past_due_idx
  ON subscription (current_period_end)
  WHERE status = 'past_due';

CREATE TRIGGER subscription_set_updated_at
  BEFORE UPDATE ON subscription
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
