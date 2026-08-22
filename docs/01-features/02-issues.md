# Issues: create, edit, select, delete, archive

**Depends on:** teams, workflow statuses, editor.
**Depended on by:** everything downstream (cycles, projects, triage, insights, integrations, agents).

## Creation

Entry points — all must exist:

| Entry point | Detail |
|---|---|
| `C` | Issue creation modal |
| `V` | Full-screen creation |
| `Alt/Option + C` | Create from template |
| Sidebar "+" button | Modal |
| `linear.new` / `linear.app/new` / `linear.app/team/<KEY>/new` | URL entry, redirects to composer when logged in |
| Selected text → create | Pre-fills the title |
| Sub-issue editor (`Cmd/Ctrl+Shift+O`) | Creates a child of the open issue |
| From comment | "New sub-issue from comment", or select comment text + `Cmd/Ctrl+Shift+O` |
| From a list in a description | Highlight a bulleted/numbered/checklist → convert to sub-issues |
| Email to a team address | Team-level or template-level intake address |
| GraphQL API `issueCreate` | Any integration |
| Integrations | Slack, Asks, Intercom, Zendesk, Front, Salesforce, Sentry, GitHub sync, Jira sync, Zapier, Gong, Discord, Figma plugin, Loops |
| Triage view | Issues created inside triage default to Triage status |

Behaviour:
- Composer supports "Create more" (`Cmd/Ctrl+Shift+Enter`) — keeps the same properties for a rapid second issue.
- If created without a status: team default status; if Triage is enabled and the creator is outside the team (or the source is an integration), the issue lands in **Triage**. Team default templates can override.
- **First 3 minutes** of property changes are treated as part of creation and excluded from the activity log.

### Pre-filled creation URLs
Append `?` and `&`-joined params to any creation URL:

`title`, `description` (use `+` for spaces or URL-encode; description accepts markdown), `status` (UUID or name), `team` (UUID or key), `priority` (Urgent|High|Medium|Low), `assignee` (UUID, name, or `me`), `estimate` (point number; T-shirt mapping XS=1, S=2, M=3, L=5, XL=8, XXL=13, XXXL=21), `cycle` (UUID, number, or name), `label`/`labels` (comma-separated), `project` (UUID or name), `milestone`/`projectMilestone` (requires `project`), `links` (comma-delimited URL-encoded `url|title` pairs → link attachments), `template` (UUID or name).

Also required: "Copy pre-filled create issue URL to clipboard" command, and "Copy URL to create issue from template" from template settings.

### Email intake
- Per-team address (Settings → Teams → General → Create issues by email).
- Per-template address (Settings → Team → Templates → ⋯ → Configure email address). Template properties apply; the email's subject/body overwrite title/description. Replies to the forwarding address don't create additional issues.
- Original email attached as a link attachment; attachments synced up to **25 MB**; body limit ~250,000 characters.
- The sender is **not** notified of updates — that's what Asks is for.

### Recurring issues
- Make recurring from the composer (⋯ → "Make recurring…"), convert an existing issue (⋯ → Convert into → Recurring issue…, or command menu), or create in Team settings → Recurring issues.
- Choose first due date + cadence.
- Templates can be converted to recurring, carrying template properties including sub-issues.
- Next occurrence is created after the due date passes (00:01 next day, team timezone).
- Editing the source template later does **not** affect existing recurring issues.
- Filterable via a "Recurring issues" filter.

### Drafts
Two distinct kinds:
1. **Local draft** — navigating away hides the composer and keeps content locally; restored on next create. Cleared by logout/reset/restart. Client-local only.
2. **Saved draft** — pressing `Esc`/close offers "save as draft". Persists across clients, survives logout. Lives in the **Drafts** sidebar page. Retained **6 months**.

Unsent comments also appear in Drafts.

## Editing

- Title and description are editable by **any workspace member**, regardless of creator. Comments are editable only by their author.
- Description has **version history** — `Cmd/Ctrl+K` → "Issue description history" / ⋯ → "Show description history" → view and restore.
- Inline edit by clicking title/description; `E` enters edit mode.

### Moving an issue between teams
`Cmd/Ctrl+Shift+M` for one; multi-select then move for bulk. `Cmd/Ctrl+Z` undoes **the move** —
the move is the one structural action undo covers besides deletion, and what comes back is the
move's own consequences, not whatever was edited afterwards (most fields restore; labels,
subscribers, estimates and access-related assignments may not).

Field effects on move:

| Property | Effect | Mitigation |
|---|---|---|
| Issue ID | **New identifier minted**; old IDs remain searchable and old URLs redirect. Inline `#ENG-123` references still link but don't visually update | — |
| Status | Mapped to the closest status in the destination workflow; if the destination uses triage and the mover is outside that team, open issues land in Triage; closed stays closed | — |
| Cycle | Cleared if no corresponding cycle exists | — |
| Team labels | Removed | Create a same-named label in the destination team first |
| Project | Removed | Add the destination team to the project before moving |
| Relations, priority | Preserved | — |

## Selecting and bulk actions

- Highlight: hover, or `↑/↓` / `J/K`.
- Select: `X`, `Shift+click`, or the checkbox that appears on hover near the left edge.
- Multi-select: repeat `X`; `Shift + ↑/↓` for consecutive ranges; `Cmd/Ctrl+A` selects everything in the current (filtered) list or board.
- `Esc` clears.
- Act via `Cmd/Ctrl+K`, right-click contextual menu, or the bulk action toolbar at the bottom.
- Manual reordering (requires No grouping + Manual ordering): `Option/Alt+Shift+↑/↓` to top/bottom, `Option/Alt+↑/↓` to step. **Manual order is global to the workspace**, not per-user.

## Deleting

- `Cmd/Ctrl+Delete`, contextual menu, or command menu. Acts on the selection, or on the cursor row when nothing is selected, and asks first — naming the issue when there is one and the count when there are several.
- Undo with `Cmd/Ctrl+Z`; a bulk delete is one undo and the whole selection comes back together. Otherwise recover from Team archives → *Recently deleted issues* → select → `#` to restore.
- Recently deleted retained **30 days**, then permanent and unrecoverable (including by support).
- The recovery listing records **who deleted each issue and when**. Both are blank for issues deleted by the retention sweep rather than by a person, and it says so rather than guessing.

## Auto-close

Team setting: close issues untouched for N time. On auto-close: status set to a Closed status, a history item is written, subscribers notified. Re-open by changing status.

Does **not** auto-close while: the issue is in an active cycle, in an unfinished project, has a future due date, has an active SLA, or has sub-issues not eligible to close.

## Auto-archive

**There is no manual archive.** Team setting controls the period. Runs typically within 24 hours of a change.

Issues archive only after being completed/canceled/auto-closed **and** inactive for the full period. Blocked when:
- the parent issue isn't closed
- sub-issues (including those in other projects) aren't all closed
- the issue's project isn't yet archivable

Projects archive only when: status is in a completed/canceled category, no updates/edits recently, and **all** their issues are archivable. Issues archive at the same time as their project — so closed issues in an open project never archive on their own (this preserves project graph integrity).

The auto-archive setting also governs cycle and project archival.

## The archives page

Per team (`G` then `X`, or the team ⋯ menu). Contains archived issues, cycles, projects, initiatives, documents, plus "Recently deleted" tabs. Restore with `#`. Archived items are still searchable and their links still work, but must be unarchived before editing. Deliberately loaded on demand rather than kept in the client cache.

## Issue detail layout (what to build)

- Header: identifier, breadcrumbs (team / project / cycle), ⋯ menu, subscribe bell, share.
- Title, description (rich editor with inline comments).
- Sub-issues section with progress.
- Attachments / links section (PRs, commits, Figma, Slack threads, Sentry, support conversations, preview links).
- Customer requests section.
- Comment thread with threaded replies, reactions, resolve, synced threads, `@Linear` agent entry point.
- Activity feed (history + subscribe/unsubscribe).
- Right sidebar: status, priority, assignee, delegate, labels, project, milestone, cycle, estimate, due date/SLA, release, relations (blocked by / blocks / related / duplicate of), subscribers, reminders, shared-with banner.
- Banners: sync status (GitHub/Jira), duplicate-of, shared-issue visibility, SLA.

## Edge cases to honour

- Safari steals tab focus during creation unless the user enables "Press tab to highlight each item" — worth a help affordance.
- Email intake fails silently over 25 MB — surface an error path.
- Old issue IDs must resolve forever; old **titles** do not need to.
- Issues cannot belong to two projects — the documented workaround is sub-issues in different projects.
