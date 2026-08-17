# Agent platform (build-your-own agents)

Linear's agent APIs are in **Developer Preview** and may change. Two generations exist in the docs: the newer **Agent Session** model, and a deprecated **App user notification** model. A clone should build the session model and keep the notification enum as the vocabulary of "things worth telling an app about".

## Concept

Agents ("app users") behave like workspace users: mentionable, delegatable, able to comment, and able to collaborate on projects and documents. They are installed and managed by workspace admins, cost nothing to develop, are **not billable seats**, and can be submitted to the integration directory for distribution.

Assignment semantics matter: assigning an issue to an app sets it as the **delegate**, not the assignee — the human keeps ownership.

## Setup

1. Create an **Application** (standard OAuth app config).
2. Enable webhooks and select the **Agent session events** category. (Also useful early: *Inbox notifications* and *Permission changes*.)
3. Name and icon become the agent's identity in every workspace it's installed into — short, recognisable, unique.
4. Install with `actor=app` (see `03-oauth-and-scopes.md`), requesting `app:assignable` and/or `app:mentionable` as needed, plus `customer:*` / `initiative:*` if the agent touches those.
5. Fetch and store the per-workspace app user ID via `query Me { viewer { id } }`.

Team access is chosen at install and changeable by admins at any time; subscribe to **Permission changes** to receive `PermissionChange` webhooks.

## Agent session lifecycle

An **Agent Session** tracks one agent task. Sessions are created automatically when the agent is **mentioned** or **delegated an issue** — there is no manual creation and no manual state management: session state is derived from the activities the agent emits, and is visible to users.

**The most common entry point is delegation.** It fires a `created` `AgentSessionEvent` webhook containing an `agentSession` object with the relevant issue, comment, and context.

The agent must:
1. Emit a **`thought` activity within 10 seconds** to acknowledge the session.
2. Use the `promptContext` field to build its working context — issue details, comments, and guidance.
3. Emit further **Agent Activities** as it works; these drive the visible session state.

Linear ships a reference implementation ("Weather Bot") on the TypeScript SDK + Cloudflare.

## App user notification webhooks (deprecated generation)

Payload shape:
```ts
{
  type: "AppUserNotification",
  action: NotificationType,
  createdAt: string,
  organizationId: string,
  oauthClientId: string,
  appUserId: string,
  notification: Notification,
}
```

The ones Linear flags as most relevant to agents: `issueMention`, `issueEmojiReaction`, `issueCommentMention`, `issueCommentReaction`, `issueAssignedToYou`, `issueUnassignedFromYou`, `issueNewComment`, `issueStatusChanged`.

### The full NotificationType vocabulary

Useful far beyond agents — it is effectively the catalogue of notifiable events the product must produce.

**Issues:** issueMention, issueAddedToTriage, issueAssignedToYou, issueAddedToView, issueUnassignedFromYou, issueNewComment, issueCommentMention, issueCommentReaction, issueThreadResolved, issueEmojiReaction, issuePriorityUrgent, issueSubscribed, issueUnsubscribed, issueBlocking, issueUnblocked, issueReminder, issueStatusChanged, issueStatusChangedAll, issueReopened, issueDue
**Triage/SLA:** triageResponsibilityIssueAddedToTriage, issueSlaHighRisk, issueSlaBreached
**Apps:** oauthClientApprovalCreated
**Initiatives:** initiativeAddedAsOwner, initiativeCommentMention, initiativeNewComment, initiativeThreadResolved, initiativeCommentReaction, initiativeMention, initiativeDescriptionContentChange, initiativeReminder
**Projects:** projectAddedAsMember, projectAddedAsLead, projectCommentMention, projectNewComment, projectThreadResolved, projectCommentReaction, projectMention, projectReminder, projectDescriptionContentChange
**Project milestones:** projectMilestoneCommentMention, projectMilestoneNewComment, projectMilestoneThreadResolved, projectMilestoneCommentReaction, projectMilestoneMention, projectMilestoneDescriptionContentChange
**Documents:** documentMention, documentCommentMention, documentNewComment, documentThreadResolved, documentCommentReaction, documentReminder, documentMoved, documentDeleted, documentRestored, documentSubscribed, documentUnsubscribed, documentContentChange
**Project updates:** projectUpdateCreated, projectUpdatePrompt, projectUpdateMention, projectUpdateReaction, projectUpdateNewComment, projectUpdateCommentMention, projectUpdateCommentReaction
**Initiative updates:** initiativeUpdateCreated, initiativeUpdatePrompt, initiativeUpdateReaction, initiativeUpdateMention, initiativeUpdateNewComment, initiativeUpdateCommentMention, initiativeUpdateCommentReaction
**Team updates:** teamUpdateCreated, teamUpdateMention, teamUpdateReaction, teamUpdateNewComment, teamUpdateCommentMention, teamUpdateCommentReaction
**Feed:** feedSummaryGenerated
**Pull requests:** pullRequestReviewRequested, pullRequestReviewRerequested, pullRequestApproved, pullRequestChangesRequested, pullRequestCommented, pullRequestChecksFailed, pullRequestMention, pullRequestCommentMention, pullRequestRemovedFromMergeQueue
**Customers:** customerNeedCreated

## Known limitations (documented)

- Team access cannot yet be managed post-install in every path.
- `admin` scope cannot be requested with `actor=app`.
- Agents cannot sign in, access admin functionality, or manage users.

## Agent-adjacent product surfaces

- **Agent guidance** (workspace / team / personal) is passed to agents, but interpretation is up to each agent implementation — Linear explicitly disclaims consistency across third-party agents. `@`-mentioned documents in guidance are readable by the agent.
- **Agent visibility**: agent user pages, My Issues (delegated issues still shown), custom views filtered by **Delegate**, Insights sliced/segmented by **Delegate**.
- **Guest restriction**: Security → Integrations & applications → *Prevent guests from interacting with agents*.
- **Name collision**: a numeric suffix is appended.

## Requirements for a clone

1. App-user identity with per-workspace IDs and team scoping.
2. `app:assignable` / `app:mentionable` scopes and a **delegate** field distinct from assignee.
3. Agent Session objects with derived state, an activity stream (`thought` and friends), a 10-second acknowledgement expectation, and a `promptContext` builder that assembles issue + comments + guidance.
4. Webhook categories: agent session events, app user notifications, permission changes, inbox notifications.
5. A demo agent and SDK, because adoption of an agent platform is entirely a developer-experience problem.
