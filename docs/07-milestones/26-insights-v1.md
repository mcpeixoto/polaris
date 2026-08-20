# Insights v1 (7.12)

**Status:** shipped on main  
**Migration:** none  
**Client schema:** 24 (unchanged)

A live Insights panel on every issue view. Computed from the replica over the current filter set — no warehouse.

## Scope

- `Cmd/Ctrl+Shift+I` (and an Insights button) toggles the panel
- Measures: issue count, effort, cycle time, lead time, issue age, burn-up
- Slices: assignee, priority, status type, team, project, label
- Bar / scatter / area charts plus a table
- Click a table row to AND that slice into the view filter (where the grammar has a field)

## Deferred

- Segment (colour) as a third dimension
- Percentile markers and hover→highlight on the list
- Full-screen / share / CSV export of an insight
- Dashboards (7.13)
- SLA status and template slices (those entities are not on the replica yet)
