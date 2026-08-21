# Keyboard map leftovers (G A / G B, remaining O pickers, issue L I Shift+E Shift+D Shift+S)

**Status:** shipped on this branch  
**Migration:** none  
**Client schema:** unchanged

The registry already owns the keyboard. Several Linear chords from
`docs/01-features/19-clients-sync-preferences.md` had no action: Active and Backlog
navigation, the rest of the `O` then letter jump pickers, `Cmd+/` for the shortcut overlay,
and the issue property keys that the list and detail screens still opened only from buttons.

## Scope

- `G A` / `G B` open the current (else first) team's issues filtered to Active
  (`unstarted`+`started`) or Backlog
- `O V` / `O D` / `O F` / `O Q` open filterable pickers for views, documents, favourites,
  and customers (customers only when the viewer is not a guest)
- `Cmd+/` opens the same help overlay as `?`
- Issue list and detail: `L` labels, `I` assign to me, `Shift+E` estimate, `Shift+D` due
  date, `Shift+S` subscribe

## Deferred

- `G R` reviews (no Reviews surface)
- `O R` review picker (same)
- In-view find `Cmd/Ctrl+F` on issue lists (inbox leftover is a separate slice)
- `Cmd/Ctrl+Shift+S` manage subscribers
- `V` full-screen create, `Alt+C` create from template
