# OAuth 2.0, scopes, and app identity

## Application setup

Create an OAuth2 application with redirect callback URLs. Linear's own guidance: **create a dedicated workspace to own the application**, because every admin of that workspace gets access to it.

Applications can also declare webhook settings, so authorising organisations automatically get a webhook (see `02-webhooks.md`).

## Authorization request

`GET https://linear.app/oauth/authorize`

| Param | Notes |
|---|---|
| `client_id` | required |
| `redirect_uri` | required |
| `response_type=code` | required |
| `scope` | required, comma-separated |
| `state` | optional but strongly recommended (CSRF) |
| `prompt=consent` | optional — always show consent, useful for connecting multiple workspaces |
| `actor` | `user` (default) or **`app`** |
| `code_challenge`, `code_challenge_method` | PKCE (`plain` or `S256`) |

### Scopes

| Scope | Grants |
|---|---|
| `read` | Default, always present |
| `write` | Write access for the user's account |
| `issues:create` | Create issues and their attachments |
| `comments:create` | Create issue comments |
| `timeSchedule:write` | Create/modify time schedules (on-call rotations) |
| `admin` | Full admin-level access — "never ask for this unless absolutely needed" |
| `app:assignable` | App can be set as a **delegate** on issues and a member of projects |
| `app:mentionable` | App can be @mentioned in issues, documents, and editor surfaces |
| `customer:read` / `customer:write` | Customer data |
| `initiative:read` / `initiative:write` | Initiative data |

`actor=app` installations **cannot** request `admin`.

## Token exchange

`POST https://api.linear.app/oauth/token`, body `application/x-www-form-urlencoded`.

Authorization-code grant: `code`, `redirect_uri`, `client_id`, `client_secret`, `grant_type=authorization_code`.
PKCE variant: same minus a required secret, plus `code_verifier`.

Response:
```json
{ "access_token": "...", "token_type": "Bearer", "expires_in": 86399,
  "scope": "read write", "refresh_token": "..." }
```
Access tokens are valid **24 hours**. (Apps created before 1 Dec 2023 receive `scope` as an array.) All OAuth apps were migrated onto the refresh-token system on 1 April 2026.

### Refresh
`grant_type=refresh_token` + `refresh_token`, authenticated either with HTTP Basic (`base64(client_id:client_secret)`) or by passing `client_id`/`client_secret` as parameters. PKCE-generated tokens need only `client_id`.

**Grace period:** a consumed refresh token can be replayed for **30 minutes** to recover the new token if the response was lost to a network error. Design for this — it removes a whole class of production incidents.

### Revoke
`POST https://api.linear.app/oauth/revoke` with the token in the `token` form field, optionally `token_type_hint` (`access_token` | `refresh_token`). Responses: `200` revoked, `400` unable (e.g. already revoked), `401` unable to authenticate. Legacy `Authorization` header and `access_token`/`refresh_token` fields are still accepted for compatibility but must not be mixed with `token`.

### Client credentials (server-to-server)
Must be explicitly enabled on the app. `grant_type=client_credentials` + `scope`, Basic or parameter auth.

- Produces an **`app` actor token** with access to all public teams, valid **30 days**, with **no refresh token** — refetch on 401.
- Team access is adjustable afterwards from the app details page.
- Up to **1,000 concurrent** client-credentials tokens, provided they all use the same scopes. Requesting different scopes **revokes all existing app tokens** and replaces them. If you first minted an app token via another grant type, you can't hold multiple app tokens in parallel.
- Rotating the client secret invalidates all client-credentials tokens.

## Actor modes

| Mode | Behaviour |
|---|---|
| `actor=user` (default) | Resources are created as the authorising user. Use when every user authenticates individually |
| `actor=app` | Resources are created as the **application**. Use for agents and service accounts. Supersedes the older `actor=application` |

`actor=app` specifics:
- Requires **admin permissions** to install (workspace-scoped install).
- Installation asks which **teams** the app can access; admins can change or revoke this later, and a `PermissionChange` webhook fires if subscribed.
- The token represents the app user and **can no longer act for the authenticating user** — a breaking change when converting an existing app. To do both, authenticate twice and store the tokens separately.
- Only **one token per app user** can exist at a time (except via client credentials).
- The app gets a **unique user ID per workspace**; fetch it with `query Me { viewer { id } }` and store it alongside the token.
- App users appear in @mention menus, assignment (delegate) menus, filters, and team management. They are **not billed**.

## Enterprise-managed authorisation (MCP)

For Okta customers: configure SAML for Linear, then enable **MCP enterprise managed authentication** on the Okta identity provider in Linear and supply the Okta **Issuer URI** for the authorization server (e.g. `https://your-org.okta.com/oauth2/default`). External MCP clients such as Claude can then authenticate users automatically under Okta-managed access policies. Note this path requires Okta's **OIN catalog app**, which currently needs a separate custom app for SCIM.

## Third-party app approvals (Enterprise)

When enabled, installation attempts by members become approval requests routed to workspace owners, with reasons captured on both request and denial. See `01-features/17-admin-security-permissions.md`.

## Requirements for a clone

- Authorization code + PKCE + refresh + revoke + client credentials.
- Fine-grained scopes as above, including the app-only `app:assignable` / `app:mentionable` pattern.
- **Actor abstraction in the data model from day one** — every mutation must be attributable to a user, an app user, or an integration, because webhooks, activity feeds, audit logs, insights, and filters all expose the actor.
- Per-installation team scoping, changeable post-install, with a permission-change event.
- App-user identity per workspace, non-billable, with name-collision handling.
- Admin approval workflow gate in front of installation.
