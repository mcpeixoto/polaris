-- In Progress is light blue. In Review is yellow.
--
-- Both clients paint a status from the colour stored on the row, so the category token
-- cannot tell these two apart: they are both started. The seed used to give In Progress
-- the amber (#f2c94c) that In Review should wear, and a new team had no In Review at all.
--
-- Only an In Progress row still wearing that untouched default moves. A team that opened
-- settings and picked a colour keeps it. The same rewrite covers project_status, because
-- a project's In Progress and an issue's draw the same pie.
--
-- In Review is inserted only where the team has no live status of that name. An existing
-- one keeps its colour: this migration cannot tell a deliberate choice from the absence
-- of one, and inventing a second row would collide with the unique (team, lower(name))
-- index.

UPDATE workflow_state
   SET color = '#56b6d8'
 WHERE category = 'started'
   AND lower(btrim(name)) = 'in progress'
   AND lower(color) = '#f2c94c';

UPDATE project_status
   SET color = '#56b6d8'
 WHERE category = 'started'
   AND lower(btrim(name)) = 'in progress'
   AND lower(color) = '#f2c94c';

INSERT INTO workflow_state (
  id, workspace_id, team_id, name, color, category, position, is_default, is_system
)
SELECT gen_random_uuid(),
       t.workspace_id,
       t.id,
       'In Review',
       '#f2c94c',
       'started',
       COALESCE(
         (SELECT position FROM workflow_state
           WHERE team_id = t.id
             AND archived_at IS NULL
             AND lower(btrim(name)) = 'in progress'
           ORDER BY position
           LIMIT 1),
         (SELECT position FROM workflow_state
           WHERE team_id = t.id
             AND archived_at IS NULL
             AND category = 'started'
           ORDER BY position DESC
           LIMIT 1),
         'V'
       ) || '1',
       false,
       false
  FROM team t
 WHERE NOT EXISTS (
   SELECT 1 FROM workflow_state
    WHERE team_id = t.id
      AND archived_at IS NULL
      AND lower(btrim(name)) = 'in review'
 );
