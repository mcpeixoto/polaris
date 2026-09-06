# MCP: dynamic registration and a wider tool surface (12.7)

**Status:** shipped on main
**Migration:** `000082_oauth_dynamic_registration`
**Client schema:** 54 (unchanged — nothing here is a synced entity)

The deferred half of [MCP server v1](30-mcp-server-v1.md). v1 worked, but connecting meant
generating an API key and pasting it into a config file, and the nine tools covered issues
and little else.

## Scope

### Connecting is now one command

`POST /oauth/register` implements RFC 7591 dynamic client registration, so a client
registers itself and sends the person to the consent screen that already existed. The
authorization server underneath it — codes, PKCE with S256, refresh rotation, the consent
UI — was already built; what was missing was the endpoint that lets a client it has never
met ask for an identity.

A self-registered client is a **public** client:

- No secret is issued, and none is accepted. PKCE is what proves the redemption came from
  the client that started the flow, so it is **mandatory** for these clients and **S256
  only** — `plain` puts the verifier on the wire, which defeats the exchange it stands in
  for. Confidential clients keep both methods, backstopped by their secret.
- It has **no owner**. `workspace_id` and `creator_id` are null, which is what the new
  check constraint ties to `dynamically_registered`. Modelling it as somebody's OAuth
  application would put a row in one workspace's application list that another workspace's
  tokens depend on.
- It is **not listed** in Settings → OAuth applications, and cannot use the
  client-credentials grant: with no owning workspace there is nothing for a two-legged
  token to act in.
- Registration is unauthenticated, by specification — the client is asking for an identity
  before anyone has signed in. Registration grants nothing on its own; consent is where the
  decision happens. The anonymous rate limiter bounds the endpoint, and a worker job sweeps
  self-registered clients idle for 90 days that hold no live token.

`registration_endpoint` is advertised in the authorization-server metadata, and both the
bare and `/mcp`-suffixed well-known paths answer, because clients disagree about which one
to probe and a miss reads as "not an OAuth-protected resource".

### Protocol

`2025-06-18`, negotiated: `initialize` echoes the client's version when we speak it and
otherwise names the newest we do. `2025-03-26` stays supported — the clients pinned to it
are the ones least likely to update. A request stating a version we do not implement is
refused rather than half-served.

### Tools: 9 → 30

The catalogue moved out of the MCP server into `internal/agent/tools`, a provider-neutral
registry. It was a switch statement inside one transport, which made the set of things an
agent can do a property of that transport; the in-app agent needs the same verbs without
going near an HTTP handler.

13 reads, 17 writes. Issues gain assignment, state, labels, estimate, due date, sub-issues,
relations and archive; projects gain create/update/get, milestones and adding an issue;
comments gain update, delete and reactions; and there are now metadata reads for users,
workflow states, labels and cycles. A team, state, label or person can be **named** rather
than given as a UUID, everywhere.

**The read-only gate is now asked of the tool.** It used to be a hardcoded list of three
tool names, so all fourteen writes added here would have passed it on `/mcp/readonly`. It
reads `Tool.ReadOnly`, and a test walks every write tool in the registry to prove it.

### Prompts

`prompts/list` returned `[]`. It now ships the six documented workflows — roadmap planning,
standup notes, bug investigation, cycle summary, timeline, implementation plan — as real
MCP prompts. The failure mode of a tool server is not a missing tool but a model holding
thirty of them with no idea which combination the product expects.

## Deferred

- **RFC 8707 resource indicators.** Validating `resource` at the token endpoint alone is
  theatre; doing it properly means carrying the parameter through the consent screen and
  storing it on the authorization code. Worth doing, not done here.
- SSE fallback transport, for clients without Streamable HTTP.
- Documents, cycles and initiative writes.
- Per-client revocation UI for self-registered clients: today the remedy is revoking the
  token from Settings → Sessions.
