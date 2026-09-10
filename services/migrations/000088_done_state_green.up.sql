-- Done is green.
--
-- Every workspace seeded before this migration got its completed states in the source
-- product's indigo accent, '#5e6ad2'. Both clients prefer a state's stored colour over the
-- category token, so recolouring the palette alone changes nothing for an existing
-- workspace — the row keeps drawing the disc in the accent, which is the one colour the
-- product uses for everything else on that row.
--
-- Only rows still holding the untouched default move. A team that opened team settings and
-- picked a colour chose it, and the equality check on '#5e6ad2' is what tells the two
-- apart: nobody who deliberately set a completed state to the accent is distinguishable
-- from someone who never touched it, and defaulting in their favour would silently discard
-- a real decision, so the untouched default is the only safe set to rewrite.
--
-- project_status moves with workflow_state because the two render through the same glyph:
-- a project's "Completed" status and an issue's "Done" state are both the disc and check
-- from StateIcon, and leaving one indigo would put both colours of the same mark on one
-- screen.

UPDATE workflow_state
   SET color = '#188a55'
 WHERE category = 'completed'
   AND lower(color) = '#5e6ad2';

UPDATE project_status
   SET color = '#188a55'
 WHERE category = 'completed'
   AND lower(color) = '#5e6ad2';
