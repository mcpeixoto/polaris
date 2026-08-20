# Sub-team cycle inheritance (4.8)

**Status:** shipped on this branch  
**Migration:** none  
**Client schema:** 43 (unchanged)

If a parent team runs cycles, nested teams inherit that schedule and cannot define their own.

## Scope

- Creating or moving a team under a cycling parent copies cadence and aligns live windows to the parent's start/end instants
- Past child cycles stay; a mismatched current window closes and open work rolls into the matching inherited current (or next upcoming)
- Upcoming child windows remap onto the parent's live windows
- `updateTeamCycles`, date edits, and start-cycle-today are refused on the child while the parent still has cycles on
- Parent cadence/date/advance changes propagate to descendants
- Team settings show the lock and a link to the parent; the Cycles ⋯ menu hides Start cycle today

## Deferred

- Status / estimate / label inheritance
- Restricted vs private sub-teams (2.7)
