-- A user is an account's presence inside one workspace. Name, avatar and role are
-- per-workspace on purpose: people present differently at different companies, and the
-- role certainly differs.

CREATE TABLE "user" (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  -- NULL for agents/app users, which are users for display purposes but have no login.
  account_id   uuid REFERENCES account(id) ON DELETE SET NULL,

  name         text NOT NULL,
  display_name text NOT NULL,
  avatar_url   text,
  timezone     text NOT NULL DEFAULT 'UTC',

  -- 'owner' exists only on Enterprise; on Free everyone is effectively admin. The
  -- entitlement service decides what a role may *do* — this column only records it.
  role         text NOT NULL DEFAULT 'member',
  status       text NOT NULL DEFAULT 'active',

  -- Distinguishes humans from agent installations. Agents are not billable and cannot
  -- sign in. Modelled here rather than in a separate table so that assignee, actor,
  -- mention and subscriber all keep a single foreign key target.
  kind         text NOT NULL DEFAULT 'human',

  last_seen_at timestamptz,
  archived_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_role_check   CHECK (role IN ('owner', 'admin', 'member', 'guest')),
  CONSTRAINT user_status_check CHECK (status IN ('active', 'suspended')),
  CONSTRAINT user_kind_check   CHECK (kind IN ('human', 'app')),
  -- Agents never have a login. Humans normally do, but the column stays nullable: GDPR
  -- erasure detaches the account and anonymises the user row while keeping their issues,
  -- comments and history intact. Requiring an account here would make erasure impossible
  -- without deleting the work.
  CONSTRAINT user_app_has_no_account CHECK (kind <> 'app' OR account_id IS NULL)
);

-- One membership per account per workspace.
CREATE UNIQUE INDEX user_workspace_account_key
  ON "user" (workspace_id, account_id) WHERE account_id IS NOT NULL;

CREATE INDEX user_workspace_idx ON "user" (workspace_id) WHERE archived_at IS NULL;
CREATE INDEX user_account_idx   ON "user" (account_id)   WHERE account_id IS NOT NULL;
-- Display names are searched in the assignee picker on every keystroke.
CREATE INDEX user_display_name_trgm ON "user" USING gin (display_name gin_trgm_ops);

CREATE TRIGGER user_set_updated_at
  BEFORE UPDATE ON "user"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
