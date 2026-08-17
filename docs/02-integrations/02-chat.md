# Chat: Slack, Microsoft Teams, Discord

## Slack

The richest integration after GitHub. Connect in Settings → Integrations → Slack (admin, or owner on Enterprise). **Enterprise** can connect multiple Slack workspaces (e.g. Enterprise Grid).

Once connected, any workspace member can: mention `@Linear`, act on rich unfurls, enable personal Slack notifications, and route team/project/initiative/view notifications to channels.

### Linear Agent in Slack
Mention `@Linear` to act on conversation context in natural language:
- `@Linear file a bug, assign me`
- `@Linear make feature requests from this thread`
- `@Linear who usually works on notifications?`
- `@Linear what's the latest progress on the billing API project?`

Setup by conversation type: **public channels** — mention directly (Linear may auto-join); **private channels** — `/invite @Linear` first; **group DMs** — the agent must be present at DM creation and cannot be added later.

Slack's Workflow Builder can be allowed to mention `@Linear` for automation.

**Agent guidance for Slack is separate** from the general Linear Agent guidance: configured in the Slack integration settings, covering how to turn Slack messages into issues — channel naming conventions and their mapping to projects, preferred statuses, fallback team, and so on. The agent also infers context (e.g. issues created in a channel that receives a project's updates favour that project). Personal agent guidance applies in both places.

### Creating issues
| Method | Notes |
|---|---|
| `@Linear` | Conversational, context-aware |
| Message overflow → More actions → Connect to apps → Create new issue… | Full property control; applies the team's default template text |
| `/linear` slash command | Lightweight; confirmed with an ephemeral message. **Not supported in threads, for Slack sync, or file upload** |
| Asks (`@Linear Asks`, 🎫, `/Asks`, auto-create) | For users **without** Linear accounts — see `01-features/14-asks.md` |

Only users with Linear accounts can create issues via the standard integration; Slack Guests can't use it at all (Slack blocks them from installing/approving apps).

**Templates**: up to 10 issue templates exposed in the Slack integration (from workspace template settings or the Slack settings page); the team's default template appears as an extra option after team selection. Private-team templates are unavailable — use Asks.

### Synced threads
- Created by using **Create new issue…** on a Slack message. Comments then flow both ways; the Slack thread is updated when the issue is completed, canceled, or marked duplicate (including when a duplicate's canonical issue resolves).
- Requires the app in the channel (`/invite @Linear`); **not available in DMs**, and files from DMs can't be attached.
- Linking without syncing: **Link existing issue** from the message menu (no terminal updates, no synced thread), or copy the Slack message URL and attach it in Linear with `Ctrl+L` (silent).
- API: `attachmentLinkSlack` with `syncToCommentThread: true` binds an existing thread.

### Notifications
| Type | Where configured | Behaviour |
|---|---|---|
| **Team** | Team settings → Slack notifications | Channel feed of issue creation, comments, status changes, project updates |
| **Project / Initiative** | Bell icon on the project/initiative | Channel feed for that item's activity and updates |
| **Personal** | Settings → Notifications | DM from the Linear app, mirroring Inbox/email/desktop |
| **View subscriptions** | View ⋯ → Configure custom view Slack notifications | On issue added and/or completed/canceled |

### Project Slack channels
Admins can enable *Create channel for new projects* (Slack settings → Project channels). Linear then: creates a public Slack channel per new project, invites all project members, and bookmarks the Linear project in the channel. Workspaces connected before these scopes existed must reauthorise (owner/admin).

### Unfurls
Issue, project, document, and initiative links from **public** teams expand with rich previews. Private-team URLs **never** unfurl. Disableable in settings.
- Issue unfurls show title, description, status, assignee, creation date, and give Linear users actions: change assignee, comment, subscribe/unsubscribe, start thread sync.
- Project unfurls show name, description, status, target date.
- Bare issue IDs in messages auto-reply with the issue link, de-duplicated within **60 minutes** per thread. Disableable.
- Unfurl visibility follows the **channel**, not the viewer's Linear role — relevant to the guest-leakage caveat.
- Known failure mode: installing **Asks before** the Slack integration breaks unfurls; the fix is a full disconnect/reinstall in the right order (and re-toggling Asks templates per team afterwards).
- Slack Preferences → Messages & Media → "Show text previews of linked websites" must be on.

### Slackbot + MCP
Linear's MCP server can be connected to Slackbot to bring Linear context into Slackbot conversations — distinct from `@Linear`.

---

## Microsoft Teams

Available on all plans; **one tenant per workspace**, multiple tenants on Enterprise.

### Setup
1. Settings → Integrations → Microsoft Teams — done by a Linear admin/owner who also has Microsoft tenant admin privileges.
2. A Teams admin installs the Linear app from the Microsoft Teams marketplace — via the **Teams Admin Center** if apps are centrally managed (Teams apps → Manage apps → allow Linear, then make it available to the right users/groups). Check Org-wide app settings if third-party apps are restricted.
3. Each user whose Teams email differs from their Linear email connects their Microsoft account in the same settings page (one account, one tenant).

### Capabilities
Mention or message `@Linear` to create issues and projects, ask about workspace state, and turn discussions into follow-up — e.g. "file a bug for this and assign it to me", "what's the latest progress on our billing API project?", "create issues for each feature request mentioned in this thread".

**Project channel connection**: bind a Linear project to a Teams channel to post project updates there and give the conversation project context. Available channels depend on the configuring user's access; **shared channels are not supported**.

**Private channels**: Microsoft's app support for private channels is in public developer preview — Linear Agent only works there if the tenant is on **Targeted Release**.

Notes: Teams for Personal Use is unsupported (Work and School only). Guests in shared channels cannot use `@Linear`. Thumbs up/down feedback controls on replies.

---

## Discord

Available on all plans. A Linear admin enables it; **every user must individually link their Discord account** (Settings → Integrations → Discord).

Commands:
- `/linear issue` — create an issue (title + team required; optional description, status, assignee, project).
- `/linear search` — search by issue ID or words in title/description/comments (same engine as in-app search); posts the selected issue to the channel.
- `/linear wrap` — post a summary of the issues you started or completed in the last 24 hours.

Linking Discord messages to issues: issue ⋯ → Add link → Discord message, or command menu → *Link Discord message…*. Unlink by right-clicking the attachment. Filter with `F` → Links → Discord.

Requires the **Read Message History** permission in order to fetch message content when linking. Project update notifications to Discord are **not** supported.
