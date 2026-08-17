# Workspaces, teams, sub-teams

**Depends on:** nothing (foundational).
**Depended on by:** literally everything.

## Workspace

Created at signup with a work email. Automatically creates a default team with the same name. Data region (US/EU) is chosen at creation and is not self-serve changeable afterwards.

Workspace settings surface (Settings → Administration):
- Name, URL key, icon
- Login preferences and security (see `18-admin-security-permissions.md`)
- Feature toggles: Initiatives on/off, Customer Requests on/off, Pulse + default cadence, Project/Initiative update schedules, Triage Intelligence, Linear Agent, MCP servers, Code Intelligence, coding sessions, Asks
- Members, teams, imports/exports, billing & AI credits, integrations
- Workspace-level labels, project statuses, project labels, initiative labels, templates (issue/project/document), SLA rules, third-party app approvals (Enterprise)

**Delete workspace:** owner-initiated (admins too, if not restricted). Email confirmation code → scheduled for deletion in **48 hours** → all admins emailed → any admin can cancel within the window → then permanent. Remaining AI credit balance is forfeited.

**Delete account** is separate from deleting a workspace. Leaving a workspace is separate again; re-entry requires an admin to unsuspend.

**Multiple workspaces:** one email/account can hold users in many workspaces; switch via the workspace menu or `O` then `W`. Adding another account (different email) allows switching without re-auth. Billing and membership are per workspace.

## Team

### Creation and structure
- Create from Settings → Teams (admin) or the sidebar "+ Join or create a team" (if not restricted).
- On creation: name, key/identifier, optional **copy settings from an existing team**, optional **private**, optional parent team (making it a sub-team).
- Team creation can be restricted to admins (Settings → Administration → Security).

Structuring guidance Linear gives (worth encoding in onboarding copy): teams = durable groups that work together, own a distinct workflow/triage/cycle cadence, or need a privacy boundary. Not teams: programs, temporary work, reporting categories — those are projects, initiatives, labels, or views.

### Team pages
| Page | Content |
|---|---|
| **Home / Overview** | Pinned resources (team docs + links + resources pulled from the team's issues/projects), team members, shortcuts to settings/triage/issues/projects/views |
| **Documents** | Team-level docs (runbooks, meeting notes, design links) |
| **Members** | Membership browser |
| **Triage*** | Intake inbox (opt-in) |
| **Issues** | All (non-archived, non-deleted, incl. completed/canceled), Active (`unstarted`+`started`), Backlog |
| **Cycles*** | Current / upcoming / past, with graphs |
| **Projects** | Projects assigned to the team, plus attachable project views |
| **Views** | Team-scoped custom views |
| **Loops** | Team-level loops (Business+) |
| **Archive** | `G`+`X`. Archived issues/cycles/projects + recently deleted issues/projects/documents/initiatives (30 days). Loaded on demand (deliberately not synced into the client). |

`*` opt-in via team settings.

### Team settings
| Page | Configures |
|---|---|
| General | Name, identifier, timezone, estimates (enable + scale + extended + zero + unestimated-counts-as-1), create-issues-by-email toggle + address, detailed issue history toggle, SCIM group mapping, team hierarchy (parent), retire/delete |
| Members | Membership, promote to team owner |
| Access and permissions | Visibility (public/private/restricted), join policy (open vs invite-only), issue sharing (Enterprise), and per-permission "all members vs team owners only" for: issue labels, templates, team settings, member management, agent skills, loop management |
| Issue labels | Team labels + groups |
| Templates | Issue/project/document templates, per-template email address, default templates (separately for team members vs non-members) |
| Recurring issues | List + create |
| Slack notifications | Team-level channel notifications |
| Issue statuses & automations | Statuses per category, default status, git/PR automations incl. branch-specific rules, branch name format, parent/sub-issue auto-close, auto-close and auto-archive periods |
| Triage | Enable, require priority on exit, triage responsibility + on-call provider, triage rules, triage intelligence scope and auto-apply behaviour |
| Cycles | Enable, duration, cooldown, start day, upcoming count, rollover and auto-add automations |
| AI & Agents | Team agent guidance, team-shared skills |

### Membership and access
- All workspace members can view and join any non-private team. You do **not** need to join a team to create issues in it, be assigned issues in it, or search it.
- Teams you visit but haven't joined appear under a temporary **Exploring** section in the sidebar.
- Team owners can restrict joining to invite-only.
- Admins can add users to teams from Settings → Members.

### Retire vs delete
- **Retire:** freezes the team. Read-only issues and settings; projects associated *only* with retired teams become read-only; removed from sidebars. Resolve active/backlog issues and sub-teams during the retirement flow. Restorable at any time. Archival behaviour continues to apply.
- **Delete:** permanently deletes the team *and its issues*. 30-day restore window from Settings → Teams → Recently deleted. Advice given to users: export CSV or move issues first.

## Private teams (Business+)

- Anyone can create a private team; only workspace owners/admins/team owners can change an existing team's visibility.
- Converting to private removes non-members from issue assignments and unsubscribes non-member subscribers.
- Non-members cannot see the team's issues and cannot be @mentioned into them.
- On Enterprise, **owners** can see private teams in settings and must explicitly join to see issues (with a confirmation warning). On other paid plans, **admins** can see and join private teams.
- **Projects:** a project on a public team can also be shared with a private team — only private-team members see that association and the private team's issues. Remove all public teams and the project becomes private. Projects created on private teams are private until shared with a public team.
- **Initiatives:** private-team projects show on initiatives to their members only; the initiative itself remains workspace-visible. A private *lead team* makes an initiative private.
- Integration behaviour differs per integration — see `02-integrations/00-integration-catalog.md` (GitHub/GitLab post ID-only linkbacks; Sheets excludes private data; Intercom/Zendesk/Sentry can't target private teams; Airbyte sees everything).
- **API caveat to design for:** personal API keys of private-team members, webhooks created by team owners/admins, and tools like Zapier can expose private team data. This is documented as a customer responsibility, but a clone should surface it clearly.

## Restricted vs private sub-teams

Under a private parent:
- **Restricted** (default): parent members can see the sub-team and self-join.
- **Private**: only explicitly added members can see it.
Private parents can only have private/restricted sub-teams — never public ones.

## Sub-team inheritance rules (implementation critical)

| Concern | Rule |
|---|---|
| Membership | Sub-team members must be parent members (guests exempt) |
| Cycles | Parent schedule is mandatory for sub-teams. Merging: past cycles untouched; current sub-team cycle closes; upcoming map to nearest parent cycles |
| Statuses | Sub-team may opt into inheriting |
| Estimates | Sub-team may opt into inheriting |
| Labels | Sub-team can use its own + parent + workspace labels; inherited labels are edited in the parent |
| Templates | Sub-team can use its own + parent + workspace templates |
| Views | Parent views can include accessible sub-team issues; sub-teams also have their own |
| Independent | Timezone, recurring issues, git automations, Slack notifications, triage, integrations, permission settings (**not** inherited) |
| Member management permission | Parent sets a *minimum* restriction that sub-teams cannot loosen |
| Un-nesting | Unused inherited labels/templates dropped; used ones converted to standalone copies so issues stay intact |

Team owners of a parent are automatically team owners of its sub-teams. Sub-teams are **not** considered when mapping Jira spaces or GitHub repos — those map per-team explicitly. You cannot import directly into a sub-team; import into a top-level team and re-parent afterwards.

## Team issue limit

60,000 non-archived issues per team. Archived issues don't count; completed ones still do until archived. Over the limit, integration/API issue creation is blocked. Warning banner shows to team members (dismissible, returns on re-hit); admins get warning emails first. Remedies offered: delete old issues, move issues to another team, shorten auto-archive period.

## Open decisions for the clone

- **[OPEN]** Whether to support multiple workspaces per account from day one (it complicates auth, billing, and the sync client).
- **[OPEN]** Data residency. Linear's split (content in-region, identity/analytics in US) is a real architectural commitment; deferring it means a painful migration later.
- **[INFERRED]** Team key uniqueness is per workspace and immutable-ish (changing it breaks GitHub autolinks; Linear warns about this).
