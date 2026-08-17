# Integration catalogue

Linear ships ~20 first-party integrations plus a public directory of **250+** third-party ones. Every integration is built on the same public GraphQL API + webhooks + OAuth that external developers use — that is a deliberate architectural constraint and the clone should adopt it.

## First-party integrations

| Integration | Category | Plan | Core capability | Detail |
|---|---|---|---|---|
| **GitHub** | Source control | All (Enterprise for GHEC/GHES) | PR/commit linking, status automation, Issues sync, code access → diffs/Code Intelligence/coding sessions | `01-source-control.md` |
| **GitHub Enterprise Cloud** | Source control | Enterprise | Same, `*.ghe.com` install flow | `01-source-control.md` |
| **GitHub Enterprise Server** | Source control | Enterprise | Reduced feature set, separate app | `01-source-control.md` |
| **GitLab** | Source control | All | MR linking + automation, self-hosted supported | `01-source-control.md` |
| **Slack** | Chat | All (multi-workspace Enterprise) | `@Linear` agent, issue creation, synced threads, unfurls, team/project/view notifications, auto project channels | `02-chat.md` |
| **Linear Asks (Slack)** | Chat / intake | Business+ | Non-Linear-user request intake | `01-features/14-asks.md` |
| **Microsoft Teams** | Chat | All (multi-tenant Enterprise) | `@Linear` agent, project channel connection | `02-chat.md` |
| **Discord** | Chat | All | `/linear issue`, `/linear search`, `/linear wrap`, message linking | `02-chat.md` |
| **Intercom** | Support | Business+ | Create/link issues, Linear Agent creation, templates, re-open conversations, internal notes, customer attribute source (real-time) | `03-support-and-crm.md` |
| **Zendesk** | Support | Business+ | Same shape as Intercom | `03-support-and-crm.md` |
| **Front** | Support | Business+ | Same shape; can reach private teams | `03-support-and-crm.md` |
| **Salesforce** | CRM | Enterprise add-on (paid licences) | Case ↔ issue/project linking, template-driven creation, attribute mapping, triage rules on case properties, SOQL over Linear data | `03-support-and-crm.md` |
| **Gong** | Revenue intelligence | Enterprise | Auto-creates issues from call transcripts with speaker-attributed excerpts + timestamps | `03-support-and-crm.md` |
| **Sentry** | Monitoring | All | Create/link issues, auto-resolve, assignee sync, alert-driven creation | `04-monitoring-design-data.md` |
| **PagerDuty / Opsgenie / Rootly / incident.io** | On-call | Business+ (triage responsibility) | Drive triage responsibility rotation; custom schedules via API | `04-monitoring-design-data.md` |
| **Figma** | Design | All | Embedded previews in Linear + a Figma plugin to create/link/update issues from frames | `04-monitoring-design-data.md` |
| **Notion** | Docs | All | Embeds Linear issues/projects/initiatives/views into Notion pages | `04-monitoring-design-data.md` |
| **Google Sheets** | Data | All | Hourly sync of issues/projects/initiatives from public teams | `04-monitoring-design-data.md` |
| **Airbyte** | Data | Enterprise | ETL of ~22 models into warehouses/lakes (open-source Airbyte only) | `04-monitoring-design-data.md` |
| **Zapier** | Automation | All | 5 actions, 8+ triggers, no-code workflows | `04-monitoring-design-data.md` |
| **Jira** | Sync | All | Space ↔ team two-way sync + import | `05-jira-sync.md` |
| **Google Calendar** | Personal | All | Out-of-office status in Linear | `01-features/19-clients-sync-preferences.md` |
| **MCP server** | AI | All | Linear as a tool for external AI clients | `03-platform/05-mcp-server.md` |
| **MCP connectors** | AI | All (admin-gated) | 16 named servers + custom URLs, consumed by Linear Agent and loops | `01-features/15-ai-agents-loops-coding-sessions.md` |

## Cross-cutting integration mechanics

These are shared primitives, not per-integration features. Build them once.

### Link attachments
Every integration that "links" something creates an **Attachment** on the issue: title, subtitle, URL, icon, arbitrary metadata, optional rich modal content. The URL is **idempotent per issue**, so integrations can be stateless. Attachments are queryable by URL. Removing a link = right-click the attachment → Remove.

Issues become filterable by **Links → \<source\>** for every integration (GitHub, GitLab, Front, Zendesk, Intercom, Discord, Slack, Sentry, custom).

### Synced comment threads
Slack, Asks (Slack/email/web), GitHub Issues sync, and Jira sync all bind a Linear comment thread to an external thread with bidirectional replies. Comments made **outside** the synced thread stay Linear-only — the documented mechanism for private discussion.

### Linkbacks
When an issue is linked from GitHub/GitLab, Linear posts a comment back containing the issue title and description (including images and attachments). **For private teams the title is withheld** — only the link is posted. Disableable per integration.

### Re-open the conversation
Support integrations (Intercom, Zendesk, Front, Salesforce) post an internal note and re-open the customer conversation/case when the linked issue is completed or canceled — separately configurable for completed / canceled / new comment. This is how the customer feedback loop closes.

### Duplicate merging
When issues carrying support attachments are merged as duplicates, attachments **and** comments move to the canonical issue, and the external ticket is re-pointed so automations keep working.

### Templates in integrations
Up to 10 templates surfaced per support integration; Slack and Asks support form templates; private-team templates are unavailable to Slack/Intercom/Zendesk (Asks is the supported path).

### Personal account connections
Most integrations need each user to link their own third-party account so activity attributes to them rather than to a generic bot: GitHub, GitLab (token-owner caveat), Slack, Jira, Microsoft, Intercom/Zendesk/Front agents, Figma.

### Egress IP allow-list
Linear sends webhooks and makes outbound calls from a published set of IPs, needed for GitHub IP allow lists, GitLab self-hosted, and webhook verification:

```
35.231.147.226  35.243.134.228  35.196.141.51
34.140.253.14   34.38.87.206    34.62.119.29
34.134.222.122  35.222.25.142   34.60.255.158
```

### Private team behaviour by integration

| Integration | Behaviour with private teams |
|---|---|
| GitHub / GitLab | Linkbacks contain the issue ID and link only — no title |
| Google Sheets | Private team data excluded entirely |
| Intercom, Zendesk, Sentry | Cannot create or link issues in private teams |
| Front | **Can** create/link if the user has access to the private team |
| Airbyte | Loads **all** public and private team data (no exclusion mechanism) |
| Slack | Private-team URLs never unfurl |
| Zapier / API / webhooks | Can expose private team data — treated as a customer responsibility |

## Third-party directory

- The public directory lists Linear-built (verified badge) and third-party integrations. Most require workspace admin to install.
- Submission process: a form, plus assets — colour icon 320×320, monochrome white icon 320×320, and 1–3 showcase images 1600×1000 (SVG/JPEG/PNG). Linear provides a Figma template and asks for designed images rather than raw screenshots.
- Acceptance policy: useful to the community and built by formal companies; scripts, low-effort/vibe-coded apps, and hobby projects are generally declined.
- Recommended build practice: OAuth-based, with a **separate workspace for the application** so all admins (not just the creator) can manage it.

## Notable third-party targets to support at launch

Named across the docs: Zapier ecosystem (Typeform, Gmail, Google Forms, Airtable, Todoist, Productboard, …), Bugsnag, Plain, incident.io, Rootly, Opsgenie, Cursor, Codegen, Claude Code, Codex, Windsurf, Zed, v0, Jules, Tableau (via API), Loom, Descript, YouTube.
