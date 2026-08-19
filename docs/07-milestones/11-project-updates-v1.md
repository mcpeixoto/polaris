# Project updates v1

**Goal:** status posts on projects — health plus markdown body — composed from Overview, history on Activity, health on the project list. Inventory 5.6 scoped down.

Auto progress summaries, Slack sync, reminders/staleness and rich editor stay later slices.

---

## What stays true

**Health is not stored on the project row.** It is derived from the latest live `projectUpdate` in the replica, same as Linear.

**gqlgen still rewrites `schema.resolvers.go`.** Helpers stay in `domain/project_updates.go`.

**The replica is the read path.** `projectUpdate` rows are `OpUpsert` / `OpDelete` on the change stream with `ScopeProject`. Client schema is **11** because a v10 replica has no object store for them.

**Editing is author-only**, like comments — admins may delete but not rewrite someone else's words.

---

## Schema

`project_update`: workspace_id, project_id, health (`on_track` / `at_risk` / `off_track`), body, author_id, edited_at, deleted_at.

Bootstrap streams `projectUpdate` after `initiativeProject` and before `cycle`.

---

## UI

- `/project/:id` — Overview (latest update, compose form, description)
- `/project/:id/issues` — issue list (unchanged behaviour, new tab)
- `/project/:id/activity` — chronological update history
- `/projects` — health column from latest update

---

## Done criterion

> Open a project, post an "At risk" update from Overview, switch to Activity — the post is there. Reload — health badge on the shell and on `/projects` still show At risk. Edit as another member fails; edit as author succeeds.
