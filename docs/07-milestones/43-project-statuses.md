# Project statuses settings

**Status:** shipped on this branch  
**Migration:** none  
**Client schema:** unchanged

The create / update / archive mutations already existed. Settings had no screen, so a
workspace could not rename "In Progress" or add "In review" without the API.

## Scope

- Settings → Project statuses: grouped by category (backlog, planned, started, completed,
  canceled)
- Create, rename, recolour, make default, archive
- No reorder: the API has no `afterStateId` equivalent

## Deferred

- Reorder within a category (needs a positioning verb on `updateProjectStatus`)
- Description field on a status
