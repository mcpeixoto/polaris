-- Nothing to undo, and deliberately nothing.
--
-- The up migration seeds cursor rows; it does not create the table or change its shape. A
-- down that deleted them would not restore the previous state, it would invent a worse one:
-- an absent cursor reads as version 0, so rolling back would arm the fan-out to derive an
-- inbox row for every event in every workspace's entire history — the exact outcome the up
-- migration exists to prevent, delivered by the command somebody runs to undo it.
SELECT 1;
