# Monitoring, on-call, design, docs, data, automation

## Sentry

Enable in workspace integration settings. From a Sentry issue's sidebar: **Create Linear issue** (description pre-filled with Sentry details; you add title, team, assignee, priority) or **Link Linear issue** (search by ID or title).

Automations:
- Completing the Linear issue **auto-resolves** linked Sentry issues.
- Changing the Linear assignee updates the Sentry assignee (matched by identical email).
- Sentry **alert rules** (issue/event alerts and metric alerts) can auto-create Linear issues — Alerts → Create Alert → add a Linear action.

Display: most list/board views can show a Sentry icon on linked issues (Display properties) that deep-links to Sentry.

Limitations: **cloud accounts only** (no self-hosted), **one Sentry organization** per workspace, **public Linear teams only** — converting a team to private breaks existing connections.

## On-call: PagerDuty, Opsgenie, Rootly, incident.io

Consumed by **triage responsibility** (Business/Enterprise): connect a schedule and Linear rotates the person who is notified about, or auto-assigned, new triage issues. For other providers, Linear exposes an API so a custom schedule can be pushed. incident.io also appears as an MCP connector.

## Figma

Two distinct pieces:

**1. Embeds in Linear.** Connect in Settings → Features → Integrations → Figma (do this **in a browser**, not the desktop client; it then works workspace-wide). Paste a link to a file/frame and Linear renders a design preview in issue descriptions, comments, and documents.
- Previews are **snapshots** — they don't auto-refresh, preserving the context of surrounding comments. A refresh button appears on the embed in edit mode.
- In-app interactive preview supports **publicly shared Figma files only**; private-file support is "under consideration". Built on Figma's API with OAuth2 rather than the standard embed, for speed.
- The **installer of the integration** must have access to the file, or you get "unable to embed from Figma / insufficient permissions" — even if you personally can see it.
- Brave users must allow cross-site cookies for authenticated embeds. Embeds can't be collapsed; the workaround is hyperlinking text instead of pasting the raw URL.

**2. Linear plugin for Figma.** Run from Resources → Plugins → Linear (or the Figma Community). With a frame, section, or page selected you can: create issues linked to that element, link existing issues (search by ID/title/description), update properties (team, status, assignee, project) directly from Figma, and filter/sort the plugin's issue list (hide completed/cancelled, only mine, sort by status/priority/name/created). Many-to-many linking is supported. From Linear's side, attach Figma links with `Ctrl+L`.

**Privacy specifics Linear publishes** (worth mirroring): opening the plugin transmits the current file key; connecting a frame stores that file key to enable bidirectional linking; **any user with access to the issue can access the stored file key**; data is removable by disconnecting the frame or deleting the team/workspace, with a security@ address for permanent deletion.

## Notion

Per-user integration (each person connects their own account); multiple Notion workspaces may connect to one Linear workspace.

Paste a Linear issue/project/initiative/view link into Notion and choose rich preview, mention, or raw URL. Previews update when the underlying Linear data changes (on page reload or manual refresh). Deliberately **preview-only** — not a two-way workflow.

Setup either by pasting a link into Notion and following the prompts, or from Settings → Features → Integrations → Notion.

## Google Sheets

Creates a Google Sheet (`Linear Issues`) in the connected account's Drive, optionally plus sheets for **projects** and **initiatives**.

- **Public teams only** — issues from public teams, and projects belonging to at least one public team. No private data. No selection beyond issues/projects/initiatives.
- Refreshes **hourly when there are changes**; manual refresh via `Cmd/Ctrl+K` → *Sync to Google Sheets* (admins) or the integration page's *Update now*.
- One Google account per workspace; share the sheet itself with teammates.
- Renaming or moving the sheet is safe. Editing cells is not — changes are overwritten; do analysis in a separate sheet with `IMPORTRANGE`/`VLOOKUP`.
- Synced columns: see `01-features/18-import-export-migration.md` for the issue/project/initiative column sets; the Sheets issue sheet also carries `Roadmaps`, and the project sheet adds `URL`, `Start Date (Start/End)`, `Target Date (Start/End)`, `Updated At`, `Archived At`, `Customer Count`, `Customer Revenue`.
- **Timestamp semantics**: status-category transitions only (moving between two Started statuses doesn't restamp); nulls mean the state was never reached or was cleared (Backlog → Done → In Progress clears `Completed`); **all times are GMT**.

Documented analytics uses: per-member velocity, work-type breakdown via prefixed labels (`type: bug`), Gantt charts, bug ratios per cycle, and time-in-state measurement.

## Airbyte (Enterprise)

ETL of Linear data into warehouses, lakes, and databases. **Airbyte Open Source only** — Airbyte Cloud is not supported.

- Configured by a **workspace owner**: Settings → Integrations → Airbyte → Enable → copy the one-time API key. That key grants **read access to all supported tables**, and **there is no way to exclude private teams**.
- Setup: run Airbyte locally (Docker), add a custom connector — display name `Linear`, Docker repo `gcr.io/linear-public-registry/linear-airbyte-source`, tag `latest` — then create a connection with the Linear API key and choose a destination.
- Sync modes: **Full Refresh** and **Append** only (no incremental). Minimum cadence **12 hours**.
- Synced models: Organization, Teams, Team Key, Team Membership, User, Milestone, Project, Project Updates, Project Link, Issues, Issue History, Issue Label, Issue Relation, Integration Resource, Attachment, Audit Entry, Comment, Cycle, Workflow State, Document, Document Content.
- Remove by deleting the connection in Airbyte.

## Zapier

No-code automation, open source, free trial then usage-based on Zapier's side.

**Actions** (things Zapier can do in Linear): create issue, update issue, create issue attachment, create comment, create project.
**Triggers** (things that start a Zap): new issue, new issue comment, new document comment, new project, new project update, new project update comment, updated issue, updated project update, and more.

Notes: issues created through Zapier show as created by **"Zapier"**, not the authorising user. The comment trigger fires on new comments only, not edits. `@[displayName](userId)` syntax mentions Linear users from a Zap. Old Zapier integration versions must be updated from the Zap's status pane.

Documented example workflows: create a bug-labelled issue from an email containing keywords; create an issue when an Intercom tag is applied; let non-Linear users file via a web form (Typeform/Google Forms); create an issue when a database query returns a new row; create a Linear issue per new calendar entry; schedule recurring issues with Schedule by Zapier.

## Ops/marketing usage patterns worth supporting

Linear documents non-engineering usage explicitly — sales pipelines (`Lead > Contacted > In discussion > Onboarded > Closed-won > Churned`) and content pipelines (`Ideas > Todo > In Progress > Drafted > In Review > Ready to publish > Published > Canned`) as **custom workflows**, plus recurring issues, filters/views with due dates, form-driven intake via Zapier, and the support integrations. Keep workflow customisation general enough for these.
