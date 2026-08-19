# Auto-close, auto-archive, and the archives page

**Goal:** stale work leaves the live graph on a schedule, without tearing a parent, a
project, or a pile of sub-issues apart, and there is a page to find it again.

This is inventory 3.13–3.14. Attachments and webhooks stay out. Manual archive of an
issue (`E`) already existed and stays; auto-archive is additive.

The visual bar is part of done. The archives page is a dense on-demand table, not a
settings form. Periods and parent/child automations are compact controls in team settings.

---

## What stays true from Triage

**gqlgen still rewrites `schema.resolvers.go`.** Helpers stay in `domain/archive.go`.

**The replica is still the read path for live work.** Archived rows are `OpDelete`. Client
schema is 7 because the team periods and `issue.autoClosedAt` cannot be added to a v6
database in place.

**Blocking conditions are load-bearing.** A closed issue in an open project never archives
on its own. The project takes its issues with it when *it* is archivable.

---

## Schema decisions closed here

### Per-team periods, four columns

`auto_close_days` ∈ `{0, 30, 60, 90, 180}`, `auto_archive_days` ∈ `{0, 30, 60, 90, 180, 365}`.
Zero is off. `auto_close_parent` / `auto_close_children` fire on a status change in the
same transaction, not only on the worker.

### Auto-close skips

Active cycle, unfinished project, future due date, open sub-issues. No SLA entity exists
yet, so that skip is not implemented.

### Auto-archive skips

Open parent, open sub-issues, issue belongs to a project that is not itself archivable.
Projects archive only when completed/canceled, stale, and every issue is archivable —
then the issues go in the same pass. Cycles archive when `completed_at` is older than the
period.

### Archives page

`/team/:key/archives`, `G X`, restore with `#`. Issues, cycles, projects, recently deleted.
Loaded on demand. Documents and initiatives do not exist yet.

---

## Client schema

Version 7. A v6 replica is dropped and bootstrapped, not migrated in place.

---

## Done criterion

> A completed issue with no parent, no children and no project disappears from the team
> after the archive period. The same issue sitting in an open project does not. Opening
> `G X` lists it; `#` brings it back.
