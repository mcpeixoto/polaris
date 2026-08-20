# Integration directory submit

**Status:** shipped on this branch  
**Migration:** `000064_integration_submission` (Slack's `000063` is reserved on `feat/slack-v1`)  
**Client schema:** 43 (unchanged — submissions are not replicated)

Propose a third-party integration from Settings → Integrations. The catalogue stays
derived from live connections; this is the inbox of tools that are not built yet.

## Scope

- `submitIntegration` / `integrationSubmissions` — not a `MutationResult`, not on the replica
- HTTPS website, name, and a short summary
- Guests are refused; members can submit and read the list
- Directory screen: form under the catalogue, plus the proposals already filed

## Deferred

- Publishing into a public marketplace
- Linking a submission to an OAuth application in this workspace
- Discord / Teams / Figma / Notion / Zapier / Jira themselves
