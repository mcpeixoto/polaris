DROP TABLE IF EXISTS initiative_relation;
DROP TABLE IF EXISTS initiative_label_link;
DROP TRIGGER IF EXISTS initiative_label_parent_integrity_check ON initiative_label;
DROP TRIGGER IF EXISTS initiative_label_group_propagate_update ON initiative_label;
DROP FUNCTION IF EXISTS initiative_label_parent_integrity();
DROP FUNCTION IF EXISTS initiative_label_link_denormalise();
DROP FUNCTION IF EXISTS initiative_label_group_propagate();
DROP TABLE IF EXISTS initiative_label;
