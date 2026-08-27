-- The trigger goes with the table; the function has to be named separately because it is a
-- schema-level object rather than a property of the table.
DROP TABLE IF EXISTS audit_log;
DROP FUNCTION IF EXISTS audit_log_refuse_update();
