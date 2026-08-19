# Initiatives v1

**Goal:** workspace objectives that manually group projects — list, overview, curated membership — on the sync stream.

This is inventory 5.13 scoped down: status, priority, owner, lead team, target date, description, and project links. Initiative labels, updates, health roll-up and sub-initiatives stay later slices.

---

## What stays true

**gqlgen still rewrites `schema.resolvers.go`.** Helpers stay in `domain/initiatives.go`.

**The replica is the read path.** Initiatives and `initiativeProject` rows are `OpUpsert` / `OpDelete` on the change stream. Client schema is 10 because a v9 replica has no object stores for them.

**Archive is a delete on the stream**, same as projects: archived initiatives leave the bootstrap snapshot.

**Private lead teams** use `TeamScope(private=true)` — only that team's members receive the initiative on bootstrap and deltas.

---

## Schema

`initiative`: workspace_id, name, description, status (proposed/planned/active/completed/canceled), priority, owner_id, lead_team_id, target_date + granularity, sort_order, creator, archived_at, deleted_at.

`initiative_project`: initiative_id, project_id — individual rows, not a set column.

---

## Done criterion

> Create "Platform reliability" from `/initiatives`, open its overview, edit the description, link a project, reload — the initiative, body and project list are still there. Archive removes it from the list.
