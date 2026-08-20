# Cycle ICS v1 (4.7)

**Status:** shipped on main  
**Migration:** `000062_cycle_calendar`  
**Client schema:** 43

Subscribe to a team's cycle calendar from the Cycles ⋯ menu: add to Google Calendar, copy a feed URL, or download an `.ics`.

## Scope

- One personal feed token per (user, team). The token is the credential and is never replicated
- `ensureCycleCalendarFeed` mints the token; `cycleCalendarFeedURL` returns the HTTPS URL
- `GET /calendars/cycles/{token}` — anonymous ICS of that team's live cycles (all-day VEVENTs in the team's timezone)
- Cycles ⋯ menu: **Subscribe to cycle calendar** with Google / copy / download
- Replica type `cycleCalendarFeed`

## Deferred

- Per-cycle (rather than per-team) feeds
- Sub-team cycle inheritance (4.8)
- Token rotation — shipped in `34-ics-token-rotate.md`
