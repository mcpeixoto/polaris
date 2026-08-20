# Sentry v1 (create issue from webhook, link)

**Status:** shipped on main  
**Migration:** `000061_sentry`  
**Client schema:** 42

Workspace Sentry install: a webhook that creates a Polaris issue on a default public team and attaches the Sentry URL. Linking the same URL again is idempotent.

## Scope

- Settings → Sentry: admin connects with a default public team, copies webhook URL + secret, disconnects
- One connection per workspace; secret is never replicated
- `POST /webhooks/sentry/{workspaceId}` — HMAC (`Sentry-Hook-Signature`) or `X-Sentry-Token`; optional 60s timestamp window
- Issue-created, alert-triggered, and legacy plugin payloads create an issue + attachment
- `linkSentryIssue` attaches a sentry.io URL to an existing issue
- Cloud only (`sentry.io` / `*.sentry.io`); public teams only
- Replica type `sentryConnection`

## Deferred

- Auto-resolve linked Sentry issues when the Polaris issue completes
- Assignee sync by email
- Official Sentry OAuth / Linear action in Sentry alert rules
- Sentry icon as a board display property
- Self-hosted Sentry
- Multiple Sentry organizations per workspace
