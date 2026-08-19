# Team lifecycle v1 (2.8)

**Status:** shipped on main  
**Migration:** `000044_team_lifecycle` (deleted-team index)  
**Client schema:** 21 (unchanged — `Team.retiredAt` already replicated; deleted teams are GraphQL-only)

Retire, delete, and restore teams with a 30-day trash window for deleted teams and their issues.

## Scope

- `retireTeam` / `unretireTeam`: freeze team (read-only issues/settings), emit upsert with `retiredAt`
- `deleteTeam` / `restoreTeam`: soft-delete team + issues together, 30-day window (`TeamRestoreWindow`)
- `deletedTeams` query: admins see all; team owners see teams they owned
- Retired teams blocked in `requireTeamAccess`; sidebar hides retired teams
- Projects linked only to retired teams are read-only (`requireProjectWrite`)
- Team settings danger zone; **Settings → Deleted teams** restore screen
- Delete blocked while child teams exist (sub-teams schema present; full 2.5 deferred)

## Deferred

- Retirement flow UX (resolve active issues, sub-team warnings in UI)
- Sub-teams + inheritance (2.5)
- Team slot freed on delete vs retire accounting polish

## Reserved

- Client schema **22**: recurring templates  
- Migration **000045+**: next feature branch
