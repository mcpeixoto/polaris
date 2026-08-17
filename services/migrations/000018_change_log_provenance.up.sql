-- What a mutation touched, and which mutation it belonged to.
--
-- Two facts that only the writer knows, recorded by the writer, because every way of
-- recovering them afterwards is a second definition of what happened — the exact trap this
-- milestone names, arriving one layer down.

-- ---------------------------------------------------------------------------------------
-- changed_fields
--
-- The notification engine has to tell "the assignee changed" from "somebody edited the
-- title of an issue that happens to have an assignee". A change row carries the entity as
-- it is now and says nothing about what moved, so without this the only answer available
-- downstream is to fetch the previous version's payload and diff the two.
--
-- Diffing is wrong in both directions, and quietly. It reports a field as changed because
-- a serialiser started emitting it or because a default moved, and it reports nothing
-- changed when a bulk edit writes the value a row already held — which is still an action
-- somebody took and still something subscribers asked to hear about. The mutation knows
-- exactly which fields it set, it knows for free, and it is the only thing that knows.
--
-- An empty array means "everything is new", i.e. a create. That is why this is NOT NULL
-- with an empty default rather than nullable: NULL would be a third state — "nobody said" —
-- and every reader would have to guess which of the other two it meant, separately, and
-- eventually differently.
--
-- The values are column names (assignee_id, state_id, body), not model field names. The
-- column name is the one identifier for a field that already exists, is unique, and does
-- not change when a serialiser is rewritten. internal/notify declares them as constants;
-- the mutation sites use those constants, so the producer and the consumer of this array
-- share one vocabulary.
--
-- No index. It is read from a row the engine has already found by (workspace_id, version)
-- and is never a predicate. An index here would tax every write in the product for a
-- lookup nobody performs.
ALTER TABLE change_log
  ADD COLUMN changed_fields text[] NOT NULL DEFAULT '{}'::text[];

-- ---------------------------------------------------------------------------------------
-- batch_key
--
-- Which mutation a change belongs to, when one mutation produced many.
--
-- This is the other half of M1 acceptance test 8: a bulk edit of two hundred issues must
-- produce one inbox row per subscriber carrying a count, not two hundred rows. Coalescing
-- happens on notification.group_key, which is derived from this, so the batch's identity
-- has to survive from the mutation to a fan-out that runs afterwards and asynchronously —
-- and the only place it can survive is here, on the rows themselves.
--
-- It is minted by the emitter rather than passed in by call sites: every row emitted in one
-- call to Emit is one thing a person did, which is precisely what a batch is. Deriving it
-- at the choke point means no call site can forget to set it and no call site can invent a
-- different definition of "one action" — the two failure modes that would each show up as
-- two hundred inbox rows for one click.
--
-- NULL for a single-change block, which needs no batch: its group key is its version, and
-- that is already unique.
ALTER TABLE change_log
  ADD COLUMN batch_key text;
