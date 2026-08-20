# View subscriptions v1 (10.8, personal)

**Status:** shipped on main  
**Migration:** `000055_view_subscriptions`  
**Client schema:** 36

Personal watches on a saved view. Slack-channel subscriptions stay out — they need a Slack install.

## Scope

- One person, one view, two independent flags: notify when a newly created issue matches, and when a matching issue is completed or canceled
- `setViewSubscription` / `deleteViewSubscription`; both flags false is unsubscribe
- Guests cannot subscribe
- Fan-out: added only on create; completed only when status moves into completed/canceled; never the actor; muted types respected
- Archiving a view deletes its subscriptions (archive does not CASCADE)
- Subscribe menu on a saved view’s issue list; mute types and a follow list on Notifications

## Deferred

- Slack-channel subscriptions
- “Added” via a property change that newly matches the filter (needs previous-payload evaluation)
- Workspace-shared watches
