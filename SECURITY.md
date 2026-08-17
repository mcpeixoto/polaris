# Security policy

## Reporting a vulnerability

Email **security@peixotolabs.com**. Do not open a public issue.

You will get an acknowledgement within 72 hours and an assessment within 7 days. We ask
for 90 days before public disclosure, and we will credit you in the advisory unless you
ask us not to.

If you have not heard back in 72 hours, assume the email went astray and chase it — that
is a failure on our side, not an imposition on yours.

## What is in scope

The application: authentication, the authorisation model, the sync engine's visibility
filtering, the GraphQL API, the webhook delivery path, and the self-hosted deployment
artifacts in this repository.

Out of scope, because they are somebody else's to fix or not vulnerabilities:

- Findings that require an attacker to already control the workspace's admin account
- Rate limiting on endpoints with no state-changing effect
- Missing headers with no demonstrated impact
- Reports from an automated scanner with no working proof of concept
- Social engineering of our staff or our users

## Where a vulnerability here is most likely to be

Said plainly, so a researcher can spend their time well:

**Permission-scoped replication.** Every client holds a *different* filtered subset of a
workspace. One predicate — `authz.Visible` — decides what a session receives, and it is
applied to GraphQL results, sync deltas, search and exports. Anything that returns data
without going through it is a leak. This is the highest-value place to look.

**Revocation.** Losing access has to actively remove data a client already holds. If a
`revoke` event fails to reach somebody removed from a team, they keep a complete, readable,
permanently stale copy — and nothing errors, so nobody notices.

**The change log's `scope`.** The sync hub judges each change from the scope recorded on
the row, not by re-reading the entity. A change written with the wrong scope is delivered
to the wrong people, and it is delivered *later*, which makes it hard to trace back.

**Multi-tenancy.** Every table carries `workspace_id`. A query that filters by entity id
without also constraining the workspace is a cross-tenant read.

## What we have deliberately made hard

- Passwords are Argon2id with the cost parameters stored per hash, verified in constant
  time, with the input length bounded so an unauthenticated endpoint cannot be used to
  exhaust the box.
- Refresh tokens are opaque, stored only as SHA-256 digests, HttpOnly, and rotated on
  every use — a stolen token is usable at most once, and the legitimate client's next
  refresh fails loudly.
- Access tokens pin HMAC-SHA256 in two places, so `alg: none` and algorithm-confusion
  forgeries are rejected rather than trusted.
- "Not found" and "forbidden" are deliberately conflated where distinguishing them would
  confirm that a private team's entity exists.
- Sign-up and sign-in return the same message for an unknown address and a wrong password,
  and hash on both paths, so neither the wording nor the timing enumerates accounts.
- The WebSocket handshake checks Origin, because browsers do not apply CORS to upgrades.
- Production containers publish no ports, run as uid 10001 on distroless, and datastores
  sit on an internal network the reverse proxy cannot route to.
- The Docker socket is never mounted into any Polaris container.

None of that means the list above is empty. It means we would be more surprised to be
wrong there than elsewhere.

## Supported versions

Until 1.0, only the latest release. After 1.0, the current minor and the one before it.
