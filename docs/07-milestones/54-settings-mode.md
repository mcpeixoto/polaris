# Settings as its own mode

**Status:** shipped on this branch
**Migration:** none
**Client schema:** unchanged — no route was added, removed or renamed

Settings had no navigation of its own. Its twenty-eight screens were one flat list of links
at the bottom of the workspace sidebar, under a heading reading "Workspace", below a spacer
that pinned them past the fold of a column they overflowed. They were the least-used rows in
the product and the largest block in the most-used navigation.

They are a mode now. `AppShell` swaps the workspace `<nav>` for `SettingsNav` on any
`/settings` path; `<main>`, the command menu, the help overlay and the create modals are
siblings of that nav and stay mounted, so `Cmd+K` and the chords behave the same inside
settings as anywhere else.

## Scope

- `SettingsNav` — five groups, named for the scope each row belongs to: **Account**,
  **Workspace**, **Features**, **Integrations**, **Data**. A group whose every row is
  withheld is not drawn, so a guest sees Account and nothing else rather than four empty
  headings. Same `showMemberSettings` / `showAdminSettings` gating as before, passed down
  from `AppShell` so both navigations answer to one reading of the role.
- **Back to app** at the top of it, pointing at `/` so `HomeRedirect` decides by
  `prefs.homeView` rather than this component picking a screen.
- `nav.tsx` / `nav.module.css` — the row, the glyph set and the sidebar shape, previously
  private to `AppShell`, now shared by both navigations. `SettingsNav` importing them back
  out of `AppShell` would have closed a cycle.
- Two labels changed. `/settings/workspace` is **General** — a "Workspace" row inside a
  Workspace group reads as a mistake. "Pulse" named both a feed and a settings page, drawn
  one above the other in the same sidebar; the two navigations never render together, so the
  collision is gone without renaming a screen.
- `/settings` was the admin-only workspace general form, so `G S` as a member arrived at
  "Only admins can open this". It redirects to Profile, which every role has, and `G S` is
  no longer admin-gated.
- The workspace menu listed workspaces and nothing else. It now carries **Settings**,
  **Invite people** (admin only, for the reason `MemberSettings` gives about its own `i`
  command) and **Log out**. Invite hands off through `/settings/members?invite=1` rather than
  hoisting the dialog's state into the shell, so the seat check still guards the one way in.
- The jump pickers (`O`+`I` and its siblings) are withdrawn from the command menu while
  settings is up: each anchors its `Menu` to a hidden button inside the workspace nav, which
  is not mounted there.

## Deferred

- Search across the settings screens. Twenty-eight pages in five groups is navigable; it
  will not stay that way.
- A shared page header for the settings screens. Each still renders its own `<h1>` and its
  own chrome.
- Collapsing the workspace sidebar, and any responsive treatment — the shell is still a fixed
  two-column grid.
- Create workspace and Leave workspace in the workspace menu. `CreateWorkspace` is mounted
  only in the no-workspace boot branch and needs a signed-in route; Leave stays in
  Settings → Profile.
