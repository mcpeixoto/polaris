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
| Icon + colour | A named line icon or an emoji, tinted with a colour. See below |
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

### Icon and colour

An initiative is drawn the way a project is, from the same picker and the same set: a named
line icon stored as a token (`icon:target`) or an emoji, tinted with the initiative's colour.
An initiative that has never been given one falls back to the generic initiative glyph and to
grey, which is what the column defaults to.

It can be set when the initiative is created, changed by clicking the icon in the initiatives
list, in the initiative header or beside the name on the overview, and changed from the Icon
row at the top of the properties rail. This is newer than the project equivalent — initiatives had no icon at all until the
column was added — so an initiative created before that has no icon rather than a bad one.

## The screens

Two of them, and they are the project screens' shape: a list that is read for six facts, and
a detail page that is a reading column with a property rail beside it.

### The list

Columns, in order: **Name · Health · Status · Labels · Owner · Target date · Projects ·
Progress**. Name, Status and Projects are the row's identity and are always drawn; the other
five are toggled in Display. Rows are 39px.

- The **name** cell carries the initiative's mark, and the mark is a button: clicking it opens
  the icon picker without opening the initiative. It is the same picker the header and the
  rail open, and it writes one half of the pair per act — a glyph or a colour, never both.
- **Health** is the latest initiative update read as `icon · word · age` — "On track · 2w" —
  or "No updates" when nobody has posted one. The age is what turns a green word into a claim
  somebody can weigh.
- **Projects** is the roll-up of every contained project's own latest update, descendants
  included.
- A parent carries a chevron before its mark and folds its descendants away, remembered per
  person. The tree flattens itself under a status filter or a grouping, because an indent
  under a parent that is not on screen points at nothing.

The status tabs above the table read **Active · Planned · All initiatives · Proposed ·
Completed · Canceled**: the two scopes somebody is nearly always after, then everything, then
the rest. The scope rides in the URL, so a link shows what its sender was looking at. Grouping
by status still lists the headings in the lifecycle's own order, proposed through canceled — a
toolbar's order of convenience is not a ranking of states.

### The overview

One header row — `Initiatives › [mark] name`, the star and the `…` menu — then the sections
(`Overview · Activity`) with the rail toggle at the far end of the same row. The name in the
last crumb is plain text: a trail says where you are, and the initiative is renamed where its
name is the heading rather than a step in a path.

The reading column, centred and capped so prose is not set across a 2000px window:

1. The **mark and the name**. A 32px icon that opens the icon picker, and under it the name,
   which is text until you put the caret in it. The screen's one heading is a visually hidden
   `<h1>` beside that field — a `<textarea>` inside an `<h1>` would leave the heading with no
   accessible name at all, and the heading list is how somebody with a screen reader finds
   out which initiative they opened. A right-click anywhere on this block opens the same `…`
   menu the header does.
2. The **properties** as a row of pills — status, priority, owner, target date, lead team —
   with the current health at the end of the row, named "Initiative health".
3. The **update** card. When nothing has been posted it says "Write first initiative update"
   and keeps the composer open beneath: the reason an initiative has no updates is almost
   never that somebody could not find the form.
4. The **description**, autosaving on blur.
5. **Projects**: one row per contributing project — `[icon] name · health · lead · target ·
   progress` — with the projects reached through a sub-initiative listed beside the ones this
   initiative owns and marked "Via a sub-initiative", because only a direct link can be
   removed here.
6. **Sub-initiatives**: nest an existing one from the picker, or start one under this
   objective.

The rail holds the same properties again, one named row each, plus Icon and Labels which the
pill row has no space for; and **Progress**, which is the project counts, the roll-up bar and
the initiative graph. Both rail sections fold, and the fold is remembered per person the way
every other fold in the product is (`features/view/collapse`). So is the rail itself: the
toggle lives in the sections row so that hiding it survives a trip to Activity and back.

**Not built yet:** Resources. Documents and links attach to issues and projects in this
product and not to initiatives, so the row Linear draws there has nothing behind it.

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
