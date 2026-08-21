# Pulse custom feeds and Popular

**Status:** shipped on this branch  
**Migration:** `000067_pulse_feeds`  
**Client schema:** 46

Named personal feeds over the existing Pulse stream, plus a Popular ranking derived from comment engagement. No extra query type — feeds replicate like inbox rows, and Popular reads `comment` + `issue` already in the replica.

## Scope

- `/pulse` tabs: For me | Popular | Recent | [custom feeds…] | + New feed
- Custom feed: name + at least one project (max 40 projects, 20 feeds per person, 64-char name)
- Feeds are owner-only (`UserScope`); guests cannot create or see them
- Popular ranks project updates by comments on that project's issues created at or after the post
- Create / rename / retarget / delete from the feed tab (modal)
- Replica type `pulseFeed`; GraphQL `createPulseFeed` / `updatePulseFeed` / `deletePulseFeed`

## Deferred

- Emoji reactions as a Popular signal (no reaction replica type yet)
- Initiative updates
- Pulse audio
- Shared / workspace-wide custom feeds
- Per-user digest override (workspace cadence is the default)
