# Webhooks

HTTP POST push notifications on data change. The mandatory alternative to polling.

## Scope and configuration

- Webhooks belong to an **Organization**, and are configured either for **all public teams** or a **single team**.
- Created in Settings → Administration → API, or via `webhookCreate`. **Only workspace admins, or OAuth apps with the `admin` scope, can create or read webhooks.**
- **OAuth applications** can declare webhook settings once; then each time a new organisation authorises the app, a webhook is created for that org pointing at the app's URL. When the app is de-authorised, an `OAuthApp revoked` event is sent.

```graphql
mutation {
  webhookCreate(input: {
    url: "https://example.com/webhooks/linear-consumer"
    teamId: "72b2a2dc-…"          # or allPublicTeams: true
    resourceTypes: ["Issue"]       # [Comment, Issue, IssueLabel, Project, Cycle, Reaction]
  }) { success webhook { id enabled } }
}
```

Query with `webhooks { nodes { id url enabled team { id name } } }` or per team; delete with `webhookDelete(id:)`.

## Supported event sources

**Data change webhooks:** Issues, Issue attachments, Issue comments, Issue labels, Comment reactions, Projects, Project updates, Documents, Initiatives, Initiative updates, Cycles, Customers, Customer Requests, Users.

**Convenience streams:** Issue SLA, OAuthApp revoked, **Agent session events**, **App user notifications**, **Permission changes**, **Audit log streaming**.

## Delivery contract

- Consumer must be a publicly reachable **HTTPS**, non-localhost URL returning **HTTP 200**.
- A delivery fails on non-200, unavailability, or **>5 seconds** to respond.
- Retries: up to **3**, with backoff at **1 minute, 1 hour, 6 hours**. Persistent failure may **disable** the webhook, requiring manual re-enable.
- Return 500 deliberately if you want a retry; 200 acknowledges.

## Headers

```
Accept-Charset: utf-8
Content-Type: application/json; charset=utf-8
Linear-Delivery: <uuid v4, unique per payload>
Linear-Event: Issue            # entity type
Linear-Signature: <hex HMAC-SHA256 of the raw body>
Linear-Timestamp: 1676056940508
User-Agent: Linear-Webhook
```

## Payload

Data-change events carry:

| Field | Meaning |
|---|---|
| `action` | `create` \| `update` \| `remove` |
| `type` | Entity type targeted |
| `actor` | `User`, OAuth client, or Integration — **may be null** if since deleted |
| `createdAt` | When the action happened |
| `data` | Serialised entity, matching the GraphQL shape |
| `url` | URL of the subject entity |
| `updatedFrom` | For updates: previous values of changed properties (previously-unset → `null`) |
| `organizationId`, `webhookId`, `webhookTimestamp` | Routing and replay protection |

```json
{
  "action": "create",
  "actor": { "id": "…", "type": "user", "name": "…", "email": "…", "url": "…" },
  "data": { "id": "…", "createdAt": "…", "updatedAt": "…", "archivedAt": null,
            "body": "…", "edited": false, "issueId": "…", "userId": "…" },
  "type": "Comment",
  "url": "https://linear.app/issue/LIN-1778/foo-bar#comment-…",
  "createdAt": "2020-01-23T12:53:18.084Z",
  "organizationId": "…",
  "webhookTimestamp": 1676056940508,
  "webhookId": "…"
}
```

Non-data-change streams use the same envelope with stream-specific `action` values — e.g. Issue SLA uses `set`, `highRisk`, `breached` and adds `issueData`; OAuthApp revoked adds `oauthClientId` and `organizationId`.

**`updatedFrom` is the key efficiency lever** for sync engines: it tells you exactly which fields changed, so you can skip round-trips to the other system.

## Securing the consumer

Two independent mechanisms, both documented as recommended:

1. **Signature + timestamp.** `Linear-Signature` is a hex HMAC-SHA256 of the **raw** body using the webhook's signing secret. Restringifying parsed JSON will produce a different signature. Compare with a timing-safe equality function, then reject payloads whose `webhookTimestamp` is more than ~60 seconds old to prevent replay.

```js
const crypto = require("node:crypto");
function verifySignature(headerSignatureString, rawBody) {
  if (typeof headerSignatureString !== "string") return false;
  const headerSignature = Buffer.from(headerSignatureString, "hex");
  const computed = crypto.createHmac("sha256", LINEAR_WEBHOOK_SECRET).update(rawBody).digest();
  return crypto.timingSafeEqual(computed, headerSignature);
}
```

2. **Source IP allow-list.**
```
35.231.147.226  35.243.134.228  35.196.141.51
34.140.253.14   34.38.87.206    34.62.119.29
34.134.222.122  35.222.25.142   34.60.255.158
```

## Audit log streaming (Enterprise)

Enable *Stream logs* on the Audit Log settings page to push audit entries to a webhook for SIEM ingestion, secured with the same signing-secret mechanism. Sample payloads carry `action`, `actor`, `data.type` (e.g. `userJoinedTeam`, `webhookCreated`), `data.metadata`, `ip`, and `requestInformation` (userAgent, authMethod, authService).

## Requirements for a clone

- Per-webhook signing secret with rotation.
- Resource-type subscription filtering, plus team scoping and `allPublicTeams`.
- Delivery log with per-attempt status, viewable by admins (Linear surfaces enough of this that customers can self-diagnose).
- Automatic creation of an org webhook on OAuth install, and automatic revoke notification.
- At-least-once delivery semantics with the documented backoff, and disable-after-persistent-failure.
- Private-team data must not leak: default to public teams only, with explicit team scoping otherwise — and document the residual risk, as Linear does.
