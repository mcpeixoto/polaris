DROP TRIGGER IF EXISTS issue_relation_denormalise_write ON issue_relation;
DROP FUNCTION IF EXISTS issue_relation_denormalise();
DROP TABLE IF EXISTS issue_relation;

DROP TRIGGER IF EXISTS issue_parent_acyclic_check ON issue;
DROP FUNCTION IF EXISTS issue_parent_acyclic();

DROP INDEX IF EXISTS issue_due_date_idx;
DROP INDEX IF EXISTS issue_parent_idx;

ALTER TABLE issue
  DROP CONSTRAINT IF EXISTS issue_not_own_parent,
  DROP CONSTRAINT IF EXISTS issue_due_date_source_check,
  DROP CONSTRAINT IF EXISTS issue_estimate_check,
  DROP COLUMN IF EXISTS sub_issue_sort_order,
  DROP COLUMN IF EXISTS parent_id,
  DROP COLUMN IF EXISTS due_date_source,
  DROP COLUMN IF EXISTS due_date,
  DROP COLUMN IF EXISTS estimate;

ALTER TABLE team
  DROP CONSTRAINT IF EXISTS team_estimate_scale_check,
  DROP COLUMN IF EXISTS estimate_extended,
  DROP COLUMN IF EXISTS estimate_allow_zero,
  DROP COLUMN IF EXISTS estimate_scale;
