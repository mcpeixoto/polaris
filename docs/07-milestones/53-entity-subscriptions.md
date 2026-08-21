# Project, initiative and customer bell subscriptions

**Status:** shipped on this branch
**Migration:** `000076_entity_subscriptions`
**Client schema:** 53

Personal watches on a project, initiative, or customer. Slack-channel subscriptions stay
out — they need a Slack install.

## Scope

- One person, one target, independent event flags. Both/all false is unsubscribe.
- `setProjectSubscription` / `setInitiativeSubscription` / `setCustomerSubscription`
- Guests cannot subscribe
- Fan-out: never the actor; muted types respected
- Project: new issues in the project, those issues completing or canceling, new updates
- Initiative: the same for issues in linked projects, plus initiative updates
- Customer: a request added, marked important, or its issue completed/canceled
- Archiving the target deletes its subscriptions (archive does not CASCADE)
- Subscribe menu (bell) on the project, initiative, and customer pages; a follow list on
  Notifications

## Deferred

- Slack-channel subscriptions
- Description / comment watches on the project or initiative itself
- Property changes that move an existing issue into a project
