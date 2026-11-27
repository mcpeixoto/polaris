-- Importing a workspace from another tracker.
--
-- One row per import a person started. The worker claims queued jobs the way it claims
-- agent sessions, and records progress per entity so a page reload shows where it is and a
-- crash resumes rather than restarts.
CREATE TABLE import_job (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  source        text NOT NULL,
  status        text NOT NULL DEFAULT 'queued',
  created_by    uuid REFERENCES "user"(id) ON DELETE SET NULL,

  -- {"issue": {"done": 120, "total": 400}, ...}. Display data; the import_link rows are what
  -- the resume reads.
  progress      jsonb NOT NULL DEFAULT '{}'::jsonb,
  error         text,

  -- The source's API key, held only while the job can still run and nulled when it ends.
  -- Never selected by a query that feeds the sync replica or the GraphQL import type.
  api_key       text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT import_job_source CHECK (source IN ('linear')),
  CONSTRAINT import_job_status CHECK (status IN ('queued', 'running', 'done', 'failed')),
  CONSTRAINT import_job_key_only_while_open CHECK (
    status IN ('queued', 'running') OR api_key IS NULL
  )
);

CREATE INDEX import_job_queued_idx ON import_job (created_at) WHERE status = 'queued';
CREATE INDEX import_job_workspace_idx ON import_job (workspace_id, created_at DESC);
CREATE INDEX import_job_created_by_idx ON import_job (created_by) WHERE created_by IS NOT NULL;

-- What each source object became here. Unique per workspace rather than per job, so a second
-- import of the same workspace finds the first one's issues instead of duplicating them.
CREATE TABLE import_link (
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  job_id        uuid NOT NULL REFERENCES import_job(id) ON DELETE CASCADE,
  source        text NOT NULL,
  entity        text NOT NULL,
  external_id   text NOT NULL,
  polaris_id    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (workspace_id, source, entity, external_id),
  CONSTRAINT import_link_entity CHECK (
    entity IN ('team', 'state', 'label', 'user', 'project', 'cycle', 'issue', 'comment')
  )
);

CREATE INDEX import_link_job_idx ON import_link (job_id);

-- A change that syncs but notifies nobody. Four hundred imported issues must reach every
-- client and must not put four hundred rows in anybody's inbox, and only the writer knows
-- which of its changes are the second kind.
ALTER TABLE change_log ADD COLUMN silent boolean NOT NULL DEFAULT false;
