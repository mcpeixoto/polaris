# Sub-teams v1 (2.5)

**Status:** shipped on main  
**Migration:** none (`parent_team_id` from M0)  
**Client schema:** 21 (unchanged — `Team.parentTeamId` already replicated)

Nest teams under a parent, move teams in the hierarchy, and inherit private visibility from private parents.

## Scope

- `CreateTeamInput.parentTeamId` — create as sub-team under a parent
- `moveTeam(teamId, parentTeamId)` — nest, re-parent, or unnest (null parent)
- Private parent forces child private; making a nested team public blocked when parent is private
- Cascade privatize to descendants when a team is made private
- Sub-team members must be members of the parent (guests exempt)
- Parent team owners auto-added as owners on sub-team
- Depth limits: Pro = one level; Enterprise/self-hosted = five levels
- Entitlements: `subTeams` (Pro+), `multiLevelSubTeams` (Enterprise/self-hosted)
- Team settings **Parent team** section; sidebar nests sub-teams under parents

## Deferred

- Restricted vs private sub-teams (2.7)
- Cycle/status/estimate/label inheritance (4.8 etc.)
- Create-team UI with parent picker (API wired; no team-creation screen yet)
- Retirement flow warnings for sub-teams in UI

## Reserved

- Client schema **22**: recurring templates  
- Migration **000045+**: next feature branch
