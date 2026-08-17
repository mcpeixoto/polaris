# AI layer: Linear Agent, skills, loops, coding sessions, code intelligence, MCP

**Depends on:** everything (the agent reads and writes across the whole model), OAuth/app-user platform, AI credits, GitHub integration.
**Plan gating:** Agent + MCP + Pulse + Product Intelligence on all plans; coding sessions Basic+; Loops, Code Intelligence, Triage Intelligence, PR Guides Business+.

Linear frames its AI strategy as three jobs: **make sense of information** (Product Intelligence, Pulse), **act on it** (agents, loops, coding sessions), **connect it** (MCP).

---

## Linear Agent

Enabled by default per workspace; a workspace owner/admin can disable it (Settings → AI → Linear Agent).

**Capabilities:** create and update issues, projects, milestones, and initiatives; summarise and analyse work, threads, and customer requests; answer questions about workspace data; post, edit, and delete its own comments.

**Context:** teams and sub-teams, initiatives, projects (with milestones and cycles), issues and relationships, comments, activity history, documents. It operates strictly **within the caller's permissions** — it can only see or change what that user can.

### Surfaces
| Surface | Entry |
|---|---|
| Dedicated chat | `Cmd/Ctrl+J`, or the Linear chat page. Multiple concurrent chats as **tabs**, each showing unread/working state. **Chat history** grouped by recency (Today, Last week, …) and surfacing chats related to what you're looking at |
| Comments | `@Linear` in any comment field on issues, documents, updates; inline in project/initiative descriptions |
| Documents | `Cmd/Ctrl+J` while editing, or select text → *Add to chat*. Agent-written text is highlighted for review; version-history checkpoints are created |
| Slack | `@Linear` (see `02-integrations/03-chat.md`) |
| Microsoft Teams | `@Linear` |
| Intercom / Zendesk | "Create with Linear Agent" — analyses the whole conversation and drafts the issue |
| Gong | Automatic issue creation from call transcripts |
| Releases | Generated release notes |

Default home view is a new Linear Agent chat on each new tab — changeable in Preferences → Default home view.

### Guidance
Free-text instructions steering agent behaviour. Three scopes:
- **Workspace guidance** — applies to everyone. Edit permission configurable in Settings → AI.
- **Team guidance** — parent or sub-team level, in Team settings → Agents → Additional guidance. **Team guidance takes priority** where both exist.
- **Personal guidance** — Settings → Agent personalization. Applies both in Linear and in Slack.

Guidance is authored in a markdown editor with full history. It may `@`-mention documents, which the agent will then read before acting. Slack's issue-creation guidance is configured **separately** in the Slack integration settings.

### Skills
Saved, reusable agent workflows. Ask Linear to "save this as a skill" after a good result, or manage them directly.

- **Personal skills**: Settings → Account → Agent personalization → Skills.
- **Team-shared skills**: Team settings → AI & Agents → Agent skills. Permission controlled by *Team permissions → Agent skills management* (default: any team member).
- Invoked with a slash command in the agent input; the agent may also apply them automatically when context matches.
- Documented best practice: prototype in chat → save as personal skill → promote to team skill when stable → keep optimising (e.g. ask the agent how to make the skill faster).

---

## Loops (Business/Enterprise, consumes AI credits)

Background automations: "a shared skill that triggers on a schedule or event."

**Anatomy:** trigger + instructions + optional MCP connectors + scope + permissions.

- **Triggers:** a schedule, or an issue being created/updated and matching conditions.
- **Scope:** a team, a set of teams, or the whole workspace. Workspace loops live under the workspace sidebar group; team loops under the team's Loops tab.
- **Authoring:** best practice is to get the outcome right in an agent chat first, then ask Linear to turn it into a loop; or create manually (New loop → trigger → instructions → connectors → permissions → Create).
- **Editing:** changes save as a **draft** until **Published**. All published versions are retained and **restorable** (connectors must be re-authenticated after restore).
- **Run history** per loop for auditing what ran and what it did. Failures are notified; asking Linear (`Cmd/Ctrl+J`) while viewing run history yields a detailed failure explanation.
- Enable/disable via right-click. **Deleting is permanent** — disable instead.

### Loop permissions (each independently toggled — this is the security surface)
| Permission | Effect |
|---|---|
| **Team access** | Which teams the loop can read/write. Default: workspace/public-team loops get all public teams (plus workspace objects like initiatives and customers); a loop inside a private team gets only that team |
| **Web access** | Loop can query any website. **Can send workspace content to external services** — explicitly flagged as risky |
| **Code Intelligence** | Loop can browse/analyse configured repositories |
| **Coding sessions** | Loop can open draft PRs |
| **Externally synced issues and comments** | Loop can write on issues/threads synced with Slack, GitHub, etc. — including public GitHub repos |
| **External sources** | By default loops only run on issues created **inside Linear**. Allowed external sources are configured workspace-wide in Security settings, then enabled per loop |
| **Allow changes outside of triggering issue** | Off = the loop may only write to the issue that triggered it |

Loop management permissions: workspace owners control who can create/update/delete workspace loops (Settings → Security → Workspace management → Manage loops); team owners control it per team (Team settings → Access and permissions → Loop management).

### Example loops Linear ships
- New bug in Triage → investigate root cause with Code Intelligence → delegate to Linear to fix if found.
- Issue with `incident` label marked done → root-cause analysis → create follow-up issues.
- New incoming issue → decide whether platform-specific variants (iOS/Android) are needed and create them.
- Issue closes → read the closing PR → generate user-facing messaging for Support.
- Weekly: review projects updated last week + a synced doc → post a summary to `#product-marketing`.

### Writing good instructions (documented guidance)
Describe the **outcome**, not just an action; state which context/tools to use; state which changes are permitted and which are forbidden ("Do not change the assignee or status").

---

## Coding sessions (Basic+, consumes AI credits)

Agentic coding runs inside Linear. Delegating an issue to Linear starts a **secure coding session** in a managed development sandbox; Linear drafts a PR and attaches a diff to the issue, reviewable in-product and mergeable from Linear.

### Setup
A Linear owner/admin who is also a GitHub org owner: GitHub integration settings → grant **code access** → enable **Coding sessions**. Then any workspace member with a linked GitHub account (Connected Accounts) can start one.

### Models
Default tracked as **Auto** (currently Claude Opus 4.8). Workspace owners/admins pick the model in Coding session settings; the selection applies workspace-wide. Supported at time of writing: Claude Fable 5, Claude Opus 5, Claude Opus 4.8, Claude Sonnet 5, GPT-5.6 Sol, GPT-5.5, GPT-5.4. Default models are zero-data-retention.

### Behaviour
- Triggered by delegation, by `@linear` in Slack/Teams, from Triage automations, or by a loop.
- The agent works from the issue's existing context. You can steer mid-session or let it run and be notified when input is needed.
- **Intent detection matters**: direct requests (fix a bug, implement a feature, open a PR) start coding immediately; "investigate / debug / research / plan / create the task" is treated as scoping and does **not** start coding; so is a message that only says where work should be tracked. A short "proceed" after Linear offers to handle something is enough.
- The sandbox prepares projects in Python, Ruby, Go, Rust, Java, and Node.js, installs dependencies from repo config/lockfiles, can start local apps, drive **browser automation** to test changes, and capture screenshots/recordings as verification artifacts.
- Guidance comes from the team's existing Claude Code/Codex setup — repository `skills.md` files and supported tool-version configuration are honoured alongside issue and repo context.
- Output lands in the **Reviews** tab: diffs, review discussion, verification artifacts. Review actions themselves can be delegated back to the agent (address review comments, rebase onto master, fix lint).

### Writing issues that work well
Linear's documented contrast, worth reproducing as in-product guidance:
- ✗ "Search is broken." / "Improve the search experience."
- ✓ Name the exact behaviour, the file/flag to reuse (`issueSearch.ts`, `includeArchivedProjects`), what should change, and explicitly what should **not** change (don't touch ranking, pagination, project search).

Ambiguity costs credits — the model spends them exploring.

---

## Code Intelligence (Business/Enterprise, beta, free during beta)

Permission-aware Q&A over connected GitHub repositories, so non-engineers can ask how the product actually works.

- Setup: install/enable the GitHub integration **with code access**, then Settings → AI & Agents → Code Intelligence.
- Example questions: "How does the authentication system work?", "Who wrote the payment processing logic?", "When was the search feature added?" Answers are grounded with links to files, commits, and PRs. Slower than workspace-only answers by design.
- **Repository access is permission-aware**: only repos connected through the integration and accessible to that member. Admins can further restrict which repos are exposed.
- **Extend access to all members** lets Support/Sales/Product query without GitHub access, scoped to all or selected repos.
- **Not available to guests.**
- Shaped by Linear Agent guidance (repo conventions, architectural context, how to explain the codebase).

---

## Product Intelligence (technology preview, all plans)

Automatic suggestion of the right team, related issues, and likely duplicates for incoming work — the backlog-wide version of Triage Intelligence. Explicitly **non-autonomous** today (human in the loop); each approve/reject refines quality. Linear's stated position: this makes importing your legacy backlog worth doing.

---

## MCP

Two directions, don't confuse them:

1. **Linear's MCP server** — lets external AI tools read/write Linear. See `03-platform/05-mcp-server.md`.
2. **MCP connectors into Linear Agent** — lets the agent reach *out* to other services. Workspace-level enablement (Settings → Security → Enable MCP servers → All servers or Only specific servers), then per-user connection in Settings → Agent personalization → MCP servers. Works in agent chat, comments, automations, and loops.

Available servers at time of writing: Amplitude, Attio, Better Stack, Datadog, GitHub, Glean, Granola, HubSpot, incident.io, Intercom, Jam, Notion, PostHog, Sentry, Slack, Stripe — plus **custom URL** servers (must be `http(s)://`; no auth, OAuth, or custom auth headers).

Example prompts Linear documents: investigate an issue via Sentry; check Datadog for related errors; look up a customer in Intercom; search Notion and draft a launch guide; find the GitHub PR that introduced a change.

---

## Third-party agents

Installed by workspace admins from the Integrations Directory; installation chooses which **teams** the agent can access. Reviewable afterwards under Settings → AI & Agents → Installed Agents.

- Interact by **delegating** an issue (assignment sets `delegate`, the human assignee keeps ownership) or **@mentioning** in comments/descriptions.
- Agents cannot sign in, access admin functionality, or manage users.
- Not billable seats. Third-party providers may charge separately.
- Track activity via agent user pages, My Issues (delegated issues still appear), custom views filtered by **Delegate**, and Insights sliced by Delegate.
- Guests can be blocked from interacting with agents entirely (Security → Integrations & applications).
- Name collisions append a number (`Charlie` → `Charlie1`).

Build-your-own: see `03-platform/04-agent-platform.md`.

---

## AI privacy posture to replicate

Linear's published position, which shapes contractual and UI copy:
- Linear does **not** train its own models on customer data.
- Third-party model providers are contractually barred from training on it; **zero-data-retention** processing is required where the provider supports it.
- Prompts and outputs are treated as customer data and confidential information.
- Only voluntary signals (thumbs up/down, opt-ins) feed improvement.
- Models may be added/removed/substituted over time and consume credits at different rates.
- The subprocessor list lives in the DPA.
