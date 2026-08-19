# Project update reminders v1 (5.7)

**Status:** shipped on main  
**Migration:** `000041`  
**Client schema:** 18

Display-only v1: workspace cadence settings, per-project schedule overrides, and staleness indicators on the projects list and project shell. Email/Slack reminder delivery is explicitly deferred.

## Scope

- Workspace defaults: reminder interval (days), weekday, hour
- Per-project override: workspace default / custom interval / never
- Staleness: `due_soon` (dashed outline), `missing` (grey “Update missing”), `not_expected` for completed/canceled/never; only **started** (in-progress) projects
- Settings at `/settings/project-updates`; schedule on project properties sidebar
- No worker or inbox delivery in v1

## Schema

Migration `000041`: columns on `workspace` and `project` with check constraints; replicated via bootstrap on `workspace` and `project` entities.

## Reserved migration numbers (other branches)

- `000036`–`000038`: GitHub (feat/github-v1)
- `000039`: recurring templates
- `000040`: nav-drafts
