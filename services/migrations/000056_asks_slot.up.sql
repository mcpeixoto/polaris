-- Placeholder so a fresh install can walk 55 → 56 → 57 without a hole.
--
-- Asks v1 was developed as 000056 in parallel with GitLab 000057. GitLab
-- landed first, so databases already at 57 would never run a 000056 that
-- arrived later. The ask_form table is therefore 000059.

SELECT 1;
