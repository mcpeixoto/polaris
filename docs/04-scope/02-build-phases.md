# Build phases

A sequencing proposal, not a commitment. Ordered so that each phase produces something usable and so that the load-bearing architecture lands before anything is built on top of it.

The two non-negotiable "do it first or rewrite everything" items are the **sync engine** (1.12) and the **GraphQL API as the only backend interface** (12.1). Both are XL and both are invisible to users. Resist the pressure to defer them.

---

## Phase 0 — Skeleton that a team could actually dogfood

**Goal:** create issues, move them through statuses, see them in a list, in real time, on the web.

- Workspace, auth, teams, membership, admin/member roles
- **GraphQL API + schema + auth** as the only backend interface
- **Sync engine**: local store, optimistic mutations, delta sync, offline queue, "Syncing N" indicator
- Issues: CRUD, identifiers, statuses and categories, assignee, priority, activity history, multi-select and bulk actions
- Rich editor v1 (markdown, lists, code, links, mentions)
- Web client shell: sidebar, list view, issue detail, command menu v1
- Keyboard model established (this is a design decision, not a feature — make it early)

**Exit criterion:** your own team stops using its old tracker.

## Phase 1 — The daily loop

**Goal:** it's a real issue tracker.

- Labels + groups, estimates, due dates, relations, sub-issues
- Templates (standard), issue move between teams, delete + recovery + undo
- Filters (operators, quick filters, URL sync), display options, board layout
- Search + in-view find
- Projects v1 (CRUD, multi-team, properties)
- Comments + threads + reactions
- Notification engine + Inbox + My Issues
- Personal API keys, rate limiting + complexity scoring
- Invitations, domains, member management
- Entitlement service, keyboard help overlay, file upload with authenticated serving

## Phase 2 — Planning and structure

- Cycles: config, auto-creation, rollover, auto-add
- Project overview, milestones, workspace project statuses
- Documents + collaborative editing + version history
- Custom views + favorites + peek
- Triage v1 (inbox, accept/duplicate/decline/snooze)
- Auto-close / auto-archive engines + archives page
- Attachments (URL-idempotent) and webhooks
- **GitHub v1**: branch/PR/commit linking, magic words
- Exports (workspace, view, project); creation URLs; preferences; drafts
- Billing, multi-workspace switching, team home pages

## Phase 3 — Team-scale and delivery

- Private teams, sub-teams, retire/delete team, team owner role, team issue limits
- Cycle graph, capacity, cycle editing
- Project graph, project updates, initiatives v1, project priority
- GitHub status automations, branch rules, linkbacks, preview links, autolinks
- Slack integration (agent, creation, unfurls, notifications, project channels)
- OAuth 2.0 + app identity; import framework
- Form templates, default templates, recurring issues, email-to-issue
- Desktop apps; inline comments; label/user views
- Workspace owner role and workspace restrictions

## Phase 4 — Scale, insight, first AI

- **Insights** (the big one)
- Triage rules, triage responsibility + on-call providers
- SLAs
- Customers + customer requests + customer views
- Asks for Slack
- GitHub Issues sync, GitLab, synced comment threads
- Sentry, Zapier, view subscriptions, open-in-coding-tool
- **Linear Agent core** + chat + in-context agent + guidance
- Jira and GitHub importers
- Project dependencies, templates, attached views; initiative updates; multi-level sub-teams
- AI credits + spend limits (needed before anything metered ships)

## Phase 5 — Enterprise and the AI platform

- Dashboards, sub-initiatives, initiative views, private issue sharing
- SAML, IP/login restrictions, audit log
- Reviews/Diffs surface; Releases
- Mobile apps (iOS + Android)
- Intercom, Zendesk, Microsoft Teams, Figma, Google Sheets, on-call providers, GitHub Enterprise
- MCP server + MCP connectors + agent platform for third parties + skills
- Pulse; Asks for Email; Triage Intelligence
- Remaining importers (Asana, Shortcut, Linear→Linear, CLI); SDK

## Phase 6 — Everything else

- Coding sessions, Code Intelligence, Loops, PR Guides, Product Intelligence, generated release notes
- Asks Web Forms + Advanced Asks
- Salesforce, Gong, Jira sync, Front, Discord, Notion, Airbyte, Google Calendar
- SCIM, third-party app approvals, integration directory

## Ongoing, never "done"

- **Data residency (US/EU)** — decide in Phase 0 whether you're doing it; retrofitting is a migration project.
- **Performance** — Linear's core differentiator. Budget it as an ongoing workstream with its own regression triage, not a phase.
- **Accessibility and i18n** — cheaper early than late.
- **SOC 2 / GDPR / HIPAA** — start the programme long before you need the certificate.

---

## Sequencing traps

| Trap | Why it bites |
|---|---|
| Building the UI against a private backend, adding a public API later | Linear's integrations, agents, and mobile clients all sit on the same API. Two interfaces = permanent drift |
| Deferring the sync engine | Every view, every optimistic mutation, and every offline behaviour is written against it. Retrofitting means rewriting the client |
| Deferring the entitlement service | Plan gating touches ~40 features; scattered `if plan ==` checks become unmaintainable |
| Deferring the **actor** abstraction (user / app user / integration) | Webhooks, activity feeds, audit logs, insights, and filters all expose actors. Adding a third actor type later is a schema migration across every event table |
| Building priority ordering per-user | Manual priority order is **workspace-global** in Linear. Different data shape |
| Treating Triage as a view | It's a status category with its own exclusion semantics across every view |
| Treating delegate as assignee | The agent platform depends on them being distinct fields |
| Building labels as a flat list | Groups, workspace vs team scoping, name-matching across teams, and archival all change the model |
| Letting archival be manual | The auto-archive blocking conditions (parent, sub-issues, project) are load-bearing for graph integrity |
| Shipping metered AI before credits and spend limits | You will be paying for a customer's runaway loop |
