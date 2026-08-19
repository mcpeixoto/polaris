ALTER TABLE issue DROP COLUMN IF EXISTS form_template_id;

DROP TABLE IF EXISTS form_template_field;
DROP TABLE IF EXISTS form_template;
