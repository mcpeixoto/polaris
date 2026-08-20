-- Customers are external organisations; customer_request attaches their feedback to an
-- issue and/or a project. Domain uniqueness is workspace-wide so two rows cannot claim
-- acme.com. customer_domain is a uniqueness helper, not a replica entity — the replica
-- carries customer.domains.

CREATE TABLE customer (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,

  name          text NOT NULL,
  domains       text[] NOT NULL DEFAULT '{}',
  revenue       integer,
  size          integer,
  tier          text,
  -- active / prospect / churned
  status        text NOT NULL DEFAULT 'active',
  owner_id      uuid REFERENCES "user"(id) ON DELETE SET NULL,
  logo_url      text NOT NULL DEFAULT '',
  creator_id    uuid REFERENCES "user"(id) ON DELETE SET NULL,

  sort_order    text COLLATE "C" NOT NULL,

  archived_at   timestamptz,
  deleted_at    timestamptz,
  deleted_by    uuid REFERENCES "user"(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT customer_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT customer_status_check
    CHECK (status IN ('active', 'prospect', 'churned')),
  CONSTRAINT customer_revenue_non_negative CHECK (revenue IS NULL OR revenue >= 0),
  CONSTRAINT customer_size_non_negative CHECK (size IS NULL OR size >= 0)
);

CREATE INDEX customer_workspace_live_idx
  ON customer (workspace_id, sort_order)
  WHERE deleted_at IS NULL AND archived_at IS NULL;

CREATE TRIGGER customer_set_updated_at
  BEFORE UPDATE ON customer
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE customer_domain (
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  domain        text NOT NULL,
  customer_id   uuid NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  PRIMARY KEY (workspace_id, domain)
);

CREATE INDEX customer_domain_customer_idx ON customer_domain (customer_id);

-- Feedback attributed to a customer and attached to an issue, a project, or both.
CREATE TABLE customer_request (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  customer_id   uuid REFERENCES customer(id) ON DELETE SET NULL,
  issue_id      uuid REFERENCES issue(id) ON DELETE CASCADE,
  project_id    uuid REFERENCES project(id) ON DELETE CASCADE,
  body          text NOT NULL DEFAULT '',
  important     boolean NOT NULL DEFAULT false,
  creator_id    uuid REFERENCES "user"(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT customer_request_target_chk CHECK (issue_id IS NOT NULL OR project_id IS NOT NULL)
);

CREATE TRIGGER customer_request_set_updated_at
  BEFORE UPDATE ON customer_request
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX customer_request_customer_idx
  ON customer_request (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX customer_request_issue_idx
  ON customer_request (issue_id) WHERE issue_id IS NOT NULL;
CREATE INDEX customer_request_project_idx
  ON customer_request (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX customer_request_workspace_idx ON customer_request (workspace_id);
