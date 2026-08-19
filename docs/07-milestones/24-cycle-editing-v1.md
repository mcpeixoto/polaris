# Cycle editing v1 (4.4)

**Status:** shipped on main  
**Migration:** none  
**Client schema:** 21 (unchanged)

Edit cycle names and dates, start the next cycle today, and show pause gaps on the Cycles page.

## Scope

- `updateCycle` — name/description on any cycle; upcoming can move start and end; current can move end only; past dates immutable
- Extending the current cycle pushes the following cycle; shortening leaves a visible gap
- `startCycleToday` — complete the current cycle, roll open issues into the next, start at midnight team time; irreversible
- Cycles page ⋯ menu: **Edit cycle**, **Start cycle today** (next upcoming only)
- Pause rows: **Cycles paused** or **Cooldown** between windows

## Deferred

- Cycle graph success / target line (4.5)
- Capacity dial (4.6)
- ICS subscription (4.7)
- Sub-team cycle inheritance (4.8)

## Reserved

- Client schema **22**: recurring templates  
- Migration **000045+**: next feature branch
