DROP TABLE IF EXISTS notification_email_cursor;
DROP INDEX IF EXISTS notification_pending_email_idx;
ALTER TABLE notification DROP COLUMN IF EXISTS emailed_at;
