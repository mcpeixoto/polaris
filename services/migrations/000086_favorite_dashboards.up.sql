-- Dashboards join the list the sidebar can hold. Separate from 000085 rather than folded
-- into it because that migration has shipped: the constraint is one line, but rewriting a
-- migration somebody has already run is how two databases end up disagreeing about what
-- 000085 did.

ALTER TABLE favorite DROP CONSTRAINT favorite_kind_check;
ALTER TABLE favorite ADD CONSTRAINT favorite_kind_check
  CHECK (kind IN ('view', 'team', 'issue', 'label', 'folder',
                  'project', 'initiative', 'cycle', 'document', 'dashboard'));
