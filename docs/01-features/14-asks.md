# Linear Asks (internal request intake)

**Depends on:** issues, triage, templates, Slack integration, email infrastructure, SAML (web forms), customer requests.
**Plan:** Business (Slack + Email). **Enterprise** adds *Advanced Asks*: web forms, private Slack channels, per-channel configuration, auto-create on every message, multiple Slack workspaces.

Turns internal requests (bug reports, IT/HR/ops asks, questions, feature requests) into issues — **from people who don't have Linear accounts**. Every Ask becomes an issue that lands in the target team's **Triage**, and keeps a **synced conversation** with the requester.

Three intake surfaces: **Slack**, **Email**, **Web forms**.

---

## Shared concepts

- **Shared workflow** — regardless of surface, the result is a normal Linear issue and the team's normal triage/prioritise/assign flow.
- **Synced conversations** — the requester's channel (Slack thread / email thread) stays bound to the issue's comment thread bidirectionally.
- **Templates** — Asks is template-driven; templates apply default properties and can collect structured fields. **Workspace-level templates are not available to Asks** — use team templates.

---

## Asks with Slack

### Setup
1. Settings → Features → Asks → `+` under Slack intake → authenticate a Slack workspace.
2. Connect Linear teams to **Private Asks** and/or **All public Slack channels** (⋯ → Add teams to channel).
3. In Slack, invite the app to each channel: `/invite @Linear Asks`.
4. Attach templates per channel/team (⋯ next to the team → select templates).

Enterprise adds **per-channel configuration** (Add channel → pick Slack workspace → pick channel → Allow), which is also the only way to support **private Slack channels**.

### Permissions and visibility
- Workspace Admins/Owners choose whether Asks channels, teams, and templates are managed by admins only or all users.
- Control whether Slack users **without** Linear accounts can update issue status and priority from Slack.
- If Customer Requests are on, a **customer field** can appear; because it exposes customer data, its visibility is restricted to one of: Linear users only, all Slack workspace members, or Slack members and guests when it's part of a template. Slack Connect external users never see it.

### Creating an Ask
| Method | Notes |
|---|---|
| 🎫 emoji reaction | Default on, disable-able. Starting a message with 🎫 also triggers it. Bot messages work if 🎫 is the first character |
| `/Asks` slash command | — |
| Message overflow menu | — |
| DM with Linear Asks / the Asks app home | Creates a **Private Ask** |
| `@Linear Asks` mention | Conversational flow; picks the best-matching template from context and **prompts for missing required fields** before creating |
| Auto-create on every new message | Enterprise, single-channel config, public channels only. Exempt a message by starting it with 📢 or 📣 |

If multiple templates are configured for a channel, Linear picks the best match from the message context. A **default template** (hover → Set as default) is used for auto-created Asks — the requester's message replaces the template description. Channels whose default template has required fields cannot use auto-creation. Default templates don't apply to the `@Linear Asks` agent.

"Create Asks without a template" can stay enabled to allow untemplated submissions (useful if you only want to set a default team).

### Private Asks
For requests that should stay between requester and handling team. Covers DMs and the Asks app home. DMs don't need channel configuration. **Connect only private Linear teams to Private Asks**, otherwise the content is visible workspace-wide.

### Synced threads and requester experience
- Slack thread replies → issue comments; comments in the synced Linear thread → Slack thread. Files cross both ways.
- Linear Asks posts a threaded reply with a link to the issue on creation.
- Requesters can: see status and assignee, reply in thread, get updates on key status changes (leaving Triage, reaching a terminal status) per the channel's notification settings, mark an Ask **urgent** (adds a 🚨 reaction), and close their own Ask by changing status.
- The Asks **app home** in Slack lists their active and closed Asks with real-time status/assignee and links back to the original thread. The Messages tab shows Asks and threads including private ones.
- Users with Linear accounts get Slack quick actions (change status, self-assign).

### Slack Connect / shared channels
External users can create Asks via 🎫 or `@Linear Asks` (if enabled). Other creation methods aren't available to them. With auto-create-on-message enabled, both internal and external messages create Asks. External users may be able to interact with the Ask unfurl (including marking urgent) if external actions are enabled.

### Known limitations to reproduce or fix
- Asks in private-team issues **don't unfurl** in Slack.
- Slack may show a different Asks icon per distinct Linear responder in a thread.
- Bots can't be added to an existing multi-person DM — Asks only works in a group DM if the bot was there from the start (Enterprise workaround: convert to a private channel and configure it).
- Enterprise Grid multi-workspace channels need the channel added under each connected Slack workspace, with aligned auto-create settings.
- Install order matters: if Asks was installed **before** the regular Slack integration, unfurls break for the Slack integration and both must be disconnected and reinstalled in the right order.
- API: link an existing Slack thread to an issue with `syncToCommentThread: true` on the `attachmentLinkSlack` mutation.

---

## Asks with Email

Each incoming email creates an issue: **subject → title, body → description**. Requesters need neither Slack nor a Linear account.

### Setup
1. Settings → Asks → `+ Add Asks intake email`.
2. Choose the Linear **team** and, optionally, an issue **template** — **standard templates only**; form templates are incompatible.
3. Copy the unique Linear-generated forwarding address.
4. Configure forwarding from your custom address (e.g. `helpdesk@yourcompany.com`) to it.
5. Optionally configure **outbound** DNS records so replies come from your own domain instead of `issues@linear.app`.

Permissions: admins add/edit/delete intake emails; members can change the team/template/sync-reply/customer-request settings on an existing address.

### Forwarding guidance
- **Google Workspace**: admin required; Google Groups are explicitly discouraged (header rewriting breaks things). Per-account Gmail forwarding also works without admin rights, using Gmail's confirmation-code flow.
- **Microsoft 365**: shared mailbox or user mailbox forwarding, *and* automatic forwarding must be allowed in the outbound anti-spam policy (Defender) — otherwise `550 5.7.520 Access denied`. Fix via Exchange Admin → Mail Flow → Remote Domains → Allow automatic forwarding, or Defender → Anti-spam → Outbound policy → Automatic forwarding rules → On.

### DMARC requirements (for replying from your own domain)
Relaxed alignment is required: `aspf=r`, `adkim=r`. Strict (`aspf=s`/`adkim=s`) is unsupported. Recommended starting policy `v=DMARC1;p=none`; `p=quarantine` and `p=reject` are supported as long as alignment stays relaxed.

### Behaviour
- A **synced thread** appears on the issue: email replies become comments; comments become emails. Quoted reply history is stripped for readability.
- **Auto-replies** on issue created / completed / canceled, each individually toggleable with customisable copy.
- **Customer requests** can be enabled so inbound email is matched to a customer by sender domain.
- Explicitly *not* a support desk: no first-response-time metrics, no NPS, and none planned.

---

## Asks Web Forms (Enterprise)

A hosted forms site, gated by **SAML**, for employees to submit requests.

### How it works
Top-level Asks URL → pages (usually per team or topic) → forms (each form = a template) → submit → issue created → email acknowledgement → replies sync both ways with the issue thread.

### Setup
1. Settings → Asks → `+` next to **Web** (workspace owners only).
2. Choose hosting: **Linear-hosted domain** (simpler) or **custom domain**.
3. Custom domain only: set the outgoing email address, add the DNS records (verification up to **48 hours**), and configure email forwarding for replies.
4. **SAML**: create a **separate SAML app** — the workspace sign-in SAML app cannot be reused because the ACS/redirect URLs differ. Copy Linear's metadata into the IdP (or import the metadata file), then paste the IdP's metadata URL/XML back into Linear. Terminology map Linear publishes: Callback URL = ACS URL (Google) = Single sign-on URL (Okta); Audience URL = Entity ID = Audience URI; Start URL; Name ID format.
   *Switching between Linear-hosted and custom domains later requires updating the SAML app because the redirect URLs change.*
5. **Add pages**: name, description, URL, which templates appear, optional per-page customisation of the reply email format.
6. **Add templates**: standard or form templates; a template must be attached to a page to appear on the site. Fields: Text, Long text, Dropdown, Checkboxes, Date, File upload, Instructions, plus customer, label group, priority, title, due date.

---

## Asks vs the regular Slack integration

Linear draws the line explicitly: `@Linear` (Slack integration) is for people **with** Linear accounts; `@Linear Asks` is for structured intake from people **without** them, with channel-scoped destinations and templates. Not every Ask flow is powered by the `@Linear Asks` agent — emoji and auto-create paths use different workflows.
