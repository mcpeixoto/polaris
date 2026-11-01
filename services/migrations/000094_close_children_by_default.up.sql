-- Closing a parent closes its sub-issues unless a team opts out. The column has been false
-- since 000027 and the setting sat three screens deep, so to everyone using the product the
-- cascade simply did not exist. Existing teams are turned on as well: false cannot tell
-- "never looked at it" from "turned it off", and nearly every row is the former.

ALTER TABLE team
  ALTER COLUMN auto_close_children SET DEFAULT true;

UPDATE team SET auto_close_children = true;
