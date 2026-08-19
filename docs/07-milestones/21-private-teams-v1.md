# Private teams v1 (2.4)

**Status:** shipped on main  
**Migration:** none (`team.private` from `000005`)  
**Client schema:** 21 (unchanged — `Team.private` already replicated)

Private teams and visibility rules across projects and initiatives, following `authz.Visible`.

## Scope

- Create/update team with `private` flag, entitlement-gated (`FeaturePrivateTeams`, Business+)
- Privatizing a team revokes non-member replicas, clears external assignees, unsubscribes non-member watchers
- `ListTeams` and bootstrap include private team metadata for admins (content still membership-gated)
- `ListInitiativeProjects` filters links by project visibility (bootstrap already did)
- Team settings: private toggle with confirmation, disabled when plan lacks private teams

## Deferred

- Admin/owner join flow with confirmation for private teams not yet joined
- Restricted vs private sub-teams (2.7)
- Private issue sharing (3.23)

## Reserved

- Client schema **22**: recurring templates  
- Migration **000044+**: next feature branch
