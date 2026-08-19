# Triage v1

**Goal:** unreviewed work lands in a status category of its own, stays out of ordinary
views, and leaves only when somebody accepts, declines, merges or snoozes it.

This is inventory 8.1–8.2 of `docs/01-features/04-triage-and-intake.md`. Responsibility
rotations, triage rules, Triage Intelligence, Asks and agent automations stay out. Taking
any of those into this slice means this slice does not ship.

The visual bar is part of done. The inbox is the issue list with a different source, not a
settings form. Enable and require-priority are two compact checkboxes in team settings.

---

## What stays true from Cycles and Peek

**gqlgen still rewrites `schema.resolvers.go`.** Helpers stay in `domain/triage.go`.

**The replica is still the read path.** Client schema is 6 because `issue.snoozedUntil`
and the team flags cannot be added to a v5 database in place.

**Triage is a status category, not a fake view.** The grammar hides it unless a filter
names `state` or `stateCategory`. The inbox ANDs `{ stateCategory eq triage }` into the
compiled filter so that default turns off, and that clause is not in the URL — clearing
the bar must not empty the inbox.

---

## Schema decisions closed here

### Per-team opt-in, two columns

`team.triage_enabled`, `team.triage_require_priority`. Enable creates **Triage** (editable)
and **Duplicate** (`is_system`) if they are missing. The unique index is one of each
category per team, including archived rows: re-enable unarchives, it does not insert a
second row. Disable does not delete the statuses.

### Snooze is a timestamp on the issue

`issue.snoozed_until`. Hidden from the inbox until that instant **or** the next edit or
comment, whichever comes first. An edit clears it the way the server does, so a snooze is
not a second workflow.

### Who lands in triage

Creates from the inbox itself (`fromTriage`). Workspace members who can see a public team
but have not joined it. Private teams still refuse outsiders. Integrations and rules stay
out of this slice.

### Leaving requires a priority when the team asked for one

Accept, decline, duplicate, and an `UpdateIssue` that leaves the category. `1` / `2` / `3`
open the priority picker instead of flashing a revert.

---

## What the web does

- Compact enable + require-priority in team settings.
- `/team/:key/triage` — list layout only, so `H` snoozes without fighting the board's
  column nav. Empty teaches: turn triage on, or file with `C`.
- `G T` — first team that runs it, else that team's inbox page.
- `1` accept, `2` duplicate, `3` decline, `H` snooze. `C` from here files into triage.
- Snoozed rows wake on a timer armed for the next expiry, same clock as the notification
  inbox.

---

## Client schema

Version 6. A v5 replica is dropped and bootstrapped, not migrated in place.

---

## Done criterion

> A teammate who is not on Engineering files an issue there and it does not appear on
> Engineering's board. Somebody opens `G T`, taps `1`, and it is in Todo. The person who
> filed it can still find it; everyone else's views stayed clean.
