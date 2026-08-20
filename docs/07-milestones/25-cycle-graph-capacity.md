# Cycle graph polish + capacity (4.5, 4.6)

**Status:** shipped on main  
**Migration:** none  
**Client schema:** 24 (unchanged)

The cycle burn-up now matches Linear's lines, and upcoming cycles show a capacity dial.

## Scope

- Target line: even distribution of current total scope across weekdays, flattened over weekends
- Started series from `startedAt` (falling back to completed/in-progress state)
- Per-period completed bars and per-assignee distribution
- Full cycle window on the x-axis, not truncated at today
- Current cycle graph on the Cycles page
- Capacity dial on upcoming cycles: trailing 3-cycle velocity, or team-size × duration × 5 when nothing has completed yet

## Deferred

- Historical snapshots for completed cycles
- ICS subscription (4.7)
- Sub-team cycle inheritance (4.8)
