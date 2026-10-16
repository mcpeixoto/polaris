-- Put the untouched In Progress default back to amber. In Review stays: it is a legal
-- started status either way, deleting it fails while an issue still points at it, and a
-- rollback that drops a status a team already had is worse than leaving the extra row.

UPDATE workflow_state
   SET color = '#f2c94c'
 WHERE category = 'started'
   AND lower(btrim(name)) = 'in progress'
   AND lower(color) = '#56b6d8';

UPDATE project_status
   SET color = '#f2c94c'
 WHERE category = 'started'
   AND lower(btrim(name)) = 'in progress'
   AND lower(color) = '#56b6d8';
