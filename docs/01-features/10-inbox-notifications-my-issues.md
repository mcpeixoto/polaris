# Inbox, notifications, My Issues, Pulse

**Depends on:** issues, comments, projects, subscriptions, integrations.
**Depended on by:** every collaborative feature.

## Subscription model

You are auto-subscribed to an issue when you: create it, are assigned it, or are @mentioned in its description or a comment. Being mentioned **in a thread** subscribes you to that thread only, not the whole issue.

Manage with `Shift+S` (subscribe/unsubscribe) and `Cmd/Ctrl+Shift+S` (manage subscribers) — works on multi-select. From the Inbox you must open the notification first to unsubscribe. Documents, projects, initiatives, customers, and views have their own subscribe controls (bell icon).

## Inbox

Sidebar item, `G` then `I`.

- Navigate with `J/K` or `↑/↓`; open a notification to get a special Inbox view of the issue where you can both act on the notification and edit the issue.
- Actions: `U` mark read/unread, `Option/Alt+U` mark all read, `Backspace` delete, `Shift+Backspace` delete all read, `H` snooze. Right-click for the contextual menu, including issue property updates.
- **Quick search** `Cmd/Ctrl+F` filters by issue title, ID, notification type, assignee, team, project, priority. `Esc` clears.
- **Display options**: which properties show; *Show snoozed*; *Show read*.
- **Snooze** hides a notification until a chosen time; it reappears then.
- **Reminders**: set on issues, documents, projects, and initiatives (`H`, ⋯ → Remind Me, or command menu). The pending reminder shows at the top of the issue and can be rescheduled or cancelled. Custom date input accepts typed phrases (must be typed in full): `Jan 3 10am`, `next quarter`, `til/until <month|date>`, `for X months/weeks/days`.
- Cap: **2,000** open notifications; older ones are archived automatically. No manual archiving.
- You cannot choose what enters the Inbox — everything lands there, and other channels link back to the Inbox item.

## Notification channels

Settings → Account → Notifications. Channels: **Desktop**, **Mobile**, **Email**, **Slack** (green dot = enabled, grey = disabled). Also controls product communications (changelog, DPA updates).

- Desktop, mobile, and Slack are **real-time**. Personal Slack notifications arrive as DMs from the Linear app and mirror what you'd get in Inbox/email/desktop.
- **Email** has two modes: immediate delivery or **digest**. Digests batch unread notifications and are delayed based on urgency/issue status, and are only sent if you haven't already read the Inbox notification.
- Notification types are **grouped** — e.g. "status changes" bundles completions, cancellations, urgent-priority changes, and blocking-relationship changes. You cannot subscribe to a single sub-event. For per-status alerts, use a **view subscription** instead.

Browser notifications use the Push API (Safari doesn't support it — hence the desktop app recommendation). macOS dock badge requires OS-level permission plus the badge setting.

### Other notification producers
- **Project/initiative notifications** — bell icon on the page: personal Inbox notifications for new issues in the project, description changes/comments, issue completion/cancellation, and new updates; plus Slack channel notifications for issue creation, comments, and status changes.
- **View subscriptions** — personal or Slack, on issue-added / completed-canceled.
- **Team Slack notifications** — channel feed of team issue activity.
- **Customer subscriptions** — notify when a request is added, marked important, completed, or cancelled for a customer.
- **SLA notifications** — 24h before breach and on breach, to subscribers; opt-in for all team SLAs; Slack 24h/1 business day ahead.
- **Due date notifications** — near due and past due.
- **Code review notifications** — see `17-code-review-and-diffs.md`.
- **Triage responsibility notifications**.
- **Pulse digests**.
- **Agent/app-user notifications** — the `AppUserNotification` webhook category.

## My Issues

`G` then `M`. Tabs: **Assigned**, **Created**, **Subscribed**, **Activity** (+ **Shared** on Enterprise for privately shared issues).

- **Assigned** uses a curated *Focus* ordering: urgent work → SLA-bound → blockers → cycle work → other active → triage → backlog → completed. Sections appear only when relevant; within each, ordered by priority with started issues first. Grouping is overridable via display options.
- Issues **delegated to agents** still appear here — the human assignee keeps visibility.
- **Created** includes issues created on your behalf through integrations (Slack, Front, Intercom, Zendesk, Sentry).
- **Activity** lists: issue created, issue updated, assigned issue state changed, issue commented, comment reacted, opened pull request.

## Pulse

A feed of **project status updates**, available on all plans (not to guests). Sidebar item, `G` then `U`. Navigate with `J`/`K`; Enter opens the project's Activity tab.

**Shipped:** replica-derived `/pulse` with **For me**, **Popular** (comment engagement), **Recent**, and personal custom feeds. No extra query — posts already in the replica.

**Not yet:** emoji reactions on Popular, initiative updates, Pulse audio.
