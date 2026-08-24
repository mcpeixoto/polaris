# Triage and intake

**Depends on:** teams, statuses, issues, integrations, templates.
**Depended on by:** Asks, support integrations, SLAs, Triage Intelligence, Loops, coding-session automations.

Triage is the shared inbox that separates *unreviewed* work from a team's actual workflow. It is a per-team opt-in feature (Team Settings → Triage) and also a status category.

## What lands in Triage

An issue enters Triage when:
- it is created by an **integration** (Slack, Sentry, Intercom, Zendesk, Front, Asks, Gong, email, API where applicable);
- it is created by a **workspace member who isn't in that team**;
- it is created from **inside the Triage view**;
- a **triage rule** routes it there from another team;
- (Jira sync edge case) the integration can't map a status and falls back to Triage.

A team **default template** can override the Triage status.

Triage issues are **excluded from all views by default**. To include them, a view must explicitly filter status to include Triage.

## Actions

Navigate with `G` then `T` (`O` then `T` to pick another team first).

| Action | Shortcut | Effect |
|---|---|---|
| Accept | `1` | Optional comment, then moves the issue to the team's default status |
| Mark as duplicate | `2` (or `MM`) | Choose the canonical issue; attachments + customer requests move over; the new issue takes the reserved Duplicate status (Canceled type) |
| Decline | `3` | Sets a Canceled-type status, offers a comment explaining why |
| Snooze | `H` | Hides from the queue until a chosen time **or** until new activity, whichever comes first. Hidden for other users too by default; surfaced again via a View Options toggle |
| Ask for info | — | Comment and leave in Triage (or snooze) |

Team setting: **require priority before an issue can leave Triage**.

## Turning Triage off

The switch is about *intake*. Disabling it stops new work landing in Triage and leaves the reserved statuses, and everything already sitting in them, exactly where they are. Nothing is accepted or declined on the team's behalf: the queue is a pile of unmade decisions, and only a person can make them.

So the inbox follows the queue rather than the switch. While anything is still in a Triage status the screen stays reachable — `G` `T`, and the team page's Triage link — and stays read-write, with all of `1` / `2` / `3` / `H` working as they do with triage on. It says intake is off and why it is still there, and it retires itself the moment the queue is empty. The one thing that does stop is filing *into* triage: `C` on that screen files an ordinary issue.

## Triage responsibility (Business/Enterprise)

Define who owns the incoming queue. Selected members either get notified of new triage issues or are auto-assigned them. Team members can see who is currently on triage duty when creating issues.

On-call rotation sources: **PagerDuty, Opsgenie, Rootly, incident.io**. For anything else, Linear exposes an API so a custom schedule can be pushed.

## Triage rules (Business/Enterprise)

Deterministic automations evaluated when an issue enters Triage.

- **Conditions:** any filterable issue property (team, status, labels, creator, customer, priority, project, Salesforce case properties, …). Hold `Shift` while selecting multiple values in a filter menu to build an "any of" condition.
- **Actions:** set team, status, assignee, label, project, priority — and **delegate to an agent**.
- Rules execute top-down, in order. Routing an issue into another team's Triage causes *that* team's rules to run too. Conflicts are surfaced in the UI.
- Documented pattern: combine with Asks form fields so Slack submissions self-route.

## Triage Intelligence (Business/Enterprise)

LLM analysis of each new triage issue against the rest of the workspace.

- **Suggests:** team, project, assignee, labels — plus **related issues and likely duplicates** based on semantic similarity.
- Each suggestion can be accepted, dismissed, or inspected ("why is this appearing?"). Reasoning is viewable while processing and afterwards via the suggestion's overflow menu.
- **Per-property automation modes** per team: show / hide / **auto-apply**, optionally filtered to specific values. Sub-teams inherit the parent's rules by default and can override.
- **Scope control**: "Include suggestions from" limits the corpus (e.g. only this team and its sub-teams).
- **Additional guidance** free-text at workspace, parent-team, and sub-team level. All levels are considered; the most local is weighted most heavily. Intended as a *reactive* correction tool, not initial config.
- Can be triggered outside Triage: `Cmd/Ctrl+K` → **Find Suggestions** runs in the background on any issue.
- Latency is explicitly **1–4 minutes** per issue — the design trades speed for quality.
- Enabled workspace-wide in Settings → AI; disabled per team in that team's triage suggestion settings.

Note: cheaper, search-based "quick suggestions" in the composer and property menus exist on **all** plans; Triage Intelligence is the thorough version.

## Agent automations on triage

Once coding sessions are enabled, triage automations can start agent work on arrival — optionally filtered to issues matching criteria (label, creator, any filterable property). Linear's own documented use: when Triage Intelligence classifies an incoming issue as a bug, run an investigation and draft a PR.

Loops can also trigger on triage entry with richer instructions (see `16-ai-agents-and-loops.md`).

## Intake surface map

| Source | Mechanism | Lands in |
|---|---|---|
| Another team's member | Native | Triage |
| Slack | `@Linear`, message action, `/linear`, unfurl actions | Triage (or chosen status) |
| Asks (Slack) | 🎫 emoji, `/Asks`, message overflow, DM, `@Linear Asks`, auto-create-on-message | Triage |
| Asks (Email) | Forwarded custom address | Triage |
| Asks (Web forms) | SAML-gated forms | Triage |
| Email | Team address or template address | Team default / Triage |
| Intercom / Zendesk / Front | Widget: create or link, incl. "Create with Linear Agent" | Triage if enabled, else first Backlog status |
| Salesforce | Case component, template-driven | Per triage rules |
| Gong | Automatic issue creation from call transcripts | Triage |
| Sentry | Manual create/link, or alert-rule automation | Team default |
| GitHub | Issues sync, `{TEAM}-NEW` magic word in a PR | Team default / Started |
| Jira | Space ↔ team sync | Mapped status, Triage fallback |
| API / Zapier / custom | `issueCreate` | As specified |
| Loops | Agent-created | As instructed |

## Process guidance to encode in onboarding

Linear's own published triage playbook, which the product is designed around:
1. **Lower friction to file** — no special process; anyone files into any team.
2. **Route to one place** — unreviewed work never touches active/backlog queues.
3. **Choose triage captains** — explicit rotating ownership, often driven from PagerDuty.
4. **Review regularly** — captains have authority to accept/decline/merge/snooze; comments capture the why.

Level-ups: SLAs on time-sensitive issues, support-tool automations that reopen the customer conversation when the issue closes, favoriting the triage inbox, and personal triage notifications.
