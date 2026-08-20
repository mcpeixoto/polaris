DROP TABLE IF EXISTS inbound_email;

ALTER TABLE issue_template
  DROP COLUMN IF EXISTS email_intake_enabled,
  DROP COLUMN IF EXISTS email_intake_token,
  DROP COLUMN IF EXISTS email_intake_address;

ALTER TABLE team
  DROP COLUMN IF EXISTS email_intake_enabled,
  DROP COLUMN IF EXISTS email_intake_token,
  DROP COLUMN IF EXISTS email_intake_address;
