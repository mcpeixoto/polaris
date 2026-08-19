# Project dependencies v1

**Goal:** end→start links between projects — Blocked by / Blocking on Overview and the properties sidebar, command menu, list filters. Inventory 5.10 scoped down.

Timeline rendering and drag-to-create stay later slices.

---

## What stays true

**One row per direction.** `blocking_project_id` must finish before `blocked_project_id` may start. "Blocked by X" on P means X blocks P; "Blocking Y" on P means P blocks Y.

**Cycle detection is server-side.** The client may attempt a link that would close a loop; the server rejects it.

**Violation is client-computed** from day-level dates in the replica: blocking `targetDate` must be on or before blocked `startDate` (falling back to `targetDate`). Completed blocking projects satisfy their links. Timeline red/blue lines wait for timeline layout.

**Client schema is 12** because a v11 replica has no object store for `projectDependency`.

---

## Schema

`project_dependency`: workspace_id, blocking_project_id, blocked_project_id, unique pair, no self-links.

Bootstrap streams `projectDependency` after `projectUpdate` and before `cycle`.

---

## UI

- `/project/:id` Overview — Dependencies section with add/remove
- Project shell sidebar — compact Blocked by / Blocking (command menu opens the picker)
- `/projects` — filter: all / has dependencies / blocking / blocked-by / violated

---

## Done criterion

> Link project A as blocking project B from Overview. B shows "Blocked by A" and A shows "Blocking B". Filter `/projects` to "Has blocked-by dependency" — B appears. Remove the link — both panels empty. Reload — still empty.
