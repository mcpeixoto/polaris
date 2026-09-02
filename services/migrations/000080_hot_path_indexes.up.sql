-- The indexes under the screens people actually open.
--
-- Each of these sits beneath a query with no LIMIT, so a missing index is not a slow index
-- scan — it is a sequential scan of the table plus a sort node, on the read path a user
-- waits for. They are grouped into one migration because they are one finding: the index
-- set drifted from the query set as views were added, and adding them one at a time buries
-- that in the history.

-- The hottest read in the product: the team board.
--
-- ListIssuesForTeam is `WHERE team_id = $1 AND archived_at IS NULL AND deleted_at IS NULL
-- ORDER BY sort_order`. The only candidate was issue_team_state_sort_idx
-- (team_id, state_id, sort_order): with state_id unconstrained it yields rows in
-- (state_id, sort_order) order, so the planner reads the whole team and then sorts it.
-- Partial on the same predicate the query carries, so an archived or deleted issue costs
-- the board nothing.
CREATE INDEX issue_team_sort_idx ON issue (team_id, sort_order)
  WHERE archived_at IS NULL AND deleted_at IS NULL;

-- "My Issues", which every user opens on every session.
--
-- ListMyIssues is `ORDER BY updated_at DESC, id`; issue_assignee_idx is
-- (workspace_id, assignee_id) with no third column, so the sort was always a sort node.
-- docs/05-infrastructure/04-data-layer.md asked for exactly this index and it was never
-- built. The id tiebreak matches the query's, so the whole ORDER BY comes off the index.
CREATE INDEX issue_assignee_updated_idx
  ON issue (workspace_id, assignee_id, updated_at DESC, id DESC)
  WHERE archived_at IS NULL AND deleted_at IS NULL AND assignee_id IS NOT NULL;

-- issue_assignee_idx is a prefix of the index above, so it is now dead weight: a second
-- copy of the same leading columns to maintain on every issue write.
--
-- It is NOT dropped here. The old index answers `assignee_id = $1` for archived and
-- deleted rows too, and proving nothing depends on that is a bigger change than one
-- migration should carry. Left as a deliberate note rather than a silent duplication.

-- The archive screen.
--
-- ListArchivedIssuesForTeam wants exactly the rows every other partial index on this table
-- excludes: every team_id-leading index carries WHERE archived_at IS NULL. 000021 fixed
-- this for the trash and not for the archive.
CREATE INDEX issue_archived_idx ON issue (team_id, archived_at DESC)
  WHERE archived_at IS NOT NULL AND deleted_at IS NULL;

-- "Created by" is a first-class field in the filter grammar and creator_id is an
-- unindexed foreign key, so both that view and every user deletion scanned the table.
CREATE INDEX issue_creator_idx ON issue (workspace_id, creator_id)
  WHERE creator_id IS NOT NULL AND archived_at IS NULL AND deleted_at IS NULL;

-- notification.issue_id and .comment_id are ON DELETE CASCADE with no index leading on
-- them, which means Postgres sequentially scans `notification` on EVERY issue delete and
-- EVERY comment delete — on the one table in the product with unbounded growth and no
-- prune job. ListNotificationsForIssue reads the same way, once per restored issue.
--
-- Partial: most notifications name neither, and an index entry per row would double the
-- table's write cost to serve the rows that do.
CREATE INDEX notification_issue_idx   ON notification (issue_id)   WHERE issue_id IS NOT NULL;
CREATE INDEX notification_comment_idx ON notification (comment_id) WHERE comment_id IS NOT NULL;

-- ListFavoritesForTarget asks by (workspace_id, kind, target_id) — the restore path does it
-- once per restored issue — and every index on favorite leads with user_id.
CREATE INDEX favorite_target_idx ON favorite (workspace_id, kind, target_id);

-- Two nightly retention deletes with no index on the column they delete by, so each is a
-- full scan: webhook_delivery is written once per mutation per webhook, and change_log is
-- the highest-write table in the system.
--
-- change_log is partitioned, so this creates the index on every partition and on the ones
-- EnsureChangeLogPartitions makes later. It is a stopgap: the retention design in
-- 000010's own comment is DETACH + DROP, which needs no index at all.
CREATE INDEX webhook_delivery_created_at_idx ON webhook_delivery (created_at);
CREATE INDEX change_log_created_at_idx ON change_log (created_at);

-- audit_log has no prune job yet and a customer-facing 90-day retention claim. The index
-- is what makes writing that job a bounded delete rather than a nightly full scan.
CREATE INDEX audit_log_created_at_idx ON audit_log (created_at);
