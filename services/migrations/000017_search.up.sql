-- Full-text search, and the diacritic folding that both search and the filter grammar
-- depend on.

-- ---------------------------------------------------------------------------------------
-- Folding.
--
-- Somebody typing "acao" is looking for "Ação". They are not asking for a different issue,
-- and a product used across the EU cannot treat them as if they were.
--
-- ONE folding function, used by the search vectors below and by the filter compiler's
-- `contains` operator. Two different foldings would mean a search and a saved view typed
-- with the same words return different issues — the exact class of bug the single filter
-- grammar exists to prevent.
--
-- Two things here are load-bearing and both were arrived at by the migration failing:
--
--   1. `public.unaccent` is schema-qualified, and the folding is done in ONE function
--      rather than a readable pair (an immutable_unaccent wrapper plus a lower() on top).
--      A migration file reaches the server as a single query batch, and the planner
--      inlines a SQL function at first use — at which point an unqualified reference to
--      another function created earlier in the same batch does not resolve, and the
--      migration fails with "function does not exist" pointing at a function that plainly
--      does. Qualifying and flattening removes the lookup entirely.
--   2. `'public.unaccent'::regdictionary` names the dictionary explicitly, which is what
--      lets this be declared IMMUTABLE at all. The bare unaccent(text) is STABLE, and
--      Postgres refuses a STABLE function in an index expression.
--
-- The honest caveat on that IMMUTABLE: it is a promise about a file on disk. A
-- major-version upgrade can ship a different unaccent.rules, and the indexes below would
-- then be subtly wrong — entries folded by the old rules, queries by the new. The
-- mitigation is a REINDEX after a major upgrade, and it belongs in the upgrade runbook
-- rather than in a comment nobody reads at 2am. Recorded here because the alternative is a
-- function that silently claims more than it can deliver.
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION search_fold(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, $1)) $$;

-- ---------------------------------------------------------------------------------------
-- The searchable text of an issue, as a function rather than a stored generated column.
--
-- A generated column is the textbook answer and was the first version here. It was removed
-- for a reason worth stating: sqlc reads the table and maps `tsvector` to `interface{}`,
-- so a stored column puts an untyped field in the generated model of the busiest table in
-- the product — and every query whose RETURNING list omits it stops matching that model,
-- which turns one added column into a per-query row struct for every read and write of
-- issues and comments. The search path is the only thing that wants this value; making the
-- rest of the codebase carry an `interface{}` for it is the tail wagging the dog.
--
-- As a function it is still exactly one definition, still indexed, and the planner matches
-- the expression index whenever a query calls it the same way. The cost is that callers
-- must write `issue_search_vector(title, description)` rather than `search_vector`; the
-- benefit is that the model of `issue` is the model of `issue`.
--
-- The dictionary is 'simple', not 'english', and that is a deliberate trade. 'english'
-- stems and drops stopwords, so "running" finds "run" — a real gain for an English corpus.
-- It is also actively wrong for every other language: a German or Portuguese workspace gets
-- its words stemmed by English rules, and the words that get mangled are exactly the domain
-- terms people search for. Polaris is EU-first and its workspaces are multilingual,
-- frequently within one issue. 'simple' over folded text, plus prefix matching, plus the
-- trigram indexes below, covers what issue search is actually for — finding the issue you
-- half-remember the title of — in every language, and never returns a confidently wrong
-- stem. A per-workspace dictionary is the eventual answer and waits for a real relevance
-- complaint rather than being guessed at now.
CREATE OR REPLACE FUNCTION issue_search_vector(title text, description text) RETURNS tsvector
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT setweight(to_tsvector('simple', public.search_fold(coalesce(title, ''))), 'A') ||
         setweight(to_tsvector('simple', public.search_fold(coalesce(description, ''))), 'B')
$$;

CREATE OR REPLACE FUNCTION comment_search_vector(body text) RETURNS tsvector
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT to_tsvector('simple', public.search_fold(coalesce(body, ''))) $$;

CREATE INDEX issue_search_idx ON issue
  USING gin (issue_search_vector(title, description));

CREATE INDEX comment_search_idx ON comment
  USING gin (comment_search_vector(body));

-- The filter grammar's `contains` operator, which is a substring match rather than a word
-- match and therefore cannot use the vectors above.
--
-- Without these, folding turns every `contains` clause into a sequential scan — and the
-- filter is evaluated on the server for search and for exports, over workspaces the client
-- has not replicated. The trigram index on raw title from migration 000007 does not serve a
-- folded query: the folded expression is what has to be indexed.
CREATE INDEX issue_title_folded_trgm ON issue USING gin (search_fold(title) gin_trgm_ops);
CREATE INDEX issue_description_folded_trgm ON issue USING gin (search_fold(description) gin_trgm_ops);

-- Search ranks by relevance and then recency, and filters to what the caller may see. The
-- visibility filter is the same authz.Visible predicate every other read path uses, so this
-- index only has to make the candidate set cheap.
CREATE INDEX issue_search_recency_idx ON issue (workspace_id, updated_at DESC)
  WHERE archived_at IS NULL AND deleted_at IS NULL;
