-- Billing. Every statement that writes a workspace's plan facts lives in this file, and
-- that is not tidiness — `workspace.plan`, `seat_limit`, `plan_expires_at` and
-- `plan_lapsed_at` are the four columns the entire entitlement matrix resolves against, and
-- the product's rule is that a *request* can never set them. Keeping the writers in one
-- place is what makes "is there a second writer" a question somebody can answer by looking.
--
-- UpdateWorkspace (workspaces.sql) touches none of them, on purpose. See internal/domain/
-- billing.go for the only production callers of anything below.

-- name: UpsertSubscription :one
INSERT INTO subscription (
  id, workspace_id, provider, provider_customer_id, provider_subscription_id,
  status, current_period_end, seats_paid
) VALUES (
  sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(provider), sqlc.arg(provider_customer_id),
  sqlc.narg(provider_subscription_id), sqlc.arg(status), sqlc.narg(current_period_end),
  sqlc.narg(seats_paid)
)
-- Keyed on the workspace rather than on the provider's id, because a webhook replay and a
-- reconciliation sweep must both land on the row that is already there. The id column is
-- left alone on conflict: it is this row's identity, and churning it would break any future
-- reference to it.
ON CONFLICT (workspace_id) DO UPDATE
SET provider                 = EXCLUDED.provider,
    provider_customer_id     = EXCLUDED.provider_customer_id,
    provider_subscription_id = EXCLUDED.provider_subscription_id,
    status                   = EXCLUDED.status,
    current_period_end       = EXCLUDED.current_period_end,
    seats_paid               = EXCLUDED.seats_paid
RETURNING id, workspace_id, provider, provider_customer_id, provider_subscription_id,
          status, current_period_end, seats_paid, created_at, updated_at;

-- name: GetSubscription :one
SELECT id, workspace_id, provider, provider_customer_id, provider_subscription_id,
       status, current_period_end, seats_paid, created_at, updated_at
FROM subscription
WHERE workspace_id = $1;

-- ListSubscriptionsPastDueBeyondGrace names the workspaces whose plan should now be marked
-- lapsed, and its predicate is the exact negation of the recovery query below — a workspace
-- that satisfied both would flap between lapsed and not on every tick.
--
-- `plan_lapsed_at IS NULL` keeps the sweep proportional: once a workspace is marked it
-- stops appearing, so a long dunning cycle is not re-written every minute.
--
-- free is excluded because a free plan cannot lapse (there is nothing to fail to pay) and
-- self_hosted because a cloud billing row has no business narrowing an install somebody
-- runs themselves — entitlement.New honours the flag on every plan but free, so a stray
-- timestamp there would quietly put a self-hoster's writes under the free caps, which is
-- the one symptom in this product nobody would think to trace to billing.
--
-- name: ListSubscriptionsPastDueBeyondGrace :many
SELECT s.workspace_id
FROM subscription s
JOIN workspace w ON w.id = s.workspace_id
WHERE w.deleted_at IS NULL
  AND w.plan_lapsed_at IS NULL
  AND w.plan NOT IN ('free', 'self_hosted')
  AND s.status = 'past_due'
  AND s.current_period_end IS NOT NULL
  AND s.current_period_end < sqlc.arg(cutoff)::timestamptz
ORDER BY s.current_period_end;

-- ListSubscriptionsRecoveredFromLapse names the workspaces whose lapse should be lifted.
--
-- It requires a subscription row rather than clearing every lapsed workspace it can find.
-- A workspace marked lapsed with no billing record is not something this job knows anything
-- about — a support script, a migration, a hand-written deal — and "recovering" it would be
-- this job silently granting a paid plan it has no evidence for.
--
-- name: ListSubscriptionsRecoveredFromLapse :many
SELECT s.workspace_id
FROM subscription s
JOIN workspace w ON w.id = s.workspace_id
WHERE w.deleted_at IS NULL
  AND w.plan_lapsed_at IS NOT NULL
  AND (
    s.status <> 'past_due'
    OR s.current_period_end IS NULL
    OR s.current_period_end >= sqlc.arg(cutoff)::timestamptz
  )
ORDER BY s.workspace_id;

-- ApplyWorkspacePlan is the one statement in the product that sets a workspace's plan.
--
-- seat_limit and plan_expires_at are assigned outright rather than COALESCEd onto what is
-- already there, because billing states the whole truth on every apply: a subscription that
-- stops pinning seats has to be able to say so, and a COALESCE would make "no override" an
-- unsayable value that leaves last quarter's deal in place forever.
--
-- plan_lapsed_at is the exception, and only ever cleared here — never set. Clearing on a
-- healthy subscription is what makes a recovered payment restore writes immediately instead
-- of at the next tick of the lapse job; setting it is that job's business, because it is the
-- only thing that knows how long past due the account has been.
--
-- name: ApplyWorkspacePlan :one
UPDATE workspace
SET plan            = sqlc.arg(plan),
    seat_limit      = sqlc.narg(seat_limit),
    plan_expires_at = sqlc.narg(plan_expires_at),
    plan_lapsed_at  = CASE WHEN sqlc.arg(clear_lapsed)::boolean THEN NULL
                           ELSE plan_lapsed_at END
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING id, name, url_key, logo_url, settings, plan,
          archived_at, deleted_at, created_at, updated_at,
          plan_expires_at, seat_limit, plan_lapsed_at,
          project_update_reminder_interval_days, project_update_reminder_weekday,
          project_update_reminder_hour, pulse_enabled, pulse_digest_cadence,
          customer_requests_enabled, customer_default_team_id, customer_revenue_unit,
          customer_tiers;

-- MarkWorkspacePlanLapsed and ClearWorkspacePlanLapsed both restate the condition the
-- listing query already checked. That is what makes the job idempotent under concurrency:
-- two workers sweeping at once, or one sweeping while a webhook applies a recovery, and the
-- loser writes nothing and gets pgx.ErrNoRows rather than overwriting the winner's answer
-- with a stale one. It also keeps the lapse timestamp honest — it records the first sweep
-- that found the workspace past grace, not the most recent one, so "lapsed since" does not
-- reset itself every hour.
--
-- name: MarkWorkspacePlanLapsed :one
UPDATE workspace
SET plan_lapsed_at = sqlc.arg(lapsed_at)
WHERE id = sqlc.arg(id)
  AND deleted_at IS NULL
  AND plan_lapsed_at IS NULL
  AND plan NOT IN ('free', 'self_hosted')
RETURNING id, name, url_key, logo_url, settings, plan,
          archived_at, deleted_at, created_at, updated_at,
          plan_expires_at, seat_limit, plan_lapsed_at,
          project_update_reminder_interval_days, project_update_reminder_weekday,
          project_update_reminder_hour, pulse_enabled, pulse_digest_cadence,
          customer_requests_enabled, customer_default_team_id, customer_revenue_unit,
          customer_tiers;

-- name: ClearWorkspacePlanLapsed :one
UPDATE workspace
SET plan_lapsed_at = NULL
WHERE id = sqlc.arg(id)
  AND deleted_at IS NULL
  AND plan_lapsed_at IS NOT NULL
RETURNING id, name, url_key, logo_url, settings, plan,
          archived_at, deleted_at, created_at, updated_at,
          plan_expires_at, seat_limit, plan_lapsed_at,
          project_update_reminder_interval_days, project_update_reminder_weekday,
          project_update_reminder_hour, pulse_enabled, pulse_digest_cadence,
          customer_requests_enabled, customer_default_team_id, customer_revenue_unit,
          customer_tiers;
