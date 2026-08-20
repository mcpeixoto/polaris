# Cycle ICS token rotation

**Status:** shipped on this branch  
**Migration:** none (`cycle_calendar_feed.token` already exists)  
**Client schema:** 43 (unchanged — the token is still never replicated)

Rotate a leaked cycle calendar URL from the same ⋯ dialog that minted it.

## Scope

- `rotateCycleCalendarFeed(teamId)` replaces the personal token; the previous URL 404s
- Cycles ⋯ → Subscribe → **Rotate feed URL**, with a confirmation that names the consequence
- `ensureCycleCalendarFeed` still returns the live token and does not mint a second row

## Deferred

- Per-cycle (rather than per-team) feeds
- Sub-team cycle inheritance (4.8)
