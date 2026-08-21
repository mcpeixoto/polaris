# Inbox leftovers (U / Alt+U, Shift+Backspace, Cmd+F, show read / snoozed)

**Status:** shipped on this branch  
**Migration:** none  
**Client schema:** unchanged

The inbox already listed, snoozed, and marked rows read. Linear's remaining chords and
display options were missing: `U` for read/unread, `Alt+U` for mark all, `Shift+Backspace`
to dismiss every read row, `Cmd/Ctrl+F` find, and the Show read / Show snoozed toggles.

## Scope

- `U` (and the old `E`) toggles read on the cursor row; `Alt+U` (and `Shift+E`) marks all
  read
- `Shift+Backspace` dismisses every read row, including ones hidden by display options
- `Cmd/Ctrl+F` focuses find; substring match on actor, event, issue title/ID, type, team,
  project, assignee, priority; Escape clears
- Show read (on by default) and Show snoozed (off by default)

## Deferred

- Right-click property updates from an inbox row
- Inbox-side issue peek that can both act on the notification and edit the issue
- Typed reminder phrases (`next quarter`, `til Friday`)
