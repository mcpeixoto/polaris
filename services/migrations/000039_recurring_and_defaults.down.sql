ALTER TABLE issue DROP COLUMN IF EXISTS recurring_issue_id;

DROP TABLE IF EXISTS recurring_issue;

ALTER TABLE team
  DROP COLUMN IF EXISTS default_template_for_members_id,
  DROP COLUMN IF EXISTS default_template_for_non_members_id;
