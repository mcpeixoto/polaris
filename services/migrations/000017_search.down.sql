DROP INDEX IF EXISTS issue_search_recency_idx;
DROP INDEX IF EXISTS issue_description_folded_trgm;
DROP INDEX IF EXISTS issue_title_folded_trgm;
DROP INDEX IF EXISTS comment_search_idx;
DROP INDEX IF EXISTS issue_search_idx;
DROP FUNCTION IF EXISTS comment_search_vector(text);
DROP FUNCTION IF EXISTS issue_search_vector(text, text);
DROP FUNCTION IF EXISTS search_fold(text);
