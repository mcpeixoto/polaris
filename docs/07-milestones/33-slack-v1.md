# Slack v1 (channel notify, slash, unfurls)

**Status:** shipped on main  
**Migration:** `000065_slack`  
**Client schema:** 44

Workspace Slack install: an optional Slack incoming-webhook URL posts issue and comment events to a channel. Slash commands create or comment on issues. Link unfurls and magic-word linkbacks use a Slack app whose signing secret and bot token live in process env.

## Scope

- Settings → Slack: admin picks a default public team, optionally pastes a Slack incoming-webhook URL, toggles issue/comment notify
- One connection per workspace; webhook URL is never replicated
- `POST /webhooks/slack/{workspaceId}/command` — Slack slash (`/polaris create`, `/polaris ENG-123`, `/polaris comment ENG-123 text`)
- `POST /webhooks/slack/{workspaceId}/events` — `url_verification`, `link_shared` unfurls, `message` magic-word linkbacks
- Env: `POLARIS_SLACK_SIGNING_SECRET` (incoming verify), `POLARIS_SLACK_BOT_TOKEN` (chat.unfurl)
- Worker posts Slack messages from the same change_log the outbound webhook job reads
- Replica type `slackConnection`
- Entitlement `slack` is true on every plan

## Deferred

- OAuth “Add to Slack”
- Per-team channel mapping
- @Polaris agent / interactive issue create modal
- Thread replies on the original Slack message
