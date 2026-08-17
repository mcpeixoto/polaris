# GraphQL API

**The single most important architectural constraint in this project:** Linear's public API is the same API its own applications use. Every integration, the mobile apps, the desktop app, and the agent platform sit on it. A clone that bolts an API onto a private backend will diverge and rot.

## Endpoint and auth

`POST https://api.linear.app/graphql` — introspection enabled.

| Method | Header |
|---|---|
| Personal API key | `Authorization: <API_KEY>` |
| OAuth access token | `Authorization: Bearer <ACCESS_TOKEN>` |

API keys are created in Settings → Account → Security & Access, scoped to **Read / Write / Admin / Create issues / Create comments** and optionally limited to **specific teams**. Admins control whether members may create keys at all. Keys are revoked when the user is suspended or converted to a guest.

An official **TypeScript SDK** (`@linear/sdk`) wraps the schema in typed models and operations, exposes the raw `LinearGraphQLClient` (`linearClient.client.rawRequest(...)`), allows header injection, supports a custom GraphQL client via `LinearSdk` extension, and parses errors through `parseLinearError`.

## Shape of the API

- **Queries** for every entity, singular and plural: `viewer`, `issue(id)`, `issues(filter:)`, `team(id)`, `teams`, `user(id)`, `users`, `workflowState(id)`, `workflowStates`, `projects`, `cycles`, `attachment(id)`, `attachmentsForURL(url)`, `auditEntries`, `auditEntryTypes`, `webhooks`, …
- **Mutations** for every entity, named `<entity><Verb>`: `issueCreate`, `issueUpdate`, `projectCreate/Update/Archive/Unarchive/Delete`, `cycleCreate`, `initiativeCreate`, `issueRelationCreate`, `entityExternalLinkCreate`, `attachmentCreate/Update`, `customerCreate/Update/Upsert`, `customerNeedCreate`, `customerTierCreate`, `webhookCreate/Delete`, `attachmentLinkSlack`, …
- Mutations return `{ success, <entity> }`.
- IDs: UUIDs, but **issue shorthand identifiers work too** (`issue(id: "BLA-123")`, `issueUpdate(id: "BLA-123", …)`). "Copy model UUID" in the command menu exposes IDs from the UI.
- Real-time: mutations made via the API are observed live by all clients.

### Representative inputs
`IssueCreateInput`: `title` (required), `teamId` (required), `description`, `stateId`, `assigneeId`, `priority` (0–4), `estimate`, `labelIds`, `projectId`, `cycleId`, `parentId`.
`ProjectCreateInput`: `name` (required), `teamIds` (required), `description`, `statusId`, `leadId`, `startDate`, `targetDate`, `labelIds`, `priority`.
`CycleCreateInput`: `teamId`, `startsAt`, `endsAt` (all required), `name`, `description`.
`IssueRelationCreateInput`: `issueId`, `relatedIssueId`, `type` (`blocks` | `duplicate` | `related`).
`EntityExternalLinkCreateInput`: `label`, `url`, attached via `issueId` | `projectId` | `initiativeId`.

### Creation semantics to preserve
- An issue created **without** `stateId` goes to the team's first Backlog-category state — or to **Triage** if the team has Triage enabled.
- Property changes in the first **3 minutes** after creation don't appear in the activity log.

## Pagination

Relay-style cursor pagination with `first`/`after` and `last`/`before`.

```graphql
query Issues {
  issues(first: 10) {
    edges { node { id title } cursor }
    pageInfo { hasNextPage endCursor }
  }
}
```

- Simplified `nodes { … }` form is supported alongside `edges`.
- **Default page size is 50** when no arguments are given.
- Default ordering is `createdAt`; `orderBy: updatedAt` is available and is the recommended way to poll for changes.
- Archived resources are hidden by default; include with `includeArchived: true`.

## Filtering

Filters mirror the UI's filter grammar and are available on most paginated fields.

**Comparators** — string, numeric, date: `eq`, `neq`, `in`, `nin`. Numeric/date add `lt`, `lte`, `gt`, `gte`. Strings add `eqIgnoreCase`, `neqIgnoreCase`, `startsWith`, `notStartsWith`, `endsWith`, `notEndsWith`, `contains`, `notContains`, `containsIgnoreCase`, `notContainsIgnoreCase`. Optional fields support `null: true|false`.

**Logic** — fields combine with implicit `AND`; `or: [ … ]` switches to disjunction (nestable).

**Relations** — filter by related entities (`assignee: { email: { eq: … } }`); many-to-many defaults to "at least one matches", and `every: { … }` requires all to match.

**Relative time** — date fields accept ISO 8601 durations relative to now: `dueDate: { lt: "P2W" }`, `completedAt: { gt: "-P2W" }`.

Worked examples from the docs:
```graphql
# urgent + high priority, excluding unprioritised
issues(filter: { priority: { lte: 2, neq: 0 } })

# all issues labelled Bug in projects led by anyone named John
projects(filter: { lead: { name: { startsWith: "John" } } }) {
  nodes { issues(filter: { labels: { name: { in: ["Bug","Defect"] } } }) { nodes { id title } } }
}

# started issues in ongoing projects with no estimate
issues(filter: {
  estimate: { eq: 0 }
  state: { type: { eq: "started" } }
  project: { state: { eq: "started" } }
})
```

## Rate limiting

Leaky-bucket, refilling at `LIMIT_AMOUNT / LIMIT_PERIOD`.

**Request limits**

| Auth | Limit | Per | Period |
|---|---|---|---|
| API key | 2,500 (docs also cite 5,000 for authenticated requests) | User | 1 hour |
| OAuth app | 5,000 | User (or app user) | 1 hour |
| Unauthenticated | 600 | IP | 1 hour |

Headers: `X-RateLimit-Requests-Limit`, `-Remaining`, `-Reset` (UTC epoch ms).

Some queries/mutations carry their own tighter limits, reported via `X-RateLimit-Endpoint-Requests-Limit/-Remaining/-Reset` and `X-RateLimit-Endpoint-Name`.

**Complexity limits**

| Auth | Points | Per | Period |
|---|---|---|---|
| API key | 3,000,000 | User | 1 hour |
| OAuth app | 2,000,000 | User (or app user) | 1 hour |
| Unauthenticated | 100,000 | IP | 1 hour |

Headers: `X-Complexity`, `X-RateLimit-Complexity-Limit/-Remaining/-Reset`. **Maximum complexity of a single query: 10,000 points** — over that it's always rejected.

**Scoring model:** each property = 0.1 point, each object = 1 point, each connection multiplies its children by the pagination argument (default 50), rounded up. `user { name }` = 2. `user { createdIssues { nodes { id title createdAt } } }` = 1 + 50 + (50×3×0.1) = 66. Adding `first: 10` drops it to 14. **Always pass explicit pagination limits.**

Workspace-level OAuth apps using actor authorisation get **dynamically increased** limits based on the workspace's paid user count.

**Error shape:**
```json
{ "errors": [ { "message": "...", "extensions": { "code": "RATELIMITED" } } ] }
```
Note GraphQL rate-limit responses return **HTTP 400**, not 429 — inspect `extensions.code`.

## Error handling

Standard GraphQL errors array with `message`, `path`, and `extensions`. Queries can **partially succeed with HTTP 200** while returning errors for individual fields — always inspect `errors` before assuming success. Watch 5xx separately. Use typed clients to catch validation problems at build time.

## Efficiency guidance (published as API best practice)

**Do:** register webhooks instead of polling; if you must poll, `orderBy: updatedAt` and stop when you reach known data; filter server-side; write specific queries rather than leaning on SDK defaults; set explicit page sizes.
**Don't:** poll per-issue — the documented anti-pattern that gets applications rate limited.

## Markdown affordances via the API

- **Mentions**: put the plain resource URL in markdown — `https://linear.app/<ws>/profiles/<user>` and `https://linear.app/<ws>/issue/LIN-123/...` render as `@user` and `@LIN-123`.
- **Collapsible sections**: `+++ Title` … `+++`.

## Assets

Uploaded images and files sit **behind authentication**. API consumers must authenticate to fetch them, and Linear advises downloading and re-hosting anything displayed outside the product.

## Gaps to consider closing in a clone

- **No REST API.** Explicitly acknowledged as painful for bulk customer imports / rETL pipelines.
- **No bulk import endpoint** for customers (or anything else).
- Label filtering across teams behaves differently in the API (per-team label IDs) than in the UI (name-matched) — a genuine papercut.
