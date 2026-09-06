-- Dynamic client registration (RFC 7591), which is what "connect Polaris" costs in an MCP
-- client. Without it, connecting means a person generating an API key in settings and
-- pasting it into a config file; with it, the client registers itself and the only thing
-- the person sees is the consent screen they were going to see anyway.
--
-- A dynamically registered client has no owner. It is not somebody's OAuth application:
-- nobody in any workspace filled in a form to create it, and the workspace it ends up
-- acting in is decided later, by whoever consents. Modelling that as a row owned by an
-- arbitrary workspace would put a client in one workspace's application list that another
-- workspace's tokens depend on, and make "revoke this app" mean something different
-- depending on who clicked it. So the owner columns go null, and the check constraint
-- below makes "no owner" and "registered itself" the same fact rather than two that can
-- drift apart.
ALTER TABLE oauth_application ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE oauth_application ALTER COLUMN creator_id DROP NOT NULL;

ALTER TABLE oauth_application
  ADD COLUMN dynamically_registered boolean NOT NULL DEFAULT false;

-- Written on every successful token exchange. It exists so the worker can expire clients
-- nobody came back for: registration is unauthenticated, so the table is append-only from
-- the outside and needs a sweep, and "last used" is the only signal that separates a live
-- editor install from a scan.
ALTER TABLE oauth_application ADD COLUMN last_used_at timestamptz;

ALTER TABLE oauth_application ADD CONSTRAINT oauth_application_owner_shape CHECK (
  (dynamically_registered AND workspace_id IS NULL AND creator_id IS NULL)
  OR (NOT dynamically_registered AND workspace_id IS NOT NULL AND creator_id IS NOT NULL)
);

-- The sweep's read.
CREATE INDEX oauth_application_dynamic_idle_idx
  ON oauth_application (last_used_at NULLS FIRST)
  WHERE dynamically_registered AND archived_at IS NULL;
