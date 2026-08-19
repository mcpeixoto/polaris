# Project graph v1

**Goal:** scope, started and completed lines on the project Overview — weekly granularity, target date marker, velocity prediction and assignee breakdown — computed from the replica. Inventory 5.5 scoped down.

Hourly snapshot storage, per-period bars and label breakdown hover→filter stay later slices.

---

## What stays true

**No new backend entities.** The chart reads project issues, statuses, dates and workflow state already on the stream.

**7-day buckets** from project start (or first filed issue) through today or target date.

**Eligible statuses:** `started` or `completed` project status categories only — backlog/planned show the empty state.

**Prediction** needs at least one week of span and some completed velocity; remaining work counts in-progress at ¼ weight; band is ±40%.

**Assignee breakdown** is a simple completion % list from current issue states, not hover filters yet.

---

## Done criterion

> Open a started project with issues across multiple weeks — Overview shows scope, started and completed lines, target date when set, and assignee rows. Completing an issue moves the completed line without reload.
