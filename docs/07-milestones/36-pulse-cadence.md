# Pulse cadence (workspace enable + morning digest)

**Status:** shipped on this branch  
**Migration:** `000066_pulse_cadence`  
**Client schema:** 45

Workspace switch for Pulse, a digest cadence, and a worker that writes an inbox summary around 06:00 in each member's timezone.

## Scope

- Settings → Pulse: enable the feed; digest off / daily / weekly (Monday)
- `/pulse` stays replica-derived; guests still cannot see it
- Disabled Pulse hides the sidebar item and shows an empty state on the page
- Worker hourly: for each due member, count "For me" project updates since the last send and write a `pulse_digest` notification
- Cursor table is server-side only (not replicated)
- Inbox row opens `/pulse`

## Deferred

- Emoji reactions as a Popular signal
- Initiative updates
- Pulse audio
- Per-user digest override (workspace cadence is the default)
