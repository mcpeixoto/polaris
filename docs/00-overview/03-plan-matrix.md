# Plan / tier gating matrix

> **This describes Linear's plans**, as reference for what the market expects and where
> feature gating conventionally falls. **Polaris's own packaging** — AGPL core, commercial
> `ee/`, and the free/Pro/Enterprise cloud tiers — is in
> [`06-product-model/02-plans-and-packaging.md`](../06-product-model/02-plans-and-packaging.md).

Linear's current plans: **Free**, **Basic**, **Business**, **Enterprise**. Legacy plans (Standard, Plus) are being retired — all workspaces migrate at their first renewal after **1 Feb 2026**; Plus → Business by default, Standard → Basic by default.

Gating is not cosmetic. It threads through the data model (e.g. private teams, guests, initiative views), the permission model (owner role only exists on Enterprise), and the integration layer. **Build the entitlement check as a first-class service, not per-feature `if`s.**

## Feature availability

| Capability | Free | Basic | Business | Enterprise |
|---|:--:|:--:|:--:|:--:|
| Teams | 2 | 5 | ∞ | ∞ |
| Issues | 250 cap after cancellation† | ∞ | ∞ | ∞ |
| Issues, cycles, projects, initiatives (basic), views, docs, triage | ✔ | ✔ | ✔ | ✔ |
| Customer Requests — manual, from Slack | ✔ | ✔ | ✔ | ✔ |
| Customer Requests — from Asks | — | — | ✔ | ✔ |
| Customer Requests — from Intercom / Zendesk / Front | — | — | ✔ | ✔ |
| Customer Requests — from Salesforce Service Cloud | — | — | — | ✔ (add-on) |
| Pulse | ✔ | ✔ | ✔ | ✔ |
| Linear Agent (chat, comments, skills) | ✔ | ✔ | ✔ | ✔ |
| MCP server | ✔ | ✔ | ✔ | ✔ |
| Product Intelligence (tech preview) | ✔ | ✔ | ✔ | ✔ |
| Coding sessions | — | ✔ | ✔ | ✔ |
| Loops | — | — | ✔ | ✔ |
| Code Intelligence (beta) | — | — | ✔ | ✔ |
| PR review Guides (beta) | — | — | ✔ | ✔ |
| Triage Intelligence | — | — | ✔ | ✔ |
| Triage rules | — | — | ✔ | ✔ |
| Triage responsibility (+ PagerDuty/Opsgenie/Rootly/incident.io) | — | — | ✔ | ✔ |
| SLAs | — | — | ✔ | ✔ |
| Insights | — | — | ✔ | ✔ |
| Dashboards | — | — | — | ✔ |
| Initiative views | — | — | — | ✔ |
| Sub-initiatives | — | — | — | ✔ |
| Sub-teams | — | — | ✔ | ✔ |
| Multi-level sub-teams (up to 5) | — | — | — | ✔ |
| Private teams | — | — | ✔ | ✔ |
| Guests | — | — | ✔ | ✔ |
| Team owners role | — | — | ✔ | ✔ |
| Workspace Owner role (+ limited Admin) | — | — | — | ✔ |
| Private issue sharing (out of private teams) | — | — | — | ✔ |
| Releases | — | — | ✔ (≤15 pipelines) | ✔ (∞) |
| Support integrations (Intercom, Zendesk, Front) | — | — | ✔ | ✔ |
| Linear Asks (Slack + Email) | — | — | ✔ | ✔ |
| Advanced Asks: private Slack channels, per-channel config, auto-create on every message, multi-Slack-workspace, **web forms** | — | — | — | ✔ |
| Microsoft Teams integration | ✔ | ✔ | ✔ | ✔ (multi-tenant) |
| Multiple Slack workspaces | — | — | — | ✔ |
| GitHub Enterprise Cloud / Server | — | — | — | ✔ |
| Gong integration | — | — | — | ✔ |
| Salesforce integration | — | — | — | ✔ (paid add-on, per-seat licences) |
| Airbyte | — | — | — | ✔ |
| Google Sheets sync | ✔ | ✔ | ✔ | ✔ |
| SAML SSO | — | — | — | ✔ |
| SCIM provisioning + group push | — | — | — | ✔ |
| IP restrictions | — | — | — | ✔ |
| Login-method restrictions | — | — | ✔ | ✔ |
| Audit log (90 days, + SIEM streaming) | — | — | — | ✔ |
| Third-party app approvals | — | — | — | ✔ |
| HIPAA / BAA | — | — | — | ✔ |
| Workspace CSV export | Admin | Admin | Admin | **Owner only** |

† On cancellation nothing is deleted, but with >250 issues you can no longer create new ones, and all members become Admins (Free semantics).

## Role-gated actions (Enterprise owner vs admin)

On Enterprise, "Admin" is deliberately weaker than "Owner". Workspace owners can loosen some of these under Settings → Administration → Security → *Workspace restrictions* (🟨 = default-on for admins but restrictable; 🟣 = public teams + private teams they belong to only).

| Action | Owner | Admin |
|---|:--:|:--:|
| Change workspace name/icon, toggle workspace features | ✔ | ✖ |
| Delete workspace | ✔ | ✖ |
| Restrict workspace creation | ✔ | ✖ |
| Manage security settings | ✔ | ✖ |
| View audit log | ✔ | ✖ |
| Manage OAuth app approvals | ✔ | ✖ |
| Invite users | ✔ | 🟨 |
| Promote/demote member ↔ admin | ✔ | ✔ |
| Promote/demote admin ↔ owner | ✔ | ✖ |
| Create/delete teams; manage public teams | ✔ | ✔ |
| Manage private teams / triage rules | ✔ | 🟣 |
| Enable/disconnect integrations | ✔ | ✔ |
| Manage API settings, webhooks, OAuth apps | ✔ | 🟨 |
| Manage labels | ✔ | 🟨 |
| Manage project statuses, SLA, AI settings, customer requests | ✔ | ✔ |
| Billing | ✔ | ✖ |
| Workspace imports | ✔ | 🟨 |
| Workspace exports | ✔ | ✖ |

## Billing model to replicate

- Billed per **unsuspended user**, per workspace. Monthly or yearly (Enterprise: yearly only).
- Monthly: mid-month adds aren't charged until next month; mid-month removals aren't credited.
- Yearly: charge at upgrade for the current headcount, then automatic **pro-rated true-up invoices / credits** reconciled on the monthly anniversary of the annual start date. Invoices are never edited or cancelled once issued; credits roll to future invoices.
- Agents (app users) are **not** billable. SCIM-created users become billable only after first login.
- Guests are billed as regular members.
- VAT number capture; US sales tax applied by billing address in ~19 jurisdictions.
- Discount programs: Education (students 100% for a year, staff 75%; Basic/Business only, higher-ed only), Non-profit (75%, Basic/Business, with a long exclusion list), Startups (partner-affiliated, up to 6 months free Basic/Business).

## Usage-based billing: AI credits

Separate from seats. Prepaid, workspace-pooled, USD-denominated balance. Opt-in — no balance means the metered features simply aren't available.

- **Consumers:** coding sessions (Basic+), Loops (Business+). All other AI features are seat-included.
- Typical costs (Linear's published guidance): loop run without a coding session $0.07–0.20; small copy/styling coding session $0.50–1; small bug fix $3–5; complex work $5+.
- Top-ups: ad-hoc (min $10) or Automatic Reload (threshold + amount, min $50). Card only, may differ from the subscription card. Stripe-processed, separate invoice.
- Expiry: purchased funds expire **12 months** after purchase; promo balances have their own dates; unused balance rolls over across subscription cycles; expired balances are not refundable/transferable.
- Consumption order: promotional → support-issued → self-purchased; within each group, nearest expiry first. A single task can draw from multiple balances.
- Balance may go slightly negative under concurrency; the next top-up settles the deficit first.
- **Spend limits** at three independent levels — workspace, per-user (with per-user overrides), per-loop (with per-loop overrides) — each with daily/weekly/monthly reset cadence, a configurable reset hour/day/timezone, and cadence-change amount scaling ($10/day ↔ $300/month). Enforcement lags up to ~2 minutes and is checked at work start, so limits are approximate. Blocked coding sessions/loops do **not** auto-resume.
- Usage history retained 3 months; usage visible by feature and by user.
- Guests can be blocked from agent interaction (and therefore credit spend) via Security → Integrations & applications.
