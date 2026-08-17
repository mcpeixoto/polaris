-- Give every existing workspace a fan-out cursor at its current version.
--
-- The fan-out reads `notification_cursor` and treats a missing row as version 0 — which is
-- correct for a workspace created after this, and catastrophic for one created before it.
-- Until now nothing scheduled the fan-out at all (domain.Service.FanOut had no caller
-- outside its own tests), so every workspace in every existing install has a change_log
-- going back to its creation and no cursor. The first pass would have derived an inbox row
-- for every assignment, mention, comment and status change in that history and delivered
-- them all at once, dated today.
--
-- The alternative — starting from 0 and letting people mark it all read — is not a smaller
-- version of the same thing. An inbox arriving with a thousand rows about work that closed
-- weeks ago is not a backlog, it is a reason to stop opening the inbox, and there is no
-- second chance at somebody's first impression of a feature.
--
-- So history is skipped exactly once, here, where it is visible. Everything committed from
-- this migration onwards is fanned out normally.
--
-- ON CONFLICT DO NOTHING because a workspace may already have a cursor: the fan-out has
-- always been callable, the tests call it, and a developer who ran it by hand should keep
-- the position they have rather than have it silently moved forward.
INSERT INTO notification_cursor (workspace_id, version)
SELECT workspace_id, version FROM workspace_version
ON CONFLICT (workspace_id) DO NOTHING;
