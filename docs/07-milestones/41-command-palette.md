# Command palette leftovers (scoped prefixes, jump pickers, copy UUID)

**Status:** shipped on this branch  
**Migration:** none  
**Client schema:** unchanged

The command menu already listed every registered action. This slice adds the rest of inventory 7.1: prefixes that jump into the replica, the `O` then letter pickers, and "Copy model UUID" for API work.

## Scope

- Cmd+K prefixes: `>` commands, `#` issues, `@` people. Unprefixed search still ranks commands and, once there is a query, matching issues
- `O I` / `O P` / `O T` open filterable pickers for issues, projects, and teams (alongside existing `O U` / `O L`)
- Issue and project screens: command-menu "Copy model UUID"

## Deferred

- Peek preview of the highlighted issue while the menu is open
- Document / view / favorite prefixes
- Recency ranking of commands
