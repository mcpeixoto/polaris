-- Shared primitives. Nothing product-specific lives here.

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_bytes, gen_random_uuid
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- trigram search on titles/names

-- UUIDv7: time-ordered, so index locality is good and the change log is naturally
-- sorted by creation. Application code generates these in Go (google/uuid NewV7);
-- this function exists so seeds, fixtures and manual SQL can do the same thing.
--
-- Layout: 48 bits unix_ts_ms | 4 bits version (0111) | 12 bits rand | 2 bits variant (10) | 62 bits rand
CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid
LANGUAGE plpgsql VOLATILE PARALLEL SAFE
AS $$
DECLARE
  ts_ms   bigint := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  bytes   bytea  := gen_random_bytes(16);
BEGIN
  -- First 6 bytes: big-endian milliseconds. int8send gives 8 bytes; drop the top 2.
  bytes := overlay(bytes PLACING substring(int8send(ts_ms) FROM 3 FOR 6) FROM 1 FOR 6);
  -- Byte 6 high nibble = version 7.
  bytes := set_byte(bytes, 6, (get_byte(bytes, 6) & 15) | 112);
  -- Byte 8 top two bits = variant 10.
  bytes := set_byte(bytes, 8, (get_byte(bytes, 8) & 63) | 128);
  RETURN encode(bytes, 'hex')::uuid;
END;
$$;

-- Every table with updated_at gets this trigger. Doing it in the database rather than
-- in Go means a manual UPDATE during an incident cannot silently leave updated_at stale,
-- which would make the row invisible to incremental reindex jobs.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
