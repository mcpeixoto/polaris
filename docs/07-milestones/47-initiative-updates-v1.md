# Initiative updates v1

**Goal:** status posts on initiatives — health plus markdown body — composed from Overview,
history on Activity, initiative health and active-project colours on the list. Inventory
5.14 scoped down.

Reminders, Slack distribution, auto progress summaries, including project/sub-initiative
updates in the feed, labels and sub-initiatives stay later slices.

---

## What stays true

**Health is not stored on the initiative row.** It is derived from the latest live
`initiativeUpdate` in the replica, same as project updates.

**gqlgen still rewrites `schema.resolvers.go`.** Helpers stay in `domain/initiative_updates.go`.

**The replica is the read path.** `initiativeUpdate` rows are `OpUpsert` / `OpDelete` on the
change stream with the initiative's scope. Client schema is **48** because a v47 replica has
no object store for them.

**Editing is author-only**, like project updates — admins may delete but not rewrite someone
else's words.

---

## Schema

`initiative_update`: workspace_id, initiative_id, health (`on_track` / `at_risk` /
`off_track`), body, author_id, edited_at, deleted_at.

Bootstrap streams `initiativeUpdate` after `initiativeProject` and before `projectUpdate`.

---

## UI

- `/initiative/:id` — Overview (latest update, compose form, properties, description, projects)
- `/initiative/:id/activity` — chronological update history
- `/initiatives` — Initiative Health from the latest update; Active Projects as colour-coded
  dots of each linked project's latest update (green on track, yellow at risk, red off track,
  grey no current update)

---

## Done criterion

> Open an initiative, post an "At risk" update from Overview, switch to Activity — the post
> is there. Reload — health badge on the shell and on `/initiatives` still show At risk. A
> linked project's update colours the Active Projects column. Edit as another member fails;
> edit as author succeeds.
