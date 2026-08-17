# Feature inventory

Every feature that has to exist for this to be a copy of Linear. Use as the master checklist.

**Size** is a rough build estimate for a competent team: **S** ≈ days · **M** ≈ 1–3 weeks · **L** ≈ 1–2 months · **XL** ≈ a quarter or more (usually a subsystem, not a feature).
**Phase** refers to `02-build-phases.md`.

## 1. Foundations

| # | Feature | Size | Plan | Depends on | Phase |
|---|---|---|---|---|---|
| 1.1 | Workspace creation, URL key, icon, data region | M | all | — | 0 |
| 1.2 | Auth: email magic link, Google | M | all | 1.1 | 0 |
| 1.3 | Passkeys | S | all | 1.2 | 3 |
| 1.4 | Sessions list, revoke, 30-day expiry, global logout | S | all | 1.2 | 1 |
| 1.5 | Multi-account / multi-workspace switching | M | all | 1.1 | 2 |
| 1.6 | Roles: member, admin | S | all | 1.1 | 0 |
| 1.7 | Team owner role + per-team permission toggles | M | Business+ | 1.6, 2.1 | 2 |
| 1.8 | Workspace owner role + limited admin + workspace restrictions | M | Enterprise | 1.6 | 3 |
| 1.9 | Guests | M | Business+ | 1.6, 2.1 | 3 |
| 1.10 | Invitations, approved domains, invite links, invite & assign | M | all | 1.6 | 1 |
| 1.11 | Member management, suspend, CSV export | S | all | 1.6 | 1 |
| 1.12 | **Real-time sync engine + offline queue** | XL | all | 1.1 | 0 |
| 1.13 | Entitlement/plan-gating service | M | all | 1.1 | 1 |
| 1.14 | Billing: per-seat, monthly/annual, pro-rated true-ups | L | all | 1.13 | 2 |
| 1.15 | AI credits: balance, top-up, auto-reload, expiry, order of use | L | Basic+ | 1.14 | 4 |
| 1.16 | Spend limits (workspace/user/loop, cadence, reset schedule) | M | Basic+ | 1.15 | 4 |
| 1.17 | Discount programmes (education, non-profit, startups) | S | all | 1.14 | 5 |

## 2. Teams

| # | Feature | Size | Plan | Depends on | Phase |
|---|---|---|---|---|---|
| 2.1 | Teams: CRUD, key, timezone, copy-settings, limits per plan | M | all | 1.1 | 0 |
| 2.2 | Team membership, join/leave, Exploring section | S | all | 2.1 | 0 |
| 2.3 | Team home page + pinned resources + team documents | M | all | 2.1, 6.2 | 2 |
| 2.4 | Private teams + visibility rules across projects/initiatives | L | Business+ | 2.1 | 3 |
| 2.5 | Sub-teams + inheritance rules | L | Business+ | 2.1 | 3 |
| 2.6 | Multi-level sub-teams (5 deep) | M | Enterprise | 2.5 | 4 |
| 2.7 | Restricted vs private sub-teams | S | Business+ | 2.4, 2.5 | 4 |
| 2.8 | Retire team / delete team / restore (30 days) | M | all | 2.1 | 3 |
| 2.9 | Team issue limit (60k) + warnings | S | all | 3.1 | 3 |

## 3. Issues

| # | Feature | Size | Plan | Depends on | Phase |
|---|---|---|---|---|---|
| 3.1 | Issue CRUD, identifiers, activity history | L | all | 2.1, 3.2 | 0 |
| 3.2 | Workflow statuses + categories + default status | M | all | 2.1 | 0 |
| 3.3 | Assignee | S | all | 3.1 | 0 |
| 3.4 | Priority (fixed scale) + global manual priority ordering | M | all | 3.1 | 0 |
| 3.5 | Labels + label groups (workspace/team), archive, merge, bulk ops | L | all | 3.1 | 1 |
| 3.6 | Estimates (4 scales + extended + zero + unestimated default) | M | all | 3.1 | 1 |
| 3.7 | Due dates | S | all | 3.1 | 1 |
| 3.8 | Relations (blocks/blocked/related/duplicate) + duplicate merge | M | all | 3.1 | 1 |
| 3.9 | Parent/sub-issues + inheritance + auto-close automations | M | all | 3.1 | 1 |
| 3.10 | Multi-select + bulk actions + manual reorder | M | all | 3.1 | 0 |
| 3.11 | Move issue between teams + ID redirect + field remapping | M | all | 3.1 | 1 |
| 3.12 | Delete + 30-day recovery + undo | S | all | 3.1 | 1 |
| 3.13 | Auto-close + auto-archive engines with blocking conditions | M | all | 3.1, 6.1 | 2 |
| 3.14 | Archives page (issues/cycles/projects/docs, recently deleted) | M | all | 3.13 | 2 |
| 3.15 | Drafts: local + persisted (6 months) | S | all | 3.1 | 2 |
| 3.16 | Issue templates (standard) | M | all | 3.1 | 1 |
| 3.17 | Form templates + field types | M | all | 3.16 | 3 |
| 3.18 | Default templates (members vs non-members) | S | all | 3.16 | 3 |
| 3.19 | Recurring issues | M | all | 3.16 | 3 |
| 3.20 | Creation URLs with query params | S | all | 3.1 | 2 |
| 3.21 | Email-to-issue (team + template addresses) | M | all | 3.1 | 3 |
| 3.22 | SLAs: rules, durations, business days, statuses, notifications | L | Business+ | 3.1, 3.4 | 4 |
| 3.23 | Private issue sharing out of private teams | M | Enterprise | 2.4 | 5 |

## 4. Cycles

| # | Feature | Size | Plan | Depends on | Phase |
|---|---|---|---|---|---|
| 4.1 | Cycle config: duration, cooldown, start day, upcoming count | M | all | 2.1 | 2 |
| 4.2 | Auto-creation + rollover + cooldown semantics | M | all | 4.1 | 2 |
| 4.3 | Auto-add active/completed issues | S | all | 4.2 | 2 |
| 4.4 | Cycle editing, "start cycle today", pause gaps | M | all | 4.1 | 3 |
| 4.5 | Cycle graph + cycle success | M | all | 4.2, 3.6 | 3 |
| 4.6 | Capacity dial (trailing 3-cycle velocity) | S | all | 4.5 | 3 |
| 4.7 | Cycle calendar subscription (ICS/Google/feed) | S | all | 4.1 | 5 |
| 4.8 | Sub-team cycle inheritance | M | Business+ | 2.5, 4.1 | 4 |

## 5. Projects and initiatives

| # | Feature | Size | Plan | Depends on | Phase |
|---|---|---|---|---|---|
| 5.1 | Projects CRUD, multi-team, properties, timeframe dates | L | all | 2.1, 3.1 | 1 |
| 5.2 | Workspace project statuses (custom, categorised) | S | all | 5.1 | 2 |
| 5.3 | Project overview page (description, resources, docs) | M | all | 5.1, 6.2 | 2 |
| 5.4 | Milestones + progress + reorder + convert to project | M | all | 5.1 | 2 |
| 5.5 | Project graph + velocity prediction | L | all | 5.1, 3.6 | 3 |
| 5.6 | Project updates + health + auto progress summary | M | all | 5.1 | 3 |
| 5.7 | Update reminders, staleness, per-project schedule | M | all | 5.6 | 4 |
| 5.8 | Project labels + groups + list columns | S | all | 5.1 | 4 |
| 5.9 | Project priority + ordering | S | all | 5.1, 3.4 | 3 |
| 5.10 | Project dependencies + timeline rendering + drag ergonomics | M | all | 5.1, 7.5 | 4 |
| 5.11 | Project templates | M | all | 5.1, 3.16 | 4 |
| 5.12 | Attached project views / issue views as tabs | M | all | 5.1, 7.6 | 4 |
| 5.13 | Initiatives + properties + labels | M | all | 5.1 | 3 |
| 5.14 | Initiative updates + health roll-up + active-project colours | M | all | 5.13, 5.6 | 4 |
| 5.15 | Sub-initiatives (5 levels, multi-parent, aggregation) | L | Enterprise | 5.13 | 5 |
| 5.16 | Initiative views + tabs | M | Enterprise | 5.13, 7.6 | 5 |
| 5.17 | Initiative graph | S | Enterprise | 5.13 | 5 |
| 5.18 | Team initiatives + private lead teams | S | all | 5.13, 2.4 | 5 |

## 6. Content

| # | Feature | Size | Plan | Depends on | Phase |
|---|---|---|---|---|---|
| 6.1 | Rich editor (markdown, slash menu, tables, mermaid, embeds) | XL | all | — | 0 |
| 6.2 | Documents + collaborative editing + version history | L | all | 6.1, 1.12 | 2 |
| 6.3 | Document templates, subscriptions, author names | M | all | 6.2 | 4 |
| 6.4 | Comments + threads + resolve + reactions | L | all | 6.1 | 1 |
| 6.5 | Inline comments on descriptions/documents | M | all | 6.1 | 3 |
| 6.6 | Resolved-thread AI summaries | S | Business+ | 6.4, 11.1 | 5 |
| 6.7 | Synced comment threads (Slack/email/GitHub/Jira) | L | all | 6.4 | 4 |
| 6.8 | Attachments (URL-idempotent, rich metadata, date tokens) | M | all | 3.1 | 2 |
| 6.9 | File upload + authenticated asset serving | M | all | — | 1 |

## 7. Navigation, views, analytics

| # | Feature | Size | Plan | Depends on | Phase |
|---|---|---|---|---|---|
| 7.1 | Command menu (`Cmd/Ctrl+K`) with scoped prefixes | L | all | — | 0 |
| 7.2 | Global search (`/`) incl. ID shorthand, stop words, quotes | L | all | 3.1 | 1 |
| 7.3 | In-view find (`Cmd/Ctrl+F`) | S | all | 7.5 | 1 |
| 7.4 | Filters: operators, advanced AND/OR groups, quick filters, URL sync | L | all | 3.1 | 1 |
| 7.5 | Layouts: list, board (+ hide columns, swimlanes), timeline | L | all | 3.1, 5.1 | 1 |
| 7.6 | Custom views (issue/project/initiative) + scoping + ownership | L | all | 7.4 | 2 |
| 7.7 | Display options + set-as-default + display properties | M | all | 7.5 | 1 |
| 7.8 | Peek preview | S | all | 7.5 | 2 |
| 7.9 | Favorites + folders | S | all | — | 2 |
| 7.10 | Label views, user views, cycle sidebar distribution | S | all | 3.5 | 3 |
| 7.11 | Filter with AI | M | all | 7.4, 11.1 | 5 |
| 7.12 | Insights (6 measures, slices, segments, burn-up, interactions) | XL | Business+ | 7.4 | 4 |
| 7.13 | Dashboards + global/per-tile filters + personal dashboards | L | Enterprise | 7.12 | 5 |
| 7.14 | Ad-hoc multi-issue URL lists | S | all | 3.1 | 4 |

## 8. Intake

| # | Feature | Size | Plan | Depends on | Phase |
|---|---|---|---|---|---|
| 8.1 | Triage inbox + accept/duplicate/decline/snooze | M | all | 3.1, 3.2 | 2 |
| 8.2 | Require priority on exit; exclude triage from views | S | all | 8.1 | 2 |
| 8.3 | Triage responsibility + on-call provider integrations | M | Business+ | 8.1 | 4 |
| 8.4 | Triage rules engine | L | Business+ | 8.1, 7.4 | 4 |
| 8.5 | Triage Intelligence (suggestions, duplicates, auto-apply, guidance) | XL | Business+ | 8.1, 11.1 | 5 |
| 8.6 | Asks: Slack | L | Business+ | 8.1, 3.17, 10.2 | 4 |
| 8.7 | Asks: Email (forwarding, DMARC, auto-replies, synced thread) | L | Business+ | 8.1, 6.7 | 5 |
| 8.8 | Asks: Web forms (SAML-gated, pages, custom domain) | L | Enterprise | 8.7, 1.8 | 6 |
| 8.9 | Advanced Asks Slack behaviours | M | Enterprise | 8.6 | 6 |

## 9. Delivery

| # | Feature | Size | Plan | Depends on | Phase |
|---|---|---|---|---|---|
| 9.1 | GitHub: PR/branch/commit linking + magic words | L | all | 3.1, 12.1 | 2 |
| 9.2 | GitHub: status automations + branch-specific rules | M | all | 9.1 | 3 |
| 9.3 | GitHub: linkbacks, preview links, autolinks, review state | M | all | 9.1 | 3 |
| 9.4 | GitHub Issues sync (1-way / 2-way) | L | all | 9.1, 6.7 | 4 |
| 9.5 | GitHub Enterprise Cloud / Server | M | Enterprise | 9.1 | 5 |
| 9.6 | GitLab (token model, MR automation, pipelines) | L | all | 9.1 | 4 |
| 9.7 | Reviews/Diffs surface (unified/split, structural highlight, merge) | XL | all | 9.1 | 5 |
| 9.8 | PR Guides (AI-structured review) | L | Business+ | 9.7, 11.1 | 6 |
| 9.9 | Releases: pipelines, releases, CI ingest, notes, changelogs | L | Business+ | 3.1 | 5 |
| 9.10 | Open-in-coding-tool + custom scripts | M | all | 3.1 | 4 |

## 10. Communication integrations

| # | Feature | Size | Plan | Depends on | Phase |
|---|---|---|---|---|---|
| 10.1 | Notification engine (types, channels, digests, grouping) | L | all | 3.1 | 1 |
| 10.2 | Slack: agent, issue creation, unfurls, notifications, project channels | XL | all | 10.1, 6.7 | 3 |
| 10.3 | Microsoft Teams | L | all | 10.1 | 5 |
| 10.4 | Discord | M | all | 10.1 | 6 |
| 10.5 | Inbox + snooze + reminders + quick search | L | all | 10.1 | 1 |
| 10.6 | My Issues (4–5 tabs, focus ordering) | M | all | 3.1 | 1 |
| 10.7 | Pulse (feed, tabs, digests, custom feeds, audio) | L | all | 5.6, 11.1 | 5 |
| 10.8 | View subscriptions (personal + Slack) | M | all | 7.6, 10.2 | 4 |

## 11. AI

| # | Feature | Size | Plan | Depends on | Phase |
|---|---|---|---|---|---|
| 11.1 | Linear Agent core (context assembly, permissions, tools) | XL | all | most of 1–7 | 4 |
| 11.2 | Agent chat (tabs, history, related-chat surfacing) | L | all | 11.1 | 4 |
| 11.3 | Agent in comments/documents/descriptions | M | all | 11.1, 6.1 | 4 |
| 11.4 | Guidance (workspace/team/personal, doc references) | M | all | 11.1 | 4 |
| 11.5 | Skills (personal + team-shared, slash invocation) | M | all | 11.1 | 5 |
| 11.6 | Loops (triggers, permissions, versions, run history) | XL | Business+ | 11.1, 1.15 | 6 |
| 11.7 | MCP connectors into the agent (16 + custom) | L | all | 11.1 | 5 |
| 11.8 | Coding sessions (sandbox, models, PR drafting, artifacts) | XL | Basic+ | 9.1, 11.1, 1.15 | 6 |
| 11.9 | Code Intelligence (permission-aware repo Q&A) | XL | Business+ | 9.1, 11.1 | 6 |
| 11.10 | Product Intelligence (backlog-wide routing/duplicates) | L | all | 8.5 | 6 |
| 11.11 | Generated release notes | S | Business+ | 9.9, 11.1 | 6 |
| 11.12 | Agent platform for third parties (sessions, activities, scopes) | L | all | 12.3 | 5 |

## 12. Platform

| # | Feature | Size | Plan | Depends on | Phase |
|---|---|---|---|---|---|
| 12.1 | GraphQL API (queries, mutations, pagination, filtering) | XL | all | data model | 0 |
| 12.2 | Rate limiting + complexity scoring + headers | M | all | 12.1 | 1 |
| 12.3 | OAuth 2.0 (+PKCE, refresh, revoke, client credentials, actor modes) | L | all | 12.1 | 3 |
| 12.4 | Personal API keys with scopes + team limits | S | all | 12.1 | 1 |
| 12.5 | Webhooks (delivery, retries, signing, IP list, per-resource) | L | all | 12.1 | 2 |
| 12.6 | MCP server (streamable HTTP, read-only endpoint, OAuth 2.1 DCR) | L | all | 12.3 | 5 |
| 12.7 | TypeScript SDK | M | all | 12.1 | 4 |
| 12.8 | Integration directory + submission flow | M | all | 12.3 | 6 |
| 12.9 | Third-party app approvals | M | Enterprise | 12.3 | 6 |

## 13. Customers and support

| # | Feature | Size | Plan | Depends on | Phase |
|---|---|---|---|---|---|
| 13.1 | Customers + attributes + tiers + statuses + merge + domain rules | L | all | 3.1 | 4 |
| 13.2 | Customer requests + importance flag + customer pages | M | all | 13.1 | 4 |
| 13.3 | Attribute sync from source tools + mapping UI | M | Business+ | 13.1 | 5 |
| 13.4 | Customer-based filters, views, insights, notifications, export | M | all | 13.2, 7.4 | 5 |
| 13.5 | Intercom | L | Business+ | 13.2, 6.7 | 5 |
| 13.6 | Zendesk | L | Business+ | 13.2 | 5 |
| 13.7 | Front | M | Business+ | 13.2 | 6 |
| 13.8 | Salesforce (permission sets, mapping, SOQL, case triage rules) | XL | Enterprise | 13.2, 8.4 | 6 |
| 13.9 | Gong (transcript → issues) | L | Enterprise | 13.2, 11.1 | 6 |

## 14. Other integrations

| # | Feature | Size | Plan | Depends on | Phase |
|---|---|---|---|---|---|
| 14.1 | Sentry | M | all | 6.8 | 4 |
| 14.2 | On-call providers (PagerDuty/Opsgenie/Rootly/incident.io) | M | Business+ | 8.3 | 5 |
| 14.3 | Figma (embeds + plugin) | L | all | 6.1 | 5 |
| 14.4 | Notion | S | all | — | 6 |
| 14.5 | Google Sheets sync | M | all | 12.1 | 5 |
| 14.6 | Airbyte source connector | M | Enterprise | 12.1 | 6 |
| 14.7 | Zapier app (5 actions, 8 triggers) | M | all | 12.1, 12.5 | 5 |
| 14.8 | Jira sync (spaces↔teams, epics↔projects, JQL filter) | XL | all | 6.7 | 6 |
| 14.9 | Google Calendar OOO | S | all | — | 6 |

## 15. Data movement

| # | Feature | Size | Plan | Depends on | Phase |
|---|---|---|---|---|---|
| 15.1 | Import assistant framework (setup/review/scope/map/confirm/revert) | L | all | 3.1 | 3 |
| 15.2 | Jira importer (API + CSV, ID matching, sync handoff) | L | all | 15.1 | 4 |
| 15.3 | GitHub Issues importer | M | all | 15.1 | 4 |
| 15.4 | Asana / Shortcut importers | M | all | 15.1 | 5 |
| 15.5 | Linear → Linear importer | M | all | 15.1 | 5 |
| 15.6 | CLI/CSV importer (open source) | M | all | 15.1 | 5 |
| 15.7 | Exports: workspace, view, project/initiative, members, requests | M | all | 3.1 | 2 |
| 15.8 | Copy-as-Markdown-for-LLMs, PDF print | S | all | 6.1 | 3 |

## 16. Clients

| # | Feature | Size | Plan | Depends on | Phase |
|---|---|---|---|---|---|
| 16.1 | Web app | XL | all | 1.12 | 0 |
| 16.2 | Desktop (macOS ×2, Windows): notifications, badge, tabs, auto-update, deep links, localhost handoff | L | all | 16.1 | 3 |
| 16.3 | iOS app | XL | all | 1.12 | 5 |
| 16.4 | Android app | XL | all | 1.12 | 5 |
| 16.5 | Preferences (theme, custom themes, behaviour, defaults) | M | all | 16.1 | 2 |
| 16.6 | Keyboard shortcut system + help overlay (`?`, `Cmd+/`) | M | all | 16.1 | 1 |
| 16.7 | Accessibility, i18n scaffolding | L | all | 16.1 | — |

## 17. Compliance and trust

| # | Feature | Size | Plan | Depends on | Phase |
|---|---|---|---|---|---|
| 17.1 | Audit log (90 days, filters, API, SIEM streaming) | L | Enterprise | 1.1 | 5 |
| 17.2 | SAML (multi-IdP, JIT provisioning, domain claiming) | L | Enterprise | 1.2 | 5 |
| 17.3 | SCIM 2.0 + group push + role groups + team mapping | L | Enterprise | 17.2 | 6 |
| 17.4 | Login-method restrictions, IP restrictions | M | Business+/Ent | 1.2 | 5 |
| 17.5 | Data residency (US/EU) | XL | all | 1.1 | — |
| 17.6 | SOC 2 / GDPR / HIPAA programme | XL | — | — | — |
| 17.7 | Performance reporting flow | S | all | 16.1 | 4 |

---

**Totals:** ~150 line items. Roughly **12 XL**, **35 L**, the rest M/S. The XLs are where the schedule actually lives: sync engine, editor, web client, mobile ×2, GraphQL API, Insights, Reviews, agent core, coding sessions, Code Intelligence, loops, Triage Intelligence, Salesforce, Jira sync, data residency.
