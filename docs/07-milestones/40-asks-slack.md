# Asks Slack v1 (ticket emoji and `/asks`)

**Status:** shipped on this branch  
**Migration:** `000068_asks_slack`  
**Client schema:** 47

Intake from Slack for people who may not have a Polaris account. Reuses the workspace Slack install; does not add a second OAuth app.

## Scope

- Settings → Asks: toggle Slack intake once Slack is connected
- `/asks Title` (or `/polaris ask Title`) files a triage issue on the Slack connection's default public team
- A Slack message starting with 🎫 does the same (title is the rest of the first line)
- Provenance: `Submitted by @user in #channel via Slack Asks.`
- Lands in triage when the team runs it (same outsider path as form Asks)
- Replica field `slackConnection.asksEnabled` (default off)

## Deferred

- 🎫 emoji *reaction* on an existing message (needs `conversations.history`)
- Per-channel team/template mapping
- Private Asks / DMs
- Auto-create on every message
- Synced Slack thread ↔ issue comments
- Multiple Slack workspaces
