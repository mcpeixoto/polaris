docs/07-milestones/09-documents-v1.md
# Documents v1

**Goal:** teams and projects can hold long-form markdown — runbooks, specs, meeting notes — with the same sync path as everything else.

This is inventory 6.2 scoped down: markdown body, no Yjs, no version history, no inline comments, no templates. Collaborative editing stays a later slice.

---

## What stays true

**gqlgen still rewrites `schema.resolvers.go`.** Helpers stay in `domain/documents.go`.

**The replica is the read path.** Documents are `OpUpsert` / `OpDelete` on the change stream. Client schema is 9 because a v8 replica has no object store for them.

**Archive is a delete on the stream**, same as issues: archived rows leave the bootstrap snapshot.

---

## Schema

`document`: team_id (always), optional project_id, title, body, sort_order, creator, updated_by, archived_at, deleted_at.

Team documents have `project_id` null. Project documents denormalise `team_id` from the project's first team for scope.

---

## Done criterion

> Create "Runbook" on ENG from `/team/ENG/documents`, edit the body, reload — the title and markdown are still there. Archive removes it from the list; delete soft-deletes it.
