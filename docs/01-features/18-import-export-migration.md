# Import, export, migration

**Depends on:** teams, issues, labels, projects, users, integrations (for synced imports).
**Depended on by:** every enterprise sales motion — this is the switching-cost feature.

## Importing

Admin-only (Settings → Administration → Import/Export). Two mechanisms:

1. **In-product import assistants** — Jira, GitHub Issues, Asana, Shortcut, **Linear → Linear**. Preferred: retains far more data, easier, and **deletable in bulk**.
2. **Open-source CLI importer** — for anything else (Trello, Pivotal Tracker, GitLab Issues, arbitrary CSV). Requires technical skill and imports much less (no comments, no projects).

You cannot import directly into a **sub-team**: import into a top-level team, then re-parent.

### Generic assistant flow
| Step | Detail |
|---|---|
| Setup | Provide a token or sign in; choose an existing team or create one |
| Review | Linear shows fetched issues, projects, labels, users |
| Choose scope | Active only, or broader sets (stale, completed, all) depending on source |
| Map users | Per user: skip, create from email, or map to an existing Linear user |
| Confirm | Summary, then Finish |

**Reverting:** delete an import from Import/Export within the allowed window (14 days for GitHub, 7 days for Jira as documented; older ones need support). Deleting removes imported issues but not issues created natively or via sync. Re-importing the same source into the same team without deleting first **skips already-imported issues**.

### Jira
Field mapping:

| Jira | Linear |
|---|---|
| Summary → Title; Description → markdown description | |
| Assignee / Creator | best-effort match |
| Priority, Estimate, Due date, Created date | direct |
| Issue Key | backlink or ID match |
| Issue type, Type, Components | **labels** (team-level; created on import if absent) |
| Epic | **Project** |
| Comments, Parent/Child, Labels | direct |
| Status | best-effort conversion |
| Images (inline, in comments, attached) | image files |
| Non-image files | URLs pointing back to Jira |
| Custom fields | **not imported** |

Two import types:
- **API credential import** — needs Jira admin permission; retains the most data; **required if you want Jira Sync afterwards**. Inputs: personal access token, project key, email, cloud/installation hostname (strip `http://` and anything after `.net`), optional JQL scope filter (applies to the import only, *not* to ongoing sync).
- **CSV import** — no elevated Jira permissions; can cover many projects at once; **cannot be synced**; issues are static copies with a link back.

Both label imported issues `Migrated` and support **matching Jira issue keys** (so `ENG-1` in Jira becomes `ENG-1` in Linear) *if* importing into a new team (or an existing team with zero issues) **and** you include closed/done/archived issues. IDs diverge over time afterwards.

To import **as synced**, configure the Jira integration **before** running the import and tick "Sync issues after import". Users should connect personal Jira accounts first for correct assignee/creator mapping.

### GitHub Issues
Requires installing the **Linear Data importer** GitHub app once per org (may need GitHub org admin approval), then selecting repos and a target team.

Imported: title, description, labels (team-level), projects, comments, sub-issues. Not imported: custom fields, original created dates.

Options: import closed issues; send **stale** issues (open, untouched >6 months) to the team archive; enable sync back to GitHub; import org-level projects as well as repo-level.

Post-import cleanup Linear documents:
- **Labels** — promote common labels to workspace level by creating a workspace label with the identical name and choosing *Merge labels*; group related labels; delete unused (Usage column helps).
- **Projects** — GitHub Projects import as Linear Projects; add the right teams; missing ones were probably imported archived.
- **Statuses** — create the right statuses, use views + `Cmd/Ctrl+A` to bulk-fix, delete duplicates.
- **Team membership** — the importer adds every contributor (creators, assignees, commenters); prune.

User matching: same email in both systems + linked GitHub accounts is ideal. Users absent from Linear but with a valid email are attributed as **author** but never assignee. Users without an email can't be matched. Re-running the import after people join improves matching.

### Asana
Personal access token + Asana team name + target Linear team. Asana **organizations** only (convert your workspace, or use the CLI). Mapping: Priority→Priority, Notes→description (markdown), attached files→appended to description (non-images become links), Tags→team labels, Assignee, Projects→Projects, Comments (markdown preserved), Status→**Backlog or Done only**, Sub-issue, Blocked/blocking. An issue in multiple Asana projects lands in one Linear project.

### Shortcut
API token + team name + target team. Mapping: Name→Title, Description, Tasks→appended to description, External tickets→appended, State→closest status, Story type→label, Tags→labels, first Owner→assignee, Epic→Project, Comments, Estimate, Due date, Priority.

### Linear → Linear
Requires an admin account with the **same email** in both workspaces. Select source workspace → teams → member mapping → review → start.

Carried over: title, description, estimate, labels, due date, comments, workflow state, sub-issues, relationships, projects, initiatives, team templates, dashboards.
**Not** carried over: saved display preferences for custom/project/initiative views, favorites, reminders, drafts, inbox notifications, integrations, webhooks, OAuth clients, API keys, billing/plan, workspace URL, personal and workspace settings, roles (admins import as members; you become the only admin; guests keep guest).

### CLI / CSV
Expected CSV columns: `Title, Description, Priority, Status, Assignee (full name), Created, Completed, Labels (comma-separated), Estimate`. The documented trick is to export a Linear CSV, strip the rows, and paste your source data under those headers. Notes: Completed timestamps are stored but don't appear in the activity log; estimates only render once the team enables estimates; Trello must be imported per board, not per workspace. History, links, and integrations don't migrate.

## GitHub Issues sync vs import

Separate features. The importer syncs **imported** issues bidirectionally; the **GitHub Issues Sync** setting creates and syncs issues going forward.

| | Unidirectional | Bidirectional |
|---|---|---|
| Direction | GitHub → Linear | GitHub ↔ Linear |
| Best for | Open-source projects wanting private internal discussion | Transition periods; teams forced to stay on GitHub |
| Syncs | New issue creation, title/description, comments both ways, images, open/closed status | Creation and deletion, titles/descriptions, comments, images, open/closed status (not detailed workflow states) |

Constraints: many repos → one Linear team for one-way sync; only **one** repo per team for two-way sync; you cannot sync only *some* issues; status maps only to open/closed; custom GitHub Project statuses don't sync.

## Exporting

| Export | Who | Contents / limits |
|---|---|---|
| **Workspace CSV** (Settings → Import/Export → Export data) | Admin; **Owner-only on Enterprise** | All issues; toggle to include private teams; emailed download link expiring in **12 hours**; recorded in the audit log |
| **Member list CSV** | Admin (Owner on Enterprise) | Settings → Members → Export CSV |
| **Issue view CSV** | Members ≤250 issues; Admins/Owners ≤2,000. **Guests cannot export** | From any issue view/project/list via `Cmd/Ctrl+K` or the view dropdown |
| **Project / Initiative list CSV** | Members and admins, ≤200 at a time | From project/initiative views; select one to export just that one |
| **Customer requests CSV** | Anyone with access | `Cmd/Ctrl+K` → Export customer requests as CSV (scoped to customer, issue, or project) |
| **Copy as Markdown for LLMs** | Anyone | `Cmd+Opt+C` — title, description, comments, customer requests; works on multi-select |
| **PDF** | Anyone | Print dialog on an issue; timestamps switch from relative to absolute (useful for auditors) |

**Issue CSV columns:** ID, Team, Title, Description, Status, Estimate, Priority, Project ID, Project, Creator, Assignee, Labels, Cycle Number, Cycle Name, Cycle Start, Cycle End, Created, Updated, Started, Triaged, Completed, Canceled, Archived, Due Date, Parent issue, Initiatives, Project Milestone ID, Project Milestone, SLA Status.

**Project CSV columns:** Name, Summary, Status, Milestones, Creator, Lead, Members, Created At, Started At, Target Date, Completed At, Canceled At, Teams, Initiatives.

**Initiative CSV columns:** Name, Description, Details, Status, Creator, Owner, Target Date, Created At, Started At, Completed At, Projects, Teams, Health, Latest Update, Latest Update Date.

CSV exports never include attachment files (links may appear inside descriptions). There is **no team export** — moving teams between workspaces is done with the Linear → Linear importer.

Ongoing data-out options: Google Sheets (hourly, public teams only), Airbyte (Enterprise, ≥12h, full-refresh/append), GraphQL API, webhooks.

## Migration guidance to reproduce

Linear publishes a switching playbook worth copying into onboarding:
- Decide up front whether to import history, start fresh, or import only recent/in-flight work (the common middle ground).
- Set up teams first, provision users (SCIM group push), align workflow statuses with source states so they auto-map by name, clean up labels and decide team vs workspace scope, and enable Triage/Estimates/Cycles before importing.
- Bidirectional sync is a **transition tool**, not a destination.
- Pilot with a few teams before the full move.
