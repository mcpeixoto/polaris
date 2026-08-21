DROP TRIGGER IF EXISTS workspace_url_alias_not_live_check ON workspace_url_alias;
DROP FUNCTION IF EXISTS workspace_url_alias_not_live();
DROP TRIGGER IF EXISTS workspace_url_key_not_reserved_check ON workspace;
DROP FUNCTION IF EXISTS workspace_url_key_not_reserved();
DROP TABLE IF EXISTS workspace_url_alias;
