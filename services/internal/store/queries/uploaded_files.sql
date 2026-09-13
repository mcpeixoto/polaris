-- name: CreateUploadedFile :one
INSERT INTO uploaded_file (
  id, workspace_id, creator_id, storage_key, content_type, byte_size,
  original_name, sha256, download_token
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9
)
RETURNING id, workspace_id, creator_id, storage_key, content_type, byte_size,
          original_name, sha256, download_token, created_at;

-- name: GetUploadedFile :one
SELECT id, workspace_id, creator_id, storage_key, content_type, byte_size,
       original_name, sha256, download_token, created_at
FROM uploaded_file
WHERE id = $1;

-- name: GetUploadedFileBySHA :one
SELECT id, workspace_id, creator_id, storage_key, content_type, byte_size,
       original_name, sha256, download_token, created_at
FROM uploaded_file
WHERE workspace_id = sqlc.arg(workspace_id) AND sha256 = sqlc.arg(sha256);
