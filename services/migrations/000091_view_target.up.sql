-- Which list a saved filter is about. The grammar is one AST with two subjects, and a
-- project field in an issue filter is a hard error — so the subject has to be stored with
-- the filter, or a saved project view cannot be validated on the way back in.
ALTER TABLE view
    ADD COLUMN target text NOT NULL DEFAULT 'issue'
        CHECK (target IN ('issue', 'project'));
