# Cycles

**Depends on:** teams, issues, statuses, estimates.
**Depended on by:** cycle graph, capacity, insights, My Issues focus ordering, timeline overlay.

Cycles are Linear's sprints, with automation as the point: they repeat on a fixed schedule, roll unfinished work forward, and require no ceremony to run.

## Configuration (Team Settings → Cycles)

| Setting | Detail |
|---|---|
| Enable cycles | Off by default; adds the Cycles page to the team in the sidebar |
| Duration | 1–8 weeks, repeating |
| Cooldown | Optional gap after each cycle. **Issues cannot be assigned to a cooldown** |
| Start day of week | Cycle begins 12:01 AM on that day, in the team's timezone (Team Settings → General) |
| Upcoming cycles | Number of future cycles pre-created, max **15** |
| Rollover / auto-add automations | See below |

**Sub-teams:** if the parent has a cycle schedule, sub-teams inherit it and cannot define their own. Merging a sub-team into a parent's schedule leaves past cycles untouched, closes the sub-team's current cycle, and remaps upcoming cycles to the nearest parent cycles.

**Disabling:** current cycle is marked completed, upcoming cycles removed, completed cycle data preserved. Re-enable any time.

## Adjusting cycles

- Edit name and description via the Cycles page ⋯ menu. Naming rule worth replicating: if a cycle name ends in a number, subsequent cycles continue from that number.
- Dates: upcoming cycles can move start **and** end; the current cycle can only move its end. Past dates are immutable.
- Shortening a cycle creates a visible gap labelled **"Cycles paused"** (or the cooldown label if cooldowns are on). Extending a cycle eats into the following one.
- **Start cycle today**: from the next cycle's ⋯ menu. Starts at 12:00 AM team time. If a cycle is in progress it's completed immediately and its open issues move into the newly started cycle; if none is active, it ends the previous cooldown. Irreversible.

## Automations

**Issue rollover.** Open issues roll into the next cycle automatically. Issues moved to backlog / triage / canceled / completed during a cooldown do **not** roll. There is no way to keep unfinished issues in a closed cycle. Completed issues can be attributed back to the just-closed cycle if finished shortly after it ended, before the next begins.

**Auto-add active issues.** Optionally add any `Started` and/or `Completed` issue without a cycle to the current cycle. During cooldown: completed issues attribute to the *previous* cycle; started issues are **not** auto-added to the next. When enabling for Started issues, you must choose what to do with existing active cycle-less issues: move them to Backlog, or keep them Active and drop them into the current/next cycle.

**Move-out-of-cycle → Backlog** is the reverse automation (referenced from the Backlog docs): issues removed from a cycle can be pushed back to backlog. Conversely, backlog issues moved *into* a cycle are promoted to an active (Todo) status.

## Capacity

Shown as a dial on not-yet-started cycles. Calculated from the velocity of the **previous three completed cycles** (issues or estimate points completed). With no completed cycles, roughly estimated from team member count.

## Cycle graph

Auto-generated once a cycle begins; updates as work changes. Open with `Cmd/Ctrl+I` on a cycle view; the current cycle's graph also shows on the Cycles page.

Lines:
- **Grey** — total scope of the cycle.
- **Blue dotted** — target: even distribution of total estimated points across remaining days, flattened over weekends. At or above it ⇒ on track.
- **Yellow** — issues started, stacked on top of completed, so yellow+blue area = all active work.
- **Solid blue** — issues completed.
- **Blue bars** — completed issues per period, for readability when the started and completed lines overlap.

Scope basis: estimate points if estimates are enabled (including the team default for unestimated issues), otherwise issue count.

**Cycle Success** = percentage of issues completed or started during the cycle; completed count fully, started count as 25%. (Linear's example: 10 issues, 5 completed, 4 started, 1 untouched → 60%.)

Completed cycle graphs are **historical snapshots**; the issue list on the page can drift afterwards (issues reopened, moved, re-estimated). Expect and explain the divergence.

## Views and navigation

- Cycles page lists previous / current / upcoming (archived cycles excluded), with comparison stats.
- `G` then `C` style navigation to current cycle; "Upcoming" opens the next; if neither exists the shortcuts fall back to the Cycles page.
- Cycle sidebar (`Cmd/Ctrl+I`): details, graph, and per-user distribution — issue count or estimate total per member, with progress; clicking a member filters the view.
- Cycles can be shown as an overlay on project **timeline** views.
- Past cycles archive per the team's auto-archive setting.

## Calendar subscription

From a cycle's ⋯ menu → *Subscribe to cycle calendar*: add to Google Calendar, copy a feed URL, or download an `.ics`.

## Adoption guidance

- Starting mid-cycle: enable cycles with today as the start date to create a stub "current" cycle, then edit the date field again to set when the *next* cycle should begin, establishing the real cadence going forward.
- Aligning multiple teams: use sub-teams (they inherit the parent schedule). There is no cross-team cycle view.
