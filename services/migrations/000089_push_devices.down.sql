DROP INDEX IF EXISTS notification_pending_push_idx;
ALTER TABLE notification DROP COLUMN IF EXISTS pushed_at;
DROP TABLE IF EXISTS push_device;
