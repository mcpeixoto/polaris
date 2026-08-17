# Administration, security, permissions

**Depends on:** workspace, teams, users.
**Depended on by:** every feature (entitlement + authorisation checks).

## Roles

| Role | Scope | Notes |
|---|---|---|
| **Workspace Owner** | Enterprise only | Full administrative control: billing, security, audit log, workspace exports, OAuth app approvals, team access management |
| **Admin** | All paid plans | Routine workspace management. On Enterprise, deliberately weaker than Owner. On Free, **everyone** is an Admin. On Basic/Business, the user who upgrades becomes Admin |
| **Team Owner** | Business/Enterprise | Delegated per-team control |
| **Member** | All | Collaborates across accessible teams; no workspace administration pages |
| **Guest** | Business/Enterprise | Team-scoped; billed as a member |

See the per-action Owner vs Admin table in `00-overview/03-plan-matrix.md`.

### Team owners
- Workspace admins/owners are automatically team owners of every team they can access. The creator of a new team becomes a team owner. Parent-team owners are owners of sub-teams. Guests cannot be team owners. No limit on count; teams need not have one.
- **Team-owner-only operations**: delete a team, make a team private, change a team's parent.
- **Configurable per team** (all members vs team owners only): issue label management, template management, team settings management (workflow statuses, cycles, triage rules, agent guidance), member management (adding guests is *always* owner-only), agent skills management, loop management. **Not inherited** parent → sub-team, except that a parent's Member-management restriction sets a minimum for sub-teams.
- **Team access**: default is any workspace member may join a non-public... (non-private) team; owners can restrict to invite-only.

### Guests
- Can access issues, projects, and documents of the teams they're explicitly added to, and take the same actions as members **within** those teams.
- Cannot see workspace-wide features: workspace views, customer requests, initiatives, Pulse; cannot access settings beyond their own Account tab; cannot use Code Intelligence; cannot export issues.
- On a multi-team project, guests see the project shell but only the issues of teams they belong to.
- **Integration leakage warning** (documented, and a real design problem): workspace integrations are reachable by guests. For Linear-built integrations (GitHub, GitLab, Figma, Sentry, Intercom, Zapier, Airbyte) the mitigation is to keep guests off those third-party accounts. Email-authenticated integrations (Slack, Discord, Front, Zendesk) naturally restrict to invited teams — except Slack unfurls, which follow *channel* visibility and the workspace Unfurls setting, not the viewer's role.

### Member management
- Settings → Administration → Members: list active/suspended/pending/left users, filter by role or status, change roles, export CSV.
- **Suspend**: immediate loss of access, removed from the next billing cycle, remains visible for historical attribution. Their API tokens are revoked. Their issues are reachable via `linear.app/<workspace>/profiles/<username>`.
- Convert to guest also revokes API tokens.
- Any member can find admins via `Cmd/Ctrl+K` → *View workspace admins*, or `linear.app/settings/view-admins`.

## Invitations and joining

- Admins invite from Settings → Members → Invite: comma-separated emails, role, and teams to auto-join.
- On paid plans, admins can allow all users to invite (Security → *Allow users to send invites*). On Free everyone can invite.
- **Approved email domains** — anyone with a matching domain can join without an invite. Advice to surface: review regularly, and remove domains you no longer control.
- **Invite links** — persistent, reusable, resettable. **Unavailable when SAML or SCIM is enabled.**
- **Invite & assign** — invited users can be assigned issues and set as project leads before accepting.
- Deliverability: allowlist `notifications@linear.app` and `pm_bounces@pm-bounces.linear.app`.

## Authentication

| Method | Notes |
|---|---|
| Google | For Google-backed addresses |
| Email magic link / code | Link or 6-ish digit code |
| Passkey | WebAuthn; multiple devices registerable from Security & Access. **Not supported in the desktop app** |
| SAML SSO | Enterprise |

- **Restrict login methods** (Business+): Settings → Administration → Security. The highest role (owner, or admin depending on plan) can always use any method to avoid lockouts.
- **IP restrictions** (Enterprise): allow-list of IPs/CIDR ranges applied to web, desktop, and mobile access.
- Logging out of one session **logs out all sessions**. Inactive sessions expire after **30 days**.
- Account switching: multiple accounts (different emails) can be logged in simultaneously and switched without re-auth.

### SAML (Enterprise)
- Supports most IdPs (Okta, Entra ID, OneLogin, Google Workspace, LastPass, Auth0, …).
- Configure at Settings → Administration → Security → SAML & SCIM; paste an XML metadata URL or raw XML.
- Members on SAML-approved domains are required to use SAML; other domains can keep other methods (useful for contractors).
- **Domain claiming** via a DNS TXT record.
- **Multi-SAML**: several IdPs, each mapped to one or more domains.
- **Just-in-Time provisioning** on first SAML login: `Name` from `name`, else `firstName`+`lastName`, else `displayName`; `Email` from `NameID` (must be a valid email); `Avatar` from `avatarurl|photo|picture|profilepicture|profilephoto`; `Username` derived from name/email with a numeric suffix for uniqueness. **Profile fields are set only at creation** — later logins never overwrite them.
- **Disable new workspace creation** for your claimed domain, to prevent shadow workspaces.
- Guests invited directly may use email/other methods; guests provisioned through the IdP must use it.
- Okta specifics: a **custom SAML 2.0 app** is the recommended setup; the **OIN catalog app** is required for MCP enterprise-managed authentication but currently needs a separate custom app for SCIM.

### SCIM (Enterprise)
- SCIM **2.0** only. Enable alongside SAML; retrieve the SCIM base connector URL and Bearer token.
- Once enabled, admins can no longer manage users in Linear; a **temporary manual override** exists for suspending users (e.g. pre-SCIM leftovers).
- **Group push maps 1:1 to Linear teams.** Link an existing team either by importing teams into the IdP first, or by setting the team's **SCIM group mapping** field to the IdP group's display name. Once linked, membership is IdP-managed only.
  - Disconnecting with a delete request: removes all members and converts the team to private (issues untouched).
  - Disconnecting without delete: team unchanged; unlink manually from the team's Danger Zone to resume local management.
- **Role provisioning groups**: `linear-owners` (Enterprise), `linear-admins`, `linear-guests`. These groups do **not** create teams. They can be renamed in the IdP after the first push. While linked, roles can't be edited manually.
- **Sync fields** — Users: email (`userName`, primary identifier, domain must be claimed), full name (`givenName`+`familyName` → `formatted` → `displayName`), username (from `displayName`, uniquified), `active` (suspend/unsuspend), avatar (`avatarUrl` or `photos[].value`). Teams: `displayName` (uniquified with a suffix), `members`.
- **Default teams** for SCIM-provisioned users are configurable in Settings → Security → SAML & SCIM (separate from group push).
- SCIM users become **billable only after first login**.
- Disabling SCIM rejects further IdP requests, unlinks group-linked teams, and drops SCIM restrictions; re-enabling requires re-pushing everything.
- **Enterprise upgrade migration**: an existing `linear-admins` group starts controlling **owners** after the upgrade. To manage admins as well, either rename the group to `linear-owners` and create a new `linear-admins` (requires IdP group-name syncing, e.g. Okta's "Rename app groups…"), or create `linear-owners`, unlink the old group, redistribute users, and push both. A user in both groups gets **owner**.

## Workspace restrictions (Enterprise-tunable)

Owners can decide which roles may: create top-level teams, invite members, manage labels, manage templates, manage automations, install integrations, administer the API and create personal API keys, run imports, and manage workspace-level agent guidance. Authentication and security policy (SSO, SCIM, permitted login methods, domain controls, IP restrictions) apply workspace-wide with **no team-level override**.

## Third-party app approvals (Enterprise)

Owner enables it in Security. When a member tries to install a third-party app, they get a request screen with an optional justification; previously-denied apps show the denial reason. Owners receive email + in-app notification with a link to the applications page; the requester is notified of the outcome, with an optional reason on denial. Approved/denied apps are listed under Applications.

## API and webhook governance

- Admins choose whether **members** can create personal API keys (Settings → Administration → API → Member API keys). Admins always can. Existing keys are listed and revocable.
- Personal API keys (Settings → Account → Security & Access) can be scoped: **Read, Write, Admin, Create issues, Create comments**, and limited to **specific teams**.
- Webhooks and OAuth applications are managed in Settings → Administration → API; creating/reading webhooks requires admin (or the `admin` OAuth scope).

## Personal Security & Access page

Sessions (with location, last seen, IP, sign-in date; revoke individually or all others), passkeys, personal API keys, authorised OAuth applications (with granted permissions and revoke).

## Audit log (Enterprise)

- **Owner-only.** Settings → Administration → Audit Log. Tracks account access, subscription, and settings changes with actor, IP, and country. **90-day retention.**
- UI: browse recent events, filter by type, optionally hide session-creation noise.
- API: `auditEntries(filter: …)` supports actor, email, IP, date-range filtering, plus `auditEntryTypes` to enumerate types.
- **Stream logs** to a webhook for SIEM ingestion, secured with a signing secret. Payloads carry `action`, `actor` (id/name/email/avatar/type), `createdAt`, `data` (with `type`, `metadata`, `ip`, `requestInformation` incl. userAgent/authMethod/authService), `organizationId`, `webhookTimestamp`, `webhookId`.
- Workspace CSV exports are themselves recorded in the audit log.

## Compliance and data handling

- **GDPR, SOC 2 Type II, HIPAA** (BAA on Enterprise). Other documents via the Trust Center.
- Shared responsibility model: Linear secures the application, platform, and cloud infrastructure; customers are responsible for workspace security configuration, what data they store and retain, API keys and integrations, and monitoring their audit log.
- Encryption in transit and at rest.
- **Data regions**: US or EU, selected at workspace creation, not self-serve changeable. Always US: workspace/user account records and API keys, notification emails at the sending partner for 7 days, usage analytics, sanitised analytics data (with issue titles/descriptions, comments, project/team names, document and initiative content removed), and account info attached to crash reports.
- Vulnerability disclosure process published separately.

## Terms/AI addendum (context for product and legal copy)

Linear's June 2026 terms update introduced mutual indemnification, mutual liability caps with carve-outs (gross negligence, wilful misconduct, fraud, indemnities, use-restriction breaches), and an **AI Services Addendum** defining metered AI services, credits as a USD-denominated workspace-pooled unit, no training on customer data, contractual bans on provider training, zero-data-retention where supported, and model substitution rights.
