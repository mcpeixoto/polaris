# Dashboards v1 (7.13)

**Status:** shipped on main  
**Migration:** `000054_dashboards`  
**Client schema:** 35

Pages of Insights tiles over the replica. Simpler than Linear Enterprise: no ownership transfer, no “add this insight to a dashboard”, no hidden saved filters, no refresh action.

## Scope

- Workspace, team, or personal dashboards (personal XOR team)
- Tiles reuse Insights measures (count, effort, cycle time, lead time, issue age, burn-up) and slices (assignee, priority, status type, team, project, label)
- Display as chart, table, or metric
- Dashboard-level filter AND-ed with each tile’s filter
- Workspace dashboards skip private-team issues; personal and team dashboards use whatever the replica already holds
- Guests cannot create or see dashboards
- Create seeds two tiles: Issues by assignee, Effort by priority
- `/dashboards`, `/dashboard/:id`
- Command menu: create dashboard, go to Dashboards (`G` then `D` stays Drafts)

## Deferred

- Segment (colour) as a third dimension
- Click-through from a tile into a filtered issue list
- Move to team / workspace / personal after create
- Dashboard-level filter editor in the UI (the field exists on the replica)
- Share / export / full-screen
- Insights context menu → Add to dashboard
