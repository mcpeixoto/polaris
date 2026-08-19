# Peek

**Goal:** look at an issue without leaving the list. `Space` is a glance; `Enter` is a
commitment.

This is inventory 7.8 of `docs/01-features/09-views-filters-layouts.md`. Project peek (with
the graph) stays out — there is no graph yet. Command-menu peek stays out. Taking either
into this slice means this slice does not ship.

---

## Behaviour

- `Space` toggles a side panel on the issue list. The list keeps the keyboard: `J`/`K`
  move, Peek follows the cursor.
- Holding `Space` is a glance. Release after a hold puts Peek away; a tap leaves it open.
- `Esc` closes Peek. `Enter` still opens the full issue.
- Peek does not push a sealed keyboard context. A modal that stole `J` would dump the user
  into a pane they did not ask to live in.
- Empty: nothing under the cursor, or the issue is not in the replica. Both say what to do.

Hold-to-preview is a keymap concern, not a local `onKeyUp`. Actions may declare `keyup`
and `ignoreRepeat`; the registry is the only listener.

---

## Done criterion

> Somebody can scan a list, tap Space, read the description, move to the next row, and
> never leave the list — until they press Enter on purpose.
