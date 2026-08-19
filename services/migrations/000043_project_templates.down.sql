ALTER TABLE project DROP COLUMN IF EXISTS project_template_id;

DROP TABLE IF EXISTS project_template_issue;
DROP TABLE IF EXISTS project_template_milestone;
DROP TABLE IF EXISTS project_template;
