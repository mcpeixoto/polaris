# Cycles v1

**Goal:** a team can run dated windows of work that mint, close and roll themselves, so
nobody has to create a sprint by hand.

This is inventory 4.1–4.3 of `docs/01-features/05-cycles.md`, not the whole of that file.
Cycle editing, start-today, pause gaps, the graph, success, capacity, ICS and sub-team
inheritance stay out. Taking any of those into this slice means this slice does not ship.

The visual bar is part of done. The Cycles page is a dense list like Projects; cadence lives
as four compact selects in team settings, not a settings form dump. See the web tokens and
shared components.

---

## What stays true from M1 and Projects

**gqlgen still rewrites `schema.resolvers.go`.** Cycle converters live in `convert_cycles.go`.
A helper in the resolver file is a build break waiting for the next `make gqlgen`.

**The replica is still the read path.** The Cycles screen, the picker and the issue's cycle
chip all read IndexedDB. GraphQL is mutations plus bootstrap. Client schema is 5 because a
new entity type cannot be added to a v4 database in place.

**Cooldown is a gap, not a row.** There is no cycle to assign to during cooldown. The schema
cannot represent a cooldown cycle because none is inserted.

---

## Schema decisions closed here

### An issue belongs to at most one cycle, as a column

`issue.cycle_id`, not a join table. The cycle must belong to the issue's team; the trigger
`issue_cycle_matches_team` is the product rule when the writer is an importer.

### Cadence lives on the team, as columns

Enabled, duration (1–8 weeks), cooldown (0–8), start day (`monday`–`sunday`), upcoming
(1–15), auto-add started/completed. Not jsonb. Enable creates the current window and
`upcoming_count` future ones. Disable completes the current and deletes upcoming.

### Names and instants

Cycles are named `"Cycle N"` from the team's last number. Instants are minted at 00:01 in
the team's timezone; `ends_at` is exclusive. Duration and cooldown are `time.Duration`, not
`AddDate`, so a one-week cooldown is exactly `7*24h`.

### Rollover and auto-add

At close, `unstarted`/`started` issues move to the next cycle; completed stay. During the
current window, started and/or completed cycle-less issues can be auto-added. During
cooldown, completed attribute to the previous cycle; started wait.

### Advance is a worker, not an API

`AdvanceCycles(ctx, now)` runs on a one-minute cron as `authz.SystemActor()`. Config is
`team.update`; assigning an issue is `issue.update`. No new authz actions.

---

## What the web does

- Compact cadence in team settings. Enable, then duration / cooldown / start day / upcoming,
  then the two auto-add checkboxes. Off hides the rest.
- `/team/:key/cycles` — current, upcoming, previous. Empty teaches: turn cycles on in
  team settings. There is no create-cycle button. `C` stays create-issue.
- `/cycle/:id` — the issue list scoped to that window. `C` from here files into it.
- `G C` — the current cycle of the first team that runs them, else that team's cycles page.
- `Shift+C` — the cycle picker on the list and on detail.
- Compact picker: Current, Upcoming, Previous, then "No cycle".

---

## Client schema

Version 5. A v4 replica is dropped and bootstrapped, not migrated in place. Bootstrap
streams `cycle` before `issue`.

---

## Out of this slice

4.4 cycle editing / start-today / pause gaps. 4.5 graph and success. 4.6 capacity. 4.7 ICS.
4.8 sub-team inheritance.

---

## Done criterion

> Somebody can turn cycles on for a team, land in the current window with `G C`, file an
> issue into it with `C`, and move existing work with `Shift+C` — without creating a cycle
> by hand, and without a cooldown they can accidentally assign to.
