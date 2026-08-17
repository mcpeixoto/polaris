# Glossary

Terms as Linear uses them, plus the Jira translation (Linear publishes this mapping, and migrating teams will ask for it).

| Term | Meaning |
|---|---|
| **Workspace** (`Organization` in the API) | Top-level container for one company. Unique URL. |
| **Team** | Owns issues, workflow, cycles, triage, labels, templates. Has a key used in issue IDs. |
| **Sub-team** | Team nested under a parent team; inherits cycles (mandatory), optionally statuses/estimates; can use parent labels/templates. |
| **Issue** | Atomic unit of work. One team, one status. |
| **Sub-issue** | Issue with a parent. May live in a different team. |
| **Status / Issue status** (`WorkflowState`) | Team-defined state within a fixed category. |
| **Status category** | triage, backlog, unstarted, started, completed, canceled (+ system duplicate). Order is fixed. |
| **Workflow** | The ordered set of a team's statuses. |
| **Triage** | Both a status category and a per-team intake inbox for issues from outside the team or from integrations. |
| **Triage responsibility** | Rotating ownership of the triage queue, optionally driven by PagerDuty/Opsgenie/Rootly/incident.io. |
| **Triage rules** | Deterministic condition → action automations applied on triage entry. |
| **Triage Intelligence** | LLM-driven property suggestions and duplicate/relationship detection on triage entry. |
| **Cycle** | Team's repeating time-box (Linear's sprint). Auto-created, auto-rolling. |
| **Cooldown** | Optional gap between cycles; issues can't be assigned to it. |
| **Project** | Cross-team unit of outcome with lead, dates, milestones, updates, graph. |
| **Project milestone** | Ordered checkpoint inside a project; issues attach to it. |
| **Project status** | Workspace-defined status in a fixed category (Backlog/Planned/In Progress/Completed/Canceled). Manual. |
| **Initiative** | Strategic grouping of projects. Nestable (Enterprise). Formerly "Roadmaps". |
| **Update** | Structured progress report on a project or initiative with health = On track / At risk / Off track. |
| **Health** | The health indicator carried by the latest update. |
| **View** | Saved filter + display config over issues, projects, or initiatives. |
| **Display options** | Layout (list/board/timeline), grouping, sub-grouping (swimlanes), ordering, displayed properties. |
| **Swimlane** | Board sub-grouping rendered as rows. |
| **Peek** | Space-bar hover preview. |
| **Insights** | Analytics panel on a view: measure × slice × segment. |
| **Dashboard** | Enterprise page combining insights with global + per-insight filters. |
| **Pulse** | AI-generated feed/digest of project & initiative updates. |
| **Inbox** | Personal in-app notification centre. |
| **My Issues** | Personal view: Assigned / Created / Subscribed / Activity (+ Shared on Enterprise). |
| **Asks** | Internal-request intake from Slack, email, or web forms — for people without Linear accounts. |
| **Advanced Asks** | Enterprise Asks superset (web forms, private channels, per-channel config, auto-create, multi-workspace). |
| **Customer** | External organisation record with domains, tier, revenue, size, status. |
| **Customer request** (`CustomerNeed`) | A piece of customer feedback linked to an issue or project, optionally flagged Important. |
| **Attachment** | URL-keyed external resource rendered on an issue; idempotent per (issue, url). |
| **Linkback** | Comment Linear posts back into GitHub/GitLab when an issue is linked. |
| **Magic word** | Keyword in a PR/MR/commit that links and optionally closes an issue (`fixes ENG-123`). |
| **Release / Release pipeline** | CI-fed grouping of issues into shipped units per product+environment. |
| **SLA** | Rule-derived deadline on an issue with risk statuses. |
| **Loop** | Scheduled or event-triggered background agent automation. |
| **Skill** | Saved, reusable agent workflow invoked by slash command (personal or team-shared). |
| **Coding session** | Sandboxed agentic coding run that produces a draft PR and diff on an issue. |
| **Code Intelligence** | Permission-aware Q&A over connected GitHub repositories. |
| **Diffs / Reviews** | In-Linear GitHub pull-request review surface. |
| **Guide** | AI-structured walkthrough of a large PR. |
| **Agent / App user** | OAuth `actor=app` installation that behaves like a workspace user. |
| **Delegate** | The agent an issue is delegated to; the human assignee keeps ownership. |
| **Agent session** | Lifecycle object tracking one agent task. |
| **Guidance** | Free-text instructions steering agent behaviour at workspace / team / personal scope. |
| **AI credits** | Prepaid, workspace-pooled USD balance for metered AI features. |
| **Drafts** | Unsent issues/comments — local drafts and persisted drafts (6-month retention). |
| **Archives** | Per-team page of archived issues/cycles/projects + recently deleted items (30 days). |

## Jira → Linear translation

| Jira | Linear |
|---|---|
| Epic | **Project** (hierarchy is Workspace → Initiative → Project → Milestone → Issue → Sub-issue) |
| Story / Task | **Issue** (no story type; use labels, label groups, parent issues, views) |
| Sub-task | **Sub-issue** |
| Sprint | **Cycle** |
| Scrum | **The Linear Method** |
| Kanban board | **Board layout** (no WIP limits — deliberate) |
| Swimlane | **Rows** (board sub-grouping) |
| Burndown chart | **Burn-up chart** (cumulative flow) + **Cycle graph** + **Project graph** |
| Project | **Team** (usually) |
| Components | Imported as team labels (`Component: X`) |
| Issue type | Imported as a label |
| Custom fields | **Not supported** — no equivalent |
