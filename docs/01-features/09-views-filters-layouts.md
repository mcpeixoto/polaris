# Views, filters, display options, layouts

**Depends on:** issues, projects, initiatives, labels, teams.
**Depended on by:** insights, dashboards, view subscriptions, favorites, Asks routing patterns.

This is the reporting and navigation spine of the product. Same grammar everywhere: **filter → group → order → lay out → display which properties**.

## Filters

Open with `F` or the filter button. Multiple filters combine; the list updates live.

- **Operators** (offered contextually): `is` / `is not`; `is either of` / `is not` (multi-value); `includes any / all / neither / either / none` (labels, links); `before` / `after` (dates).
- **Advanced filters**: grouped conditions with AND/OR logic, including nested groups. Chosen from the filter menu → Advanced filter.
- **Filter with AI**: natural language ("show me issues assigned to me", "what issues are due next week") resolves into concrete filters.
- **Quick search filters**: typing a value directly matches a filter without navigating the category — team name, status name, username (assignee/created-by/subscriber), priority word, label or label-group name, cycle (Active/Upcoming), project name, milestone name, date shorthands ("N days", Month, Quarter, Half-year, Year), link sources (Front, Zendesk, Intercom, custom).
- **URL sync**: main filters are encoded in the browser URL and reapply when the link is opened. View options, quick filters, and Insights filters are **not** in the URL.

Known nuances to reproduce:
- "No labels" = select all labels, then flip the operator to *does not include*.
- Milestone filtering requires a project filter first.
- Suspended users are not filterable; you reach their issues via their profile page.
- **Added to cycle** is distinct from **Cycle**: it describes *when* the issue joined relative to the cycle start — `Planned` (before start or within 24h) vs `After cycle` (>24h after start, including after it ended).

Filterable dimensions seen across the docs: team, status, status type, assignee, delegate/agent, creator, subscriber, priority, labels, label groups, project, project status, project labels, initiative, milestone, cycle, added-to-cycle, estimate, due date, created/updated/started/completed/triaged/canceled/archived dates, SLA status, customer / customer count / customer status / tier / revenue / size, links (per integration), template, recurring, release / stage / pipeline, has sub-issues / is sub-issue / top-level, project dependency states, Salesforce case properties, latest-project-update date.

## Display options

`Shift+V`. Saved either as a personal preference or as the page default for the workspace (**Set as default** / **Reset to default**). Triage and Inbox only expose ordering, not grouping.

### Issue views
- **Layout**: list or board (`Cmd/Ctrl+B` toggles).
- **Grouping**: status, assignee, project, priority, cycle, label, label group, parent issue, team, customer, release, SLA status, no grouping. *Focus* grouping is unique to My Issues.
- **Sub-grouping (swimlanes)**: available in list and board (as rows). Grouping headers stay sticky. Drag-and-drop across groups applies the target group's property.
- **Ordering**: status, manual, priority, last created, last updated, due date, link count; reverse toggle (except manual). Manual ordering is workspace-global.
- **Sub-issues** toggle, **Show empty groups** toggle.
- **Display properties** (per-card fields): ID, status, assignee, priority, SLA, project, due date, milestone, cycle, release, estimate, labels, links, customers, customer revenue, time in status, created date, updated date, pull requests and commits, Sentry issues. Availability varies by view and enabled features.
- Group headers show issue count **or** total estimate; click to toggle.

### Project and initiative views
- **Layout**: list, timeline; projects also support board.
- **Grouping**: lead, member, status, health, start date, target date; projects can also group by initiative.
- **Ordering**: manual, status, priority, updated, created; reverse (except manual/status).
- **Zoom** (timeline): week / month / quarter / year.
- **Completed projects**: show those completed in the last week/month/year, all, or none, under the Active tab.

## Board layout

- Toggle with `Cmd/Ctrl+B` or the board/list icons.
- Defaults to grouping by status; regroupable (project, priority, cycle, label, label group, SLA status, …).
- When grouped by status, boards always render **workflow order** (unlike lists).
- Create in a column with the column `+`.
- **Hide columns** from the column ⋯ menu; hidden columns collect at the far right and still accept drops.
- Move an issue to top/bottom of a column: `Option/Alt+Shift+↑/↓`. Keyboard/command moves go to the top; mouse drops land where you drop.
- Horizontal navigation: `Shift`+scroll, trackpad horizontal scroll, or click-drag empty space.
- `T` collapses/expands a swimlane.
- Board and list share ordering — you cannot order them independently.
- Descriptions never show on cards; use `Space` (peek) for detail.
- Not available in Triage or Inbox.

## Timeline layout

Projects only. See `06-projects.md` for the full behaviour (zoom, dependencies, milestones, cycle overlay, chronology bar).

## Custom views

- Types: **Issue**, **Project**, **Initiative** (Enterprise).
- Create from the Views page → New view, or save any filtered list/board with `Option/Alt+V` (the save icon appears once ≥1 filter is applied).
- Edit / duplicate from the view-name popup menu.
- **Scope**: workspace-level (visible to all full members) or team/project/initiative-level (listed under Team views). Tip Linear gives: to span teams but restrict content, create an *All teams* view and filter.
- **Contextual views** are attached as tabs on team Issues/Projects sections, on projects, and on the workspace Projects page — distinct from the Views page listing.
- **Copy view URL** to share; sharing a link does **not** grant access. The URL may carry temporary filters which apply on open.
- **Owner** field, defaulting to the creator, changeable; shown in the view sidebar and the Views page. Check with the owner before deleting.
- **Favorite** a view to pin it in the sidebar and make it eligible as your default home page.
- **View sidebar**: quick facets — project views show leads, teams, projects, initiatives, health; issue views show assignees, labels, projects.
- **Collapse group headers**: hover + `T`.

### View subscriptions
- Personal: ⋯ → Subscribe → notify when an issue is **added to the view**, when one is **completed/canceled**, or both. Self-triggered changes don't notify. Managed afterwards in notification settings.
- Slack channel: ⋯ → *Configure custom view Slack notifications* → authorise → pick channel → choose the same event set.

This is the general-purpose alerting primitive: e.g. "issues from churned customers ordered by revenue" or "any new P1 in these teams".

## Ad-hoc issue lists

`linear.app/<workspace>/issues/ENG-123,ENG-456,ENG-789` opens a view containing exactly those issues — for sharing a short review list without creating a view or label.

## User views

- User profile pages (`O` then `U`, or click an avatar) with an Assigned tab. Not favoritable — the documented workaround is a custom view filtered by assignee.
- Grouping by assignee on any view.
- Cycle sidebar (`Cmd/Ctrl+I`) shows per-member distribution with counts/estimates and progress; click a member to filter.

## Label views

`O` then `L`, or click any label. Team label views are team-scoped; workspace label views span teams; group views include every label in the group. Favoritable and filterable.

## Peek preview

`Space` toggles; hold `Space` for a temporary preview; `↑/↓` moves through items; `Esc` closes. Issues show description, assignee, status, priority, cycle, labels, estimate, created/updated dates; projects show details plus the project graph. Peek also activates automatically while navigating the command menu.

## Favorites

`O` then `F` to open the favorites picker; `Alt+F` toggles favorite on the focused item; star icon in headers. Favoritable: issues, projects, views, documents, initiatives, cycles, labels, teams, customers, dashboards, pull requests, releases, and default views (all issues, active, backlog, board, current/upcoming cycle). Supports **folders** with drag-and-drop. The Favorites section appears above Your Teams once you have one. Favorited views can be set as the app's default home page in Preferences.
