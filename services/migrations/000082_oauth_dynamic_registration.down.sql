DROP INDEX IF EXISTS oauth_application_dynamic_idle_idx;
ALTER TABLE oauth_application DROP CONSTRAINT IF EXISTS oauth_application_owner_shape;
DELETE FROM oauth_application WHERE dynamically_registered;
ALTER TABLE oauth_application DROP COLUMN IF EXISTS last_used_at;
ALTER TABLE oauth_application DROP COLUMN IF EXISTS dynamically_registered;
ALTER TABLE oauth_application ALTER COLUMN creator_id SET NOT NULL;
ALTER TABLE oauth_application ALTER COLUMN workspace_id SET NOT NULL;
