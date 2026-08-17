# Issue properties

One file for the property system: statuses, priority, labels, estimates, due dates, SLAs, relations, sub-issues, templates.

## Workflow statuses

**Scope:** per team (sub-teams may inherit). Settings → Teams → Issue statuses & automations.

Six categories, **fixed order, not creatable**: `triage` → `backlog` → `unstarted` → `started` → `completed` → `canceled`. Plus a system-managed `duplicate` status that cannot be renamed or removed.

Within a category: create, rename, recolour, describe, reorder (drag), delete (at least one status must remain per category). Reordering across categories is not allowed.

- **Default status**: the status new issues get. Must be in Backlog or Unstarted. Defaults to the first Backlog status.
- Linear's own product-team workflow, as a reference configuration: Backlog: *Icebox, Backlog*; Unstarted: *Todo*; Started: *In Progress, In Review, Ready to Merge*; Completed: *Done*; Canceled: *Canceled, Could not reproduce, Won't Fix*; Duplicate: *Duplicate*.
- Ordering semantics differ by layout: **list** views ordered by status show closest-to-done → farthest, then completed/canceled; **board** views always render in workflow order.

Automation hooks that live on this settings page: git/PR automations (incl. branch-specific rules), parent/sub-issue auto-close, auto-close period, auto-archive period, release automations.

## Priority

Fixed 5-value scale: **No priority (0), Urgent (1), High (2), Medium (3), Low (4)**. Explicitly no custom or more granular priorities — the documented workaround is extra statuses or labels.

- Set with `P` on one or many selected issues; same shortcut clears.
- **Priority ordering**: on any priority-ordered view, drag to reorder; the position is stored **globally for the workspace** so everyone sees the same relative order. Items with no priority always sort last.
- Also applies to projects (`P` then `P`); dragging a project into a priority group applies that priority.
- Marking Urgent notifies the assignee, and sends an urgent email if email notifications are on.

## Labels

**Scope:** workspace or team. One nesting level via **label groups** (max 250 labels per group). Only one label from a group may be applied to an issue at a time (groups are mutually exclusive).

Operations:
- Create in Settings → Labels (workspace or team), or inline during the Add-label flow (`L`), including `Group/Label` or `Group:Label` syntax to create both at once.
- Apply with `L` or via the sidebar property.
- Manage: rename, recolour, describe, convert to group, move between team ↔ workspace scope, change owning team, merge duplicates, bulk-select (`X` / `Shift+click`) then act.
- **Archive** a label: stays on existing issues, blocked for new use, respected by views/insights/filters/groups. **Delete**: irreversible, strips it from issues.
- Settings page shows usage count, last applied, and which SLA/triage rules reference the label — needed before destructive changes.
- Label descriptions appear on hover and are consumed by Triage Intelligence when suggesting labels.

Cross-team behaviour: team labels sharing a name across teams act as one label when filtering multi-team views, custom views, My Issues, project all-team views, and search — **but not via the API**, where each team's label has its own ID. Creating a workspace label with the same name as existing team labels offers to convert them.

Reserved names: `assignee, cycle, effort, estimate, hours, priority, project, state, status`.

**Label views**: clicking a label anywhere opens a view of issues with that label (`O` then `L`). Team label views are team-scoped; workspace label views span teams. Group views include any label in the group. Favoritable and filterable.

Project labels and initiative labels are separate label systems with the same group semantics (Settings → Projects → Labels, Settings → Initiatives → Labels). Project labels can be displayed as list columns and used as an Insights dimension (sliced onto the issues belonging to those projects).

## Estimates

Per-team opt-in (Team Settings → General → Estimates); sub-teams may inherit.

| Scale | Values | Extended (+2) |
|---|---|---|
| Exponential | 1, 2, 4, 8, 16 | 32, 64 |
| Fibonacci | 1, 2, 3, 5, 8 | 13, 21 |
| Linear | 1, 2, 3, 4, 5 | 6, 7 |
| T-shirt | XS, S, M, L, XL | XXL, XXXL |

T-shirt maps onto Fibonacci for numeric display. Options: **allow zero estimates** (explicit 0, distinct from unestimated) and whether **unestimated issues count as 1 point** (default: yes).

Set/edit/clear with `Shift+E`. Filterable. "Effort" in analytics == estimate; with estimates disabled everything computes with 1 point per issue. Cycle and project graphs, capacity, and progress percentages all key off this.

## Due dates

- `Shift+D` to set; also available from the composer's ⋯ menu.
- Icon colour: **red** when due today or overdue, **orange** within a week, grey otherwise. Hover shows the date and days remaining/elapsed. Must be enabled under Display properties to show on lists/boards.
- Filters: Overdue, 1 day from now, 1 week from now, 3 months from now, custom date/timeframe, no due date.
- Ordering by due date puts dated issues at the top of each group.
- Optional notifications when near due / past due.
- **Mutually exclusive with SLA** — applying an SLA replaces the due date.

## SLAs (Business/Enterprise)

Enable in Settings → Issues → SLAs. Rule engine: conditions → apply or remove an SLA of a given duration. Rules evaluate on issue create/update; **first matching rule wins**; rule order is user-controlled. Changing a rule does not retroactively apply to existing issues (but updating an issue re-evaluates).

Default seeded rules:
- Priority = Urgent → 24h
- Priority = High → 1 week
- Priority ∈ {Medium, Low, No priority} → remove SLA

Durations: 12h, 24h, 48h, 1 week, 2 weeks, 4 weeks, custom (hour / day / **business day** / week). Business week is Mon–Fri by default, switchable to Sun–Thu; this calendar also drives other "skip non-working days" behaviour like project update reminder nudges.

Conditions can use: team, status, assignee, creator, priority, labels, project, project status, initiative — combinable.

Statuses and colour ramp (grey → yellow → orange → red): **Low risk** (>1wk out), **Medium risk** (<1wk), **High risk** (<1d), **Breached**, **Achieved** (completed in time), **Failed** (completed after breach). After completion the field persists showing minute-level completion time and outcome.

Notifications: subscribers notified 24h before breach and on breach; users can opt into all-team SLA notifications; Slack team notifications fire 24h (or 1 business day) before breach.

Manual application: issue ⋯ → Set SLA (clears any due date). If it matches a removal rule it may be stripped on next update.

Reporting: filter by SLA status; recommended Insight = measure Issue count, slice SLA status.

## Relations

Types: **related**, **blocked by / blocking**, **duplicate**.

- Add from the issue editor, list/board via shortcut, command menu, or contextual menu. Repeat per relation.
- `M` then `R` = related; `M` then `B` = blocked by; `M` then `X` = blocking. Command menu: "Create new issue related to…".
- Referencing an issue in a description or comment auto-creates a **related** relation.
- Blocked-by shows an orange flag; blocking shows a red flag. Once the blocker resolves, the pair moves under Related.
- **Duplicate** is directional: you mark the issue you're viewing as a duplicate *of* a canonical issue (never the reverse). Effects: attachments and customer requests move to the canonical issue; the duplicate's status becomes the reserved Duplicate status; a banner + sidebar treatment link back. `MM` triggers it from triage.
- Remove a relation by hovering + `X`, or command menu → Remove relation (prompts when several exist).

## Parent and sub-issues

- Create: `+ Add sub-issues` under the description, command menu, `Cmd/Ctrl+Shift+O`, from a comment, or by converting a highlighted list. Paste a list of titles or "Create multiple issues" to bulk create.
- After saving a sub-issue the editor reopens for the next one; `Cmd/Ctrl+Shift+Enter` (or Shift-click save) reuses the previous values.
- Templates can be applied to sub-issues; templates that themselves contain sub-issues are not offered inside a sub-issue.
- **Inheritance:** team, priority, project (and cycle when created in an active status). **Labels are not inherited.** Assignee inherits only if you're the parent's assignee, or all existing sub-issues share the parent's assignee.
- Sub-issues may belong to a **different team** than the parent.
- Duplicate a parent with "Include sub-issues".
- **Status automations** (team setting): parent auto-closes when all sub-issues are done; sub-issues auto-close when the parent is done. Git-triggered status changes respect these.
- Conversions: issue → sub-issue (`Cmd+Shift+P`, set parent), sub-issue → issue (Remove parent), issue → parent (Set Parent on the child), **parent → project** (⋯ → Convert to project: original issue and its sub-issues become standalone issues in the new project, original renamed, sub-issue relationships removed).
- Display: show/hide sub-issues in Display Options; filters for top-level only / has sub-issues / is sub-issue; "Always hide completed sub-issues"; per-user ordering of sub-issues under a parent.

Guidance Linear gives: use sub-issues for logical groupings that still roll up to a project; use projects for roadmap-level work, because parent/sub relationships have much less visibility.

## Templates

### Standard templates
Prefill any issue properties plus a description body. Support **placeholder text** (select text while editing a template → `Aa` on the toolbar) to prompt the creator.

Scope:
- **Workspace template** — usable in any team; cannot preset team-specific properties (team labels, team statuses).
- **Team template** — only that team; full access to team properties. Available to sub-teams of that team.

### Form templates
Structured intake. Fields:

*Generic:* Text, Long text, Dropdown, Checkboxes, Date, File upload, Instructions (static text, included in the created issue's description).
*Property-bound:* customer, label group, priority, title, due date.
Any field can be marked required.

Usable in: Linear (select the template), Slack, and Asks (Slack/email*/web). *Email Asks supports standard templates only.*

### Defaults
Per team, configure a default template applied to new issues — separately for **team members** and **non-team members**. Form templates can only be defaults for non-members. Default templates can override the Triage status.

### Templates in integrations
| Integration | Use | Form templates |
|---|---|---|
| Intercom / Zendesk | Up to 10 templates surfaced in the widget | — |
| Slack | Template dropdown during issue creation (max 10) | ✔ |
| Asks in Slack | Primary mechanism; per-channel template lists; default template for auto-created asks | ✔ |
| Asks in Email | Per-intake-address template | Standard only |
| Asks Web Forms | Each form == a template | ✔ |
| Salesforce | All issue creation is template-driven | — |
| Zapier | Template in the Create Issue step | — |
| Email address | Per-template email address | — |

**Templates in private teams are not available to Slack/Intercom/Zendesk** — Asks is the supported path for that.

### Reporting
Issues record their originating template and are filterable by it regardless of creation surface — enabling Insights like "bug reports vs feature requests by intake source".

## Project and document templates

- **Project templates**: name, description, teams, status, lead, members, initiatives, milestones, and a set of issues (issues may themselves use issue templates, including ones with sub-issues). Workspace or team scoped. Selectable at project creation or via the command menu. A team default project template can be set.
- **Document templates**: workspace or team scoped; selectable when creating a document in a project or issue.
