# Sessions list (Security & Access)

**Status:** shipped on this branch
**Migration:** none (`account_session` has existed since M0; do not take 000074 — goose at 75 skips it)
**Client schema:** 52, unchanged — sessions are not replicated

Settings → Sessions. Location, last seen, IP, sign-in date; revoke one device or every
other device. The refresh token is never on the wire.

## Scope

- `accountSessions` lists the caller's live sessions. The current device is the refresh
  cookie on that request, not a claim on the access token (those rotate independently).
- `revokeAccountSession` and `revokeOtherSessions`. A foreign id is not-found, never
  forbidden. No cookie means there is no "this device" to keep, so revoke-others refuses.
- Guests can list and revoke their own sessions.

## Deferred

- Passkeys / WebAuthn (`account_credential` already exists; adding registration is a
  feature, not a migration of the auth model)
- Authorised OAuth applications listing on the same page
- Geo lookup beyond the `country` column already stored
