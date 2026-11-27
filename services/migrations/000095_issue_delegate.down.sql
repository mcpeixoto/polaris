DELETE FROM agent_session WHERE origin = 'delegation';
ALTER TABLE agent_session DROP CONSTRAINT agent_session_origin;
ALTER TABLE agent_session
  ADD CONSTRAINT agent_session_origin CHECK (origin IN ('chat', 'comment'));
DROP TABLE agent_runner;
DROP TABLE agent_run;
DROP INDEX issue_delegate_idx;
ALTER TABLE issue DROP COLUMN delegate_id;
