# Project priority v1

**Goal:** same 5-level scale as issues, `P` to set priority, manual order within each band, drag between bands. Inventory 5.9 scoped down.

---

## What stays true

**No schema bump.** `project.priority` and `project.sort_order` already exist; this slice wires ordering and UI.

**Micro-order is per priority band.** `afterProjectId` only anchors within the target band; cross-band moves set `priority` and append (or use a heading drop).

**Client reads the replica.** List order is `priorityRank` then `sortOrder`, same table issues use.

---

## API

`updateProject` accepts `priority`, `afterProjectId`, and `moveToTop`. Reorder mints fractional keys scoped to the workspace + priority band.

---

## UI

- `/projects` — grouped by priority, drag row onto row to reorder, onto heading to change band; priority column
- Project shell sidebar — priority picker; `P` / command menu "Set priority"

---

## Done criterion

> Set two projects to Urgent from the shell, drag one below the other on `/projects` — order sticks after reload. Drop a project on the High heading — it moves bands and keeps a stable slot within High.
