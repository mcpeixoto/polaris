ALTER TABLE workspace
  DROP COLUMN IF EXISTS customer_tiers,
  DROP COLUMN IF EXISTS customer_revenue_unit,
  DROP COLUMN IF EXISTS customer_default_team_id,
  DROP COLUMN IF EXISTS customer_requests_enabled;
