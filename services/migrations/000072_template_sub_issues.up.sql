-- Sub-issues a standard template files under the new parent. Titles only: nested
-- templates stay a later slice. Aa placeholder text lives in the body as ⟦prompt⟧
-- marks, so it needs no column.

ALTER TABLE issue_template
  ADD COLUMN sub_issues jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE issue_template
  ADD CONSTRAINT issue_template_sub_issues_is_array
  CHECK (jsonb_typeof(sub_issues) = 'array');
