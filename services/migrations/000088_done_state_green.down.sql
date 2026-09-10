-- Exactly the set the up migration moved: completed rows sitting on the new green. A
-- workspace that has since picked its own green is indistinguishable from one this
-- migration touched, which is the same trade the up direction makes in the other
-- direction and the closest a colour rewrite gets to reversible.

UPDATE workflow_state
   SET color = '#5e6ad2'
 WHERE category = 'completed'
   AND lower(color) = '#188a55';

UPDATE project_status
   SET color = '#5e6ad2'
 WHERE category = 'completed'
   AND lower(color) = '#188a55';
