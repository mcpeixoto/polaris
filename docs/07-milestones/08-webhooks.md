# Webhooks v1 (outbound, signed)

**Goal:** an admin can subscribe an HTTPS URL to workspace changes, deliveries are HMAC
signed, private-team data does not leak onto an all-public-teams hook, and a URL that
keeps failing is disabled rather than retried forever.

This is inventory 12.5. OAuth auto-install, inbound provider webhooks, and audit-log
streaming stay out. The visual bar is part of done: settings, not a generic CRUD form.

---

## What stays true

**Not replicated.** Like API keys: one admin settings screen, a signing secret that must
be stored so we can sign, never selected by a listing query.

**gqlgen still rewrites `schema.resolvers.go`.** Helpers stay in `domain/webhooks.go` and
`internal/webhookout`.

**Every event is a change_log row.** Fan-out queues delivery rows; HTTP happens afterwards
so a slow consumer cannot hold the workspace version lock.

**SSRF is load-bearing.** HTTPS only at create. At delivery, DNS is re-resolved and any
private/link-local/loopback/CGNAT address is refused, then the public IP is pinned for
the connect.

**Retries:** first POST, then 1 minute, 1 hour, 6 hours. A fourth failure disables the
webhook. The signed body is the stored JSON, so a retry hashes the same bytes.

**Private teams.** `allPublicTeams` never receives a change whose team is private. A
team-scoped webhook on a private team will receive that team's issues — residual risk,
same as Linear documents; creating one is admin-only.

**History is not replayed.** Creating a webhook pins the cursor at the current workspace
version.

---

## Done criterion

> Creating a webhook, then filing ENG-1, POSTs one signed `Issue` `create` to the URL.
> Filing on a private team does not. Four 500s disable the webhook. The secret appears
> in the create dialog once and never in the listing.
