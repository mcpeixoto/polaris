# Initiatives and sub-initiatives

**Depends on:** projects, updates, labels, teams.
**Depended on by:** roadmap/timeline views, Pulse, initiative views (Enterprise), dashboards.

Initiatives sit above projects and express goals/objectives. Enabled per workspace in Settings → Initiatives. Formerly called Roadmaps.

## Model

- An initiative contains a **manually curated** set of projects. (Contrast: project *views* collect projects automatically by filter. Linear documents this distinction explicitly — curate with initiatives, monitor with views.)
- **Sub-initiatives** (Enterprise): nest up to **5 levels**; an initiative can have **multiple parents**; a parent's project list includes all descendants' projects (toggleable in display settings to show only directly-owned projects). Each sub-initiative shows an aggregate project count.
- Visible to all workspace members **except guests**. To make one private, give it a **private lead team**; then only that team's members can see it. Projects belonging to private teams inside a public initiative stay hidden from non-members while the initiative itself remains visible.

## Properties

| Property | Notes |
|---|---|
| Status | Proposed, Planned, Active, Completed, Canceled |
| Priority | Same 5-level scale |
| Labels | Initiative labels + groups, managed in Workspace Settings → Initiatives → Labels. For cross-cutting dimensions (product line, region, company goal, planning period) |
| Owner | Single accountable person |
| Lead team | Assigns ownership to a team; drives team-level initiative visibility and privacy |
| Target date | Expected completion |
| Resources | Documents and links |
| Description | Purpose, scope, context |
| Latest update | Health + narrative (same mechanism as project updates) |
| Projects | Contributing work streams |

## Creating and organising

From the workspace Initiatives views (Active / Planned / Completed):
- `+ New Initiative` or `N` then `I`; a parent can be chosen at creation.
- Nest by holding `Option`/`Alt` while dragging one initiative beneath another. Drag out to un-parent.
- `T` collapses/expands a nested list (personal, not shared).

From an initiative's Overview page:
- `+ Add` button or the ⋯ menu beside the title to create/attach sub-initiatives.
- `Cmd+K` or `Cmd+Shift+P` to set/change the parent.
- Sub-initiatives created here are auto-nested.

When grouped by owner or another property, parent initiatives still render above their children for context, greyed out if they don't match the grouping.

## Team initiatives

Teams can own initiatives directly or lead sub-initiatives that ladder into company goals. Enable sidebar visibility in Team settings → Team initiatives → "Show initiatives in the sidebar". By default a team's initiative view also shows contributing initiatives from other teams; a display option limits it to the lead team only. Team-led initiatives still appear on the workspace Initiatives page.

## Health roll-up

Two columns on initiative lists:
- **Initiative Health** — from the latest initiative update (on track / at risk / off track). Click to read the update.
- **Active Projects** — colour-coded roll-up of each contained project's latest update, including projects from sub-initiatives: green on track, yellow at risk, red off track, grey no current update. Clicking shows the associated updates.

Guidance surfaced in-product: comment on at-risk/off-track projects; mention the lead on projects with no recent update.

## Initiative graph

Each curve represents the rate of completed issues within one project in the initiative — rising in high-activity periods, flattening afterwards. Hover the x-axis to see the most active projects in a given week, or focus a single project.

## Initiative views (Enterprise)

Saved, filtered views over initiatives (the third view type alongside issue and project views). Those saved views can additionally be surfaced as **tabs within an initiative**, giving focused navigation inside a large initiative.

Filters applied while viewing a parent initiative include projects from all of its sub-initiatives.

## Initiative updates

Same machinery as project updates:
- Health + rich text; created from the Overview; owner posts first, then anyone.
- Automatic inclusion of owner changes, target-date changes, and status changes since the last update.
- Reminder cadence configured by admins in Workspace Settings (frequency, day, time); only sent when an owner exists and the initiative is in an In Progress-category status.
- Default Slack channel configurable workspace-wide (e.g. `#initiative-updates`), overridable per initiative via the bell icon. Comments sync bidirectionally with Slack.
- Updates tab shows chronological history; a display option can include updates from sub-initiatives and projects so everything relevant appears in one feed.

## When to use what

Linear's own framing, worth putting in the product's empty states:

| Need | Use |
|---|---|
| Curated set of projects tied to one objective, tracked over time | **Initiative** |
| Current state of work matching criteria, auto-updating | **Project view** |
| Cross-cutting category that doesn't fit one hierarchy | **Initiative/project labels** |
| A deliverable with an outcome and date | **Project** |
| A stage inside a deliverable | **Milestone** |
