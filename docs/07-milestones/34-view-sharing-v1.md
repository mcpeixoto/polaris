# Custom view sharing v1 (7.6 remainder)

**Status:** shipped  
**Migration:** none  
**Client schema:** 43 (unchanged)

Saved views can be created from any issue list (`Alt+V`) and flipped between private and shared after creation. Sharing is a visibility change: the old scope is told to forget the row, then the new scope takes it.

## Scope

- `updateView(private:)` — true keeps the view to the caller; false shares it with the team or workspace
- Project-attached views still cannot be private
- Sharing a workspace-wide view stays an admin action; a team view is a team-view-manage action
- Issue list: **Save view** when a filter is on; **Share** on a saved view (copy link, make private / share)
- `Alt+V` opens the save dialog; private-by-default for members saving a workspace-spanning filter

## Deferred

- Changing a view's team after creation
- Owner transfer to somebody else
- Views page (`/views`) as a directory
- Project-corpus custom views (saved `/projects` filters)
