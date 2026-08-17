ALTER TABLE workspace
  DROP CONSTRAINT IF EXISTS workspace_seat_limit_positive,
  DROP COLUMN IF EXISTS plan_lapsed_at,
  DROP COLUMN IF EXISTS seat_limit,
  DROP COLUMN IF EXISTS plan_expires_at;

DROP TABLE IF EXISTS api_key;
