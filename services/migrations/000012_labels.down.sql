DROP TRIGGER IF EXISTS label_group_propagate_update ON label;
DROP FUNCTION IF EXISTS label_group_propagate();
DROP TRIGGER IF EXISTS issue_label_denormalise_write ON issue_label;
DROP FUNCTION IF EXISTS issue_label_denormalise();
DROP TABLE IF EXISTS issue_label;
DROP TRIGGER IF EXISTS label_parent_integrity_check ON label;
DROP FUNCTION IF EXISTS label_parent_integrity();
DROP TABLE IF EXISTS label;
