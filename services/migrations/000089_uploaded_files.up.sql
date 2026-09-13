-- Uploaded blobs (screenshots, images) for paste/drop into issues.
--
-- The attachment table stays URL-idempotent link cards. A paste stores bytes here and
-- either inserts a markdown image whose src is /files/{id}?token=…, or creates a link
-- card pointing at the same absolute URL. The download token is the capability: img tags
-- and a new-tab open cannot send a Bearer header, and the access token is not a cookie.

CREATE TABLE uploaded_file (
  id              uuid PRIMARY KEY,
  workspace_id    uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  creator_id      uuid REFERENCES "user"(id) ON DELETE SET NULL,

  storage_key     text NOT NULL,
  content_type    text NOT NULL,
  byte_size       bigint NOT NULL,
  original_name   text NOT NULL DEFAULT '',
  sha256          bytea NOT NULL,
  download_token  text NOT NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uploaded_file_content_type_length CHECK (char_length(content_type) <= 128),
  CONSTRAINT uploaded_file_name_length CHECK (char_length(original_name) <= 512),
  CONSTRAINT uploaded_file_key_length CHECK (char_length(storage_key) <= 1024),
  CONSTRAINT uploaded_file_token_length CHECK (char_length(download_token) = 64),
  CONSTRAINT uploaded_file_size_positive CHECK (byte_size > 0 AND byte_size <= 26214400),
  CONSTRAINT uploaded_file_sha_len CHECK (octet_length(sha256) = 32)
);

-- Same bytes in one workspace share one row: pasting a screenshot twice must not
-- double the disk, and the returned URL stays stable so markdown and link cards agree.
CREATE UNIQUE INDEX uploaded_file_workspace_sha_key
  ON uploaded_file (workspace_id, sha256);

CREATE INDEX uploaded_file_workspace_created_idx
  ON uploaded_file (workspace_id, created_at);
