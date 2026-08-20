# Pulse v1 (workspace update feed)

**Status:** shipped on main  
**Migration:** `000058_pulse` (no-op slot; 000059 already on main)  
**Client schema:** 40 (unchanged — Pulse reads existing `projectUpdate` rows)

Dense feed of project status updates from the replica. Linear Pulse without inbox digests, custom feeds, Popular, audio, or a settings cadence.

## Scope

- `/pulse` — For me / Recent tabs of live `projectUpdate` rows
- For me: projects the viewer leads, created, or is a member of
- Guests cannot see the page or the sidebar item
- `G` then `U`; `J`/`K` to move; Enter to open the project's Activity tab
- No worker, no GraphQL, no replica shape change

## Deferred

- Workspace enable + default digest cadence (Settings → Pulse)
- Inbox summaries (~6:00 AM)
- Popular tab (emoji / comment engagement)
- Initiative updates (no replica type yet)
- Custom feeds
- Pulse audio
