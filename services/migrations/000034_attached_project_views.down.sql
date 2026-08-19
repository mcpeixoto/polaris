DROP INDEX IF EXISTS view_project_idx;
ALTER TABLE view DROP CONSTRAINT IF EXISTS view_project_scope_check;
ALTER TABLE view DROP COLUMN IF EXISTS project_id;
