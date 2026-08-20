# API and integrations infrastructure

The product requirement is API parity: **one GraphQL API serves the web client, the desktop app, the published SDK, agents, and every integration.** This file covers the infrastructure that makes that true rather than aspirational.

## Serving GraphQL

`gqlgen` behind `api`, at `POST /graphql`.

| Concern | Implementation |
|---|---|
| Auth | `Authorization: <api_key>` or `Bearer <oauth_token>`, resolved once into a `Session{actor, workspace, scopes, teams}` in middleware |
| Persisted queries | Optional APQ for first-party clients — cuts request size, and lets you distinguish first-party traffic without giving it privileges |
| Introspection | Enabled (the spec requires it); disabled only if a security review demands it |
| Depth / complexity | `extension.ComplexityLimit` — see below |
| Dataloaders | Per-request, mandatory for `nodes { … }` traversals |
| Tracing | OTel span per resolver in dev; sampled in prod |
| Errors | Typed domain errors → `extensions.code` (`RATELIMITED`, `FORBIDDEN`, `VALIDATION`, `NOT_FOUND`). Partial success with HTTP 200 is the GraphQL norm and the spec explicitly documents it |

### Complexity scoring
Implement the documented model exactly, because integrations calibrate against it: **field 0.1, object 1, connection multiplies children by the pagination argument (default 50), round up. Hard cap 10,000 per query.** Emit `X-Complexity` on every response along with `X-RateLimit-Complexity-*`.

This is not decoration. It is the mechanism that stops one badly written integration from taking the box down, and it must exist before the first third-party app.

### Rate limits

Redis counters, leaky bucket, keyed by actor:

| Auth | Requests/h | Complexity/h |
|---|---|---|
| API key | 2,500 | 3,000,000 |
| OAuth app | 5,000 | 2,000,000 |
| Unauthenticated | 600 (per IP) | 100,000 |

Headers on every response: `X-RateLimit-Requests-{Limit,Remaining,Reset}`, `X-RateLimit-Complexity-{Limit,Remaining,Reset}`, plus `X-RateLimit-Endpoint-*` for the endpoints that carry their own tighter limits. Over-limit returns **HTTP 400** with `extensions.code = RATELIMITED` — matching the documented behaviour, however odd 400 looks.

Per-IP limiting is meaningless unless the forwarded-address header is trusted only from the proxy's own ranges: anything else is a header the caller sets, and an attacker who can set it mints a fresh bucket per request. `/healthz` is evaluated before that gate so container healthchecks keep working.

## OAuth server

Token exchange and revocation are on `api`: `POST /oauth/token`, `POST /oauth/revoke`. Consent (`GET /oauth/authorize`) is the SPA on `web` — Caddy must not send every `/oauth/*` path to the API.

Implementation notes that matter operationally:
- **Refresh-token grace period of 30 minutes.** Store `(token, replaced_by, replayable_until)`; a client that loses the response can replay and get the same new pair. This removes an entire class of "integration randomly logged out" support tickets.
- **Access tokens 24 h**, refresh rotating.
- **Client credentials** issue an `app` actor token valid 30 days with no refresh; up to 1,000 concurrent per app **provided scopes match**; requesting different scopes revokes the rest. Rotating the client secret invalidates them all.
- **Actor modes**: `actor=user` vs `actor=app`. The `app` actor is a real row in `users` with `type='app_user'`, one per (application, workspace), not billable, and carrying its own team-access grant.
- PKCE (`S256` and `plain`), `state` enforcement, exact redirect-URI matching.

Store tokens hashed (`sha256` + pepper), never in plaintext — a database dump must not be a set of live credentials.

## Inbound webhooks

`POST /webhooks/{github,gitlab,slack,sentry,ci,email,...}` on `api`.

The contract for every provider is identical:

```
1. Read raw body (never re-serialise before signature check)
2. Verify HMAC / provider signature — constant-time compare
3. Reject if the provider timestamp is older than 60s (replay protection)
4. Enqueue {provider, event, raw} to asynq
5. Return 200 in < 200 ms
```

**Never process inline.** GitHub retries aggressively on slow responses, and a slow integration handler must never occupy a request slot that a user's mutation needs.

Raise the proxy's request-body limit to 25 MB on `/webhooks` — email intake carries attachments, and 25 MB is what the parser enforces.

## Outbound webhooks

The single most operationally annoying subsystem, because it is a distributed system whose remote half is broken by strangers.

```
change_log row → worker matches subscriptions (workspace, resource type, team scope)
               → build payload {action, type, actor, data, url, updatedFrom,
                                organizationId, webhookId, webhookTimestamp}
               → sign: hex HMAC-SHA256 of the raw body with the endpoint secret
               → headers: Linear-style Delivery / Event / Signature / Timestamp
               → POST, 5s timeout
               → 200 ⇒ done; otherwise retry at 1m, 1h, 6h
               → after the third failure: mark failing; after N consecutive
                 failed deliveries: disable the webhook and notify the admin
```

Infrastructure requirements:
- **A delivery log row per attempt** (endpoint, status, duration, response snippet, attempt number), retained 14 days, visible to workspace admins. Customers self-diagnose with it; without it every integration bug becomes a support conversation.
- **Per-endpoint concurrency cap** so one slow consumer can't starve the queue.
- **A separate asynq queue** with its own worker pool — webhook delivery must never delay cron or search indexing.
- **Egress allow-list documentation**: the VPS's single public IP is what customers put in their firewall rules. Publish it; changing VPS means notifying every customer with an IP allow-list.
- **SSRF protection**: refuse `127.0.0.0/8`, `169.254.0.0/16`, `10/8`, `172.16/12`, `192.168/16`, and any address that resolves into them **after** DNS resolution. Re-resolve at request time and pin the resolved IP. Otherwise a webhook URL is a request-forgery primitive into the fleet's internal network — which, on a box hosting twenty other sites, is a serious finding.

## Integration workers

Each integration is a package under `internal/integrations/` exposing:

```go
type Integration interface {
    Install(ctx, workspace, cfg) error
    HandleWebhook(ctx, event RawEvent) error   // inbound
    Sync(ctx, workspace) error                 // pollers: Gong, Sheets, attributes
    Disconnect(ctx, workspace) error
}
```

They call `domain/` only. Never `store/`, never raw SQL. That rule is what guarantees a GitHub-created issue behaves identically to a UI-created one — same validation, same change log, same activity entry, same notifications.

Polling schedules (from the product spec): Intercom attributes real-time via webhook; other support sources every 12 h; Google Sheets hourly when changed; Gong periodic; Airbyte pulls on its own 12 h+ cadence.

## Email

Two directions, both off-box.

**Outbound** — SMTP relay (SES / Postmark / Resend), configured via `POLARIS_SMTP_HOST` / `_PORT` / `_USERNAME` / `_PASSWORD` and `POLARIS_MAIL_FROM`. Discrete variables rather than one URL: the password routinely contains characters that have to be percent-encoded inside a URL, and a relay password pasted in raw is a startup failure whose message points at the parser rather than at the paste. Leaving `POLARIS_SMTP_HOST` empty is supported and is the self-host default — the product runs, the inbox works, and nothing is emailed.
- DNS: SPF, DKIM (provider keys), DMARC on the sending domain.
- Separate streams for transactional (invites, magic links, digests) and Asks replies, so a bounce storm in one doesn't sink the other's reputation.
- **Asks custom domains** are a product feature: customers reply-from their own domain, which needs relaxed DMARC alignment (`aspf=r`, `adkim=r`) and per-customer DKIM records. Provider must support multiple verified sending domains — check this before choosing.

**Inbound** — provider parse webhook → `POST /webhooks/email`.
- Verify `INBOUND_MAIL_SECRET`.
- Enforce 25 MB attachment and 250 KB body limits at the edge.
- Strip quoted reply history before creating the comment (the synced-thread behaviour the spec describes).
- Address scheme: `<team-or-template-token>@in.<your-host>`, tokens random and revocable — anyone who learns the address can file issues.

**Do not run Postfix on the VPS.** An MTA next to the product database, on a box with twenty other tenants, is not worth the €10/month saved.

## SDK and developer surface

- `@polaris/sdk` generated from `schema/schema.graphql`, published on tag by CI. Typed models, a raw GraphQL escape hatch, and error parsing — the shape developers expect.
- A GraphQL explorer at `/graphql` in dev; in prod, point at a hosted schema reference generated from the same file.
- **Webhook schema explorer**: publish the payload shapes, generated from the same Go structs that serialise them — hand-written webhook docs drift within a month.
- A **sandbox workspace** per developer account, so integrations can be tested without polluting real data.

## MCP server

Runs as an extra route on `api` (not a separate container until it earns one): Streamable HTTP at `/mcp`, read-only variant at `/mcp/readonly`.

- OAuth 2.1 with dynamic client registration — a distinct code path from the main OAuth server, sharing token storage.
- Read-only enforcement at the **token scope** level, not just by hiding tools. A `read`-scoped token must be incapable of reaching a write resolver.
- Long-lived streaming responses: raise `proxy_read_timeout` on this location too.
- Rate limits apply per actor exactly as for GraphQL; an agent looping is indistinguishable from an integration looping.

## Agent platform hosting

Deferred to Phase 5–6, but the shape is decided now:
- Agent sessions and activities are ordinary domain entities with their own change-log stream and webhook category.
- Third-party agents run **on the developer's infrastructure**, not yours — you deliver webhooks and accept API calls. No hosting burden.
- **Coding sessions are the exception** and the reason for a second machine: untrusted, model-authored code with network access and repository credentials cannot run on the box that holds every customer's database. Separate disposable runners, gVisor or Firecracker, no route back into `polaris_internal`, credentials scoped per session and revoked at the end.
