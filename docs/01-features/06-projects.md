# Projects, milestones, updates, dependencies

**Depends on:** teams, issues, documents, editor, workspace project statuses.
**Depended on by:** initiatives, timeline, project graph, customer requests, insights, Pulse.

A project is a unit of work with a clear outcome or completion date. It can span multiple teams; its issues cannot (each issue still belongs to exactly one team, and to at most one project).

## Creating and managing

- Create from a team's or the workspace's Projects page (`+`), or from a project template, or by **converting an issue** (`Cmd/Ctrl+K` → "Convert to project" — the issue and its sub-issues become standalone issues in the new project, the original is renamed, sub-issue links are dropped).
- Only **name** is required; Linear recommends also setting a lead and icon.
- Edit properties from the overview page, the details sidebar (`Cmd/Ctrl+I`), or by right-clicking a project in any view → Edit project.
- Delete: ⋯ → Delete (or command menu). Goes to the team archive's *Recently deleted projects* for **30 days**.
- Auto-archive: when the status is in a Completed/Canceled category, no unarchived issues remain, and the inactivity period has elapsed. Renaming or otherwise touching the project resets the clock.

## Properties

| Property | Notes |
|---|---|
| Name, icon + colour | Icon from a preset palette |
| Summary | Short one-liner |
| Description | Doc-like rich text: mentions, inline comments, version history |
| Status | From workspace-defined **project statuses** — categories Backlog, Planned, In Progress, Completed, Canceled; custom name/description/colour per status. Never auto-derived from issue completion; always manual |
| Priority | Same 5-level scale as issues; `P` then `P`; manual micro-ordering within a priority group; dragging into a group applies that priority |
| Lead | Exactly one. Deliberate — "more people involved" → add members |
| Members | Any workspace user; members opt in to notifications |
| Teams | 1..n. Adding more creates per-team tabs on the issues view |
| Start date / Target date | **Timeframe granularity**: precise day, month, quarter, half-year, or year. Start date required for the graph; target date required for completion estimates |
| Labels | Project labels + label groups (mutually exclusive within a group) |
| Health | Derived from the latest project update: On track / At risk / Off track / no update |
| Resources | External links (with editable labels) and Linear documents |
| Milestones | Ordered checkpoints |
| Dependencies | Blocked by / blocking other projects |
| Customer requests | Appear as a dedicated tab once the first is added |

## Project overview page

Tabs: **Overview**, **Issues**, **Customer requests** (conditional), **Activity/Updates**, plus any attached views.

Overview contains: summary, properties, resources (links + documents), detailed description with inline comments, and the milestone list with progress. This is explicitly designed as the place a project starts *before* any issues exist — collect research, write the spec, get feedback in comments.

Details sidebar (`Cmd/Ctrl+I`): all properties, resources, and the project graph. Available from both Overview and Issues.

## Issues in a project

- Add existing issues or move between projects with `Shift+P`; create new ones with `C` from the project view.
- An issue can belong to only one project. Documented workaround for shared work: sub-issues in different projects.
- Project picker ordering (worth copying): projects you lead → you're a member of → recently created by you → overlapping teams → active → recently created → cancelled/completed.

## Attached views

- Next to the Issues tab, a **new view** icon creates a saved, filtered view of the project's issues, shown as an additional tab, reorderable by drag, visible to anyone with project access. Right-click for copy link / favorite / edit / delete.
- The same mechanism exists on the **workspace Projects page** for project views.
- Linear's own examples: "my issues in this project", "bug label", "In Progress (standup)".

## Milestones

- Create from the overview (beneath the description), the details pane `+`, the command menu, or by right-clicking a date on the timeline.
- Fields: name, optional description, optional target date, order.
- Attach issues: `Shift+M`, command menu "Add to milestone", or drag onto the milestone in the details pane. New issues in a project with milestones get **suggested** milestones during creation.
- Progress: percentage computed from linked issues — a started issue contributes partially, completed contributes fully. The next incomplete milestone is highlighted **yellow** as the current focus (not removable, even when running milestones in parallel).
- Reorder by dragging the `⋮⋮` handle in the overview or details pane. Edit/delete via ⋯ menu, or on the timeline (right-click / `Cmd+Backspace`, drag to move dates, multi-select or `Shift`-drag to move several).
- **Convert a milestone to a project** from its overflow menu — Linear suggests description and priority based on the milestone content and parent project.
- Milestones cannot be shared across projects.
- Filter and group by milestone (filtering by milestone requires filtering by project first). Visible on initiative and team timelines with completion %, double-click to open the project pre-filtered. Initiative views can filter by *next milestone* and *completed milestones*.
- Available as an Insights dimension, segmentable by status type.

## Project updates

See also `01-features/07-initiatives.md` — initiative updates share the mechanism.

- Composed from the project (or initiative) Overview / Activity page, pencil icon on the latest update.
- Content: **health indicator** (On track / At risk / Off track) + rich text, with file uploads and formatting.
- The lead/owner posts the first update; afterwards any workspace member can post.
- **Automatic progress report**: updates include a generated summary of changes since the last update — delays, target-date changes, new leads, milestone progress, overall progress. Only appears when overall progress moved by **>2%**; can be excluded with "Hide details" while drafting.
- Emoji reactions and threaded comments. Comments sync **bidirectionally with Slack** when the update is posted to a channel.
- Edit (author only) and delete (⋯ menu) supported. Copy link / copy as Markdown from the command menu.
- History lives on the Updates/Activity tab in chronological order, interleaved with property changes (target date, members, milestones). Initiatives can optionally include sub-initiative and project updates in this feed.

### Reminders and staleness
- Workspace setting: reminder cadence (e.g. weekly Wednesday), day and hour; delivered in the lead's local timezone. Only sent for **In Progress**-category projects/initiatives and only to the lead/owner. Follow-up nudges at +1 and +2 working days (respecting the SLA business-week setting).
- Per-project schedule override: follow workspace default / custom schedule / never.
- **Staleness**: a project is marked **Update Missing** when its last update was *On Track* and an update is one reminder cycle + 3 days overdue. A dashed outline warns before the health icon turns grey. Completed projects or those set to "never" show **No update expected**. Filterable via "Date → latest project update".
- Not receiving reminders? Conditions are: you're the lead, status is In Progress, and you haven't posted in the last 24h.

### Distribution
- Workspace-level default Slack channel (e.g. `#project-updates`), overridable per project via the bell icon (e.g. `#p-project-name`). Projects associated only with private teams need their own channel config.
- Posting to multiple channels posts once to a main channel and forwards.
- Also deliverable to the Linear Inbox; edits propagate to Slack.
- Custom project views expose an **updates button** giving a consolidated feed for every project in the view — the reporting primitive for portfolio updates.

## Project graph

Generated once the project reaches a Started status and enough issue data exists. Stats refresh **hourly**; points are at **7-day** granularity.

- Grey line: scope over time (shows scope creep).
- Separate **Started** and **Completed** lines, plus blue bars for completed issues per period.
- Breakdown by assignee and by label, each with completion %, hover → filter.
- Target date renders as a red vertical line.
- **Live prediction**: once ≥1 week of history exists, a dotted continuation to a predicted completion date. Velocity = completed points per week, recent weeks weighted more heavily. Remaining points = incomplete points with a ¼ modifier for in-progress issues. Optimistic/pessimistic band ≈ ±40%.
- Progress can go **down** when scope is reduced (issues deleted/removed/cancelled or re-estimated smaller) — by design, to keep Scope and Progress comparable.
- With estimates disabled, every issue counts as 1 point.

## Project dependencies

- Only **end → start** dependencies are supported.
- Create from the project ⋯ menu or command menu (Dependencies → Blocked by… / Blocking…), or by dragging from the circle at the end of a project bar on the timeline to another project.
- Timeline rendering: **blue** line = satisfied, **red** = violated. Click a line to jump to the project or remove the dependency.
- Line anchors: starts at the blocking project's target end date (or predicted end date if none); connects to the blocked project's target start (or target end) date.
- Dragging ergonomics: backlog/planned projects in the chain get bumped along with the dragged project; hold `Cmd/Ctrl` to keep them in place; hold `Shift` to move the whole chain regardless of status.
- Filters: has dependencies / has blocking dependency / has blocked-by dependency / has violated dependencies.
- Shown on the Overview and the properties sidebar as Blocked by / Blocking.

## Timeline view

Projects-only (issues never appear on a timeline). Reachable via Display → Timeline on any projects view, inside an initiative, or on the workspace projects page.

- Zoom: week / month / quarter / year; scroll horizontally (two-finger swipe), chronology bar for navigation.
- Group by initiative or other attributes; swimlanes via display sub-grouping.
- Show/hide project properties: milestones, dependencies, lead, members, priority, status, health.
- Overlay a team's **cycles**.
- Milestones render on project bars with completion percentages.

## FAQ behaviours to preserve

- Projects for ongoing work: discouraged. Workarounds offered — no target date (grouped under an initiative), time-boxed sub-projects (e.g. "Q1 infrastructure"), or a custom **Maintenance** project status.
- Multiple leads: not supported by design; use members.
- "Roadmaps" were renamed **Initiatives**; timeline is a display mode, not a separate object.
