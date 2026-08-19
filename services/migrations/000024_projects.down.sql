DROP TRIGGER IF EXISTS issue_milestone_matches_project_check ON issue;
DROP FUNCTION IF EXISTS issue_milestone_matches_project();

ALTER TABLE issue
  DROP COLUMN IF EXISTS project_milestone_id,
  DROP COLUMN IF EXISTS project_id;

DROP TABLE IF EXISTS project_milestone;
DROP TABLE IF EXISTS project_member;
DROP TABLE IF EXISTS project_team;
DROP TABLE IF EXISTS project;
DROP TABLE IF EXISTS project_status;
