# Plans and packaging

> `00-overview/03-plan-matrix.md` describes **Linear's** tiers, as reference. **This** file defines ours.

## Two ways to get Polaris

| Channel | Licence | Who runs it | Cost |
|---|---|---|---|
| **Self-host** | AGPL-3.0 core | You | Free, unlimited seats |
| **Cloud** (EU) | We run core + `ee/` | Us | Free / Pro / Enterprise, per seat |

There was a third — self-host Enterprise, sold as an annual licence key — and it is not one.
No licence-key code exists: no `license` package, nothing that verifies a key, nothing that
counts seats against one. `01-licensing-and-distribution.md` keeps the design under a heading
that says it was never built. Until it is, `ee/` reaches a customer through the cloud and
nowhere else, and nobody should be sold otherwise.

The self-host tier being *genuinely unlimited on seats* is the point. Anyone who wants to run it for 300 people without paying may do so — that's what makes it open source rather than a demo. The paid pitch is "you don't want to run it" and "you need SSO and an audit log".

## Core vs Enterprise

The split follows one principle: **anything a small team needs to work safely is core; anything only a compliance department asks for is enterprise.**

### Core (AGPL, free, self-host or cloud)

Issues, statuses, labels, estimates, due dates, relations, sub-issues, templates, recurring issues · Teams, sub-teams, **private teams**, guests · Cycles + graphs + capacity · Projects, milestones, updates, graphs, dependencies · Initiatives (incl. sub-initiatives) · Documents, comments, threads, reactions · Views, filters, board/list/timeline, display options, favorites, peek · Search · Triage + triage rules · SLAs · **Basic Insights** · Customers + customer requests · My Issues, Inbox, notifications, Pulse · Releases · GraphQL API, webhooks, OAuth, personal API keys, SDK, MCP server · GitHub, GitLab, Slack, Discord, Sentry, Figma, Notion, Zapier, Google Sheets, email intake · Importers · Desktop apps · Agent platform (BYO model keys)

Deliberately **not** gated, against the instinct to gate them:

| Feature | Why it stays free |
|---|---|
| **Private teams** | Gating a *security boundary* is user-hostile. A five-person company with an HR team needs this |
| **Guests** | Same reasoning — access control is not a luxury. A guest does **not** consume a paid seat: `role = 'guest'` is excluded from `CountWorkspaceSeats`. (Linear bills guests as members — `00-overview/03-plan-matrix.md:99` describes *their* packaging, not ours) |
| **API + webhooks** | Gating the API kills the integration ecosystem that makes the project worth adopting |
| **Triage rules, SLAs** | Cheap to run, and they're what makes the tool usable for support-adjacent teams |
| **Basic Insights** | A chart on a view is table stakes in 2026 |

### Enterprise (`ee/`, cloud Enterprise)

| Feature | Why it's the right thing to charge for |
|---|---|
| **SAML SSO** | Only orgs with an IdP want it; universally budgeted |
| **SCIM provisioning + group push** | Same buyer, same budget line |
| **Audit log** (90 days + SIEM streaming) | Compliance requirement, not a productivity feature |
| **Dashboards** (multi-insight, cross-team) | Leadership reporting; genuine build cost |
| **Advanced Asks** (web forms, private channels, per-channel config, multi-workspace) | Large-org intake |
| **Third-party app approvals** | Only meaningful with a security team |
| **Workspace Owner role + granular workspace restrictions** | Only meaningful past ~50 people |
| **Data residency / BAA / DPA support, priority SLA** | Procurement, not code |

That list is short on purpose. Every feature moved into `ee/` is one that self-hosters can't fix bugs in, and the goodwill cost compounds.

## Cloud pricing

| | **Free** | **Pro** | **Enterprise** |
|---|---|---|---|
| Users | ≤ 5 | unlimited | unlimited |
| Teams | 2 | unlimited | unlimited |
| Issues | no cap enforced | unlimited | unlimited |
| File storage | — | — | — |
| History | 90 days activity | full | full |
| Core features | all | all | all |
| Enterprise features | — | — | ✔ |
| API rate limit | the same for everybody | the same for everybody | raised on request |
| Support | community | email | SLA + shared channel |
| Price | €0 | **€4/user/mo**, €3.20 paid annually | **Contact us** |

What the server actually enforces is seats, teams and history days — `services/internal/entitlement/entitlement.go` holds the matrix, and `plans.test.ts` fails if this page and that file disagree about the Free caps. The issue cap and the per-plan API rate limit are packaging intent that nothing implements yet; they are written above as what a customer would be told, so either build them or drop them from the table, but do not sell them.

File storage has no row to fill in: the product has no upload path. An attachment is a URL and a link card, capped at 2,048 characters (`services/internal/domain/attachment.go`), so there are no bytes to meter and `plans.ts` advertises no storage figure at all. Put one back the day object storage exists, and not before — a quota nobody can hit is a promise about a feature that is not there.

Those are the shipped numbers — `web/src/features/pricing/plans.ts` is the one place they live, and `/pricing` and every paywall read them from there. Change the price there, not here.

Benchmarks, for context on where that sits: Linear $8–14, Jira ~$8, Height $6.99, Shortcut $8.50, Plane (OSS, comparable model) $8. €4 is well under all of them, which is a deliberate opening position and not a permanent one; being open source and EU-hosted is the argument that has to carry the price when it moves. Enterprise is quoted rather than listed because what it sells — residency, a DPA, an SLA, a shared channel — is negotiated per customer, so a number on the page would be fiction.

Free-tier caps exist to bound *your* cost, not to frustrate. 5 users × 1,000 issues is a real team doing real work — enough that they'd feel the loss on leaving, small enough that a thousand of them fit on one VPS.

**Discounts** worth carrying over: students/education free, registered non-profits 75% off, early-stage startups 6 months free. They cost little and buy goodwill.

## AI features and credits

Metered AI (agent, coding sessions, loops) follows the model already specced in `00-overview/03-plan-matrix.md`, with one open-source-specific rule:

- **Self-host: bring your own key.** Configure an OpenAI/Anthropic/OpenRouter key; Polaris makes the calls, you pay your provider directly. No credit system, no gatekeeping — the standard OSS arrangement.
- **Cloud: prepaid credits** (pooled per workspace, USD-denominated, expiry, spend limits, order-of-consumption) exactly as specced. Cloud Free gets a small one-time grant, no top-ups.
- AI features are **core**, not `ee/`. The infrastructure to run them is what's paid for.

## Entitlement model (implementation)

One service, three inputs:

```go
type Entitlement struct {
    Edition   Edition   // core | enterprise
    Source    Source    // oss | license_key | cloud_plan
    Plan      Plan      // free | pro | enterprise
    Seats     int
    Features  set.Set[Feature]
    Limits    Limits    // teams, issues, storage, api rate, history days
    ExpiresAt *time.Time
    GraceEnds *time.Time
}

func (e Entitlement) Can(f Feature) bool
func (e Entitlement) Within(l LimitKind, n int) LimitVerdict // ok | warn | block
```

Rules:
1. **One check point.** Resolvers, jobs, and the sync layer all call `Can`/`Within`. Never scatter `if plan == "pro"`.
2. **Self-host core** returns an entitlement with every core feature and **no limits**. Unlimited means unlimited — no seat counting, no nag banner, no telemetry-driven upsell. This is the difference between an open-source project and a trial.
3. **Limits degrade gracefully.** Over the issue cap: existing issues stay fully usable, creation is blocked with a clear message (matching the 60k-per-team behaviour already specced). Never hide data.
4. **Feature absence is honest.** In core builds, enterprise features aren't disabled toggles — they're absent, with a documentation link where they'd appear.

## Cloud-only machinery this adds

Not needed for self-host, needed before the first paying customer:

| Thing | Notes |
|---|---|
| ~~Waitlist + manual approval~~ | **Not built and not wanted.** The cloud runs `POLARIS_REGISTRATION_MODE=open`: anybody can sign up, and a new workspace mints on the Free plan. A self-hosted install still defaults to invite-only — that is the operator's box, not ours |
| **Billing** | Stripe: subscriptions, per-seat proration, invoices, VAT/OSS handling for EU B2B, dunning on failed payment |
| **Seat counting** | Active human members, excluding guests and app users, reconciled against Stripe. One query — `CountWorkspaceSeats` — mirrored client-side in `web/src/features/admin/entitlements.ts` |
| **Plan writes** | `workspace.plan`, `seat_limit`, `plan_expires_at`, `plan_lapsed_at` are written only by `services/internal/domain/billing.go`. No GraphQL input carries a plan: a workspace that can upgrade itself with a mutation is a paywall with a public bypass |
| **Dunning / lapse** | `subscription.status = 'past_due'` for longer than `domain.PlanLapseGrace` (7 days past `current_period_end`) sets `plan_lapsed_at`; recovery clears it. Reads never stop working — only gated writes narrow to the Free matrix |
| **Quota enforcement** | Seats, teams and history days are enforced today. Per-workspace issue and API counters are not built. There is no storage counter because there is no object storage: attachments are link cards (`services/internal/domain/attachment.go`), so nothing a workspace does puts bytes on our disk |
| **Abuse controls** | Email verification, per-IP signup caps, disposable-domain blocklist, outbound-email rate caps, attachment scanning |
| **Trial → paid flow** | 14-day Pro trial on request, no card |
| **Cancellation** | Never delete. Read-only over the free caps, with a full export always available — this is also a GDPR requirement |
| **Status page + incident comms** | Off-box |

## VAT and invoicing (EU reality)

Selling B2B SaaS from Portugal to the EU means: reverse-charge for VAT-registered EU businesses (validate VIES numbers), Portuguese VAT for local consumers, OSS scheme registration for consumer sales elsewhere in the EU, and invoices that satisfy AT requirements. Stripe Tax handles most of it; the invoice-numbering and archival rules are still yours. Talk to an accountant before the first euro, not after. **[OPEN]**

## GDPR (required, EU-hosted, freemium)

- **Controller/processor**: you're the processor for workspace content, controller for account data. Publish a DPA.
- **Subprocessor list**, public and versioned: VPS provider, SMTP relay, Stripe, error tracking, AI providers.
- **Data export**: already a product feature (CSV + API). Also needs an account-level export.
- **Deletion**: the 48-hour workspace-deletion window, then a real purge across every table, object storage, search index, and backups-on-expiry. Write this job early; it is not a Friday task.
- **Privacy policy + cookie posture**: first-party session cookies only, no third-party analytics on the app itself. If you want product analytics, self-host Plausible/PostHog in the EU.
- **Records of processing** and a breach-notification runbook (72 hours).

## Open questions

1. **Price points** — €4 Pro shipped, and it is an opening position rather than a settled one. Enterprise is quoted, not listed.
2. **Trademark clearance** on "Polaris".
3. **Where Insights stops being "basic"** — the line between core Insights and Enterprise Dashboards needs a concrete definition before either is built.
4. **Support boundary** — what a Pro customer gets vs a self-hoster filing a GitHub issue. Write it down before the first angry thread.
5. **Fair-use ceiling on Pro** — "unlimited" needs a documented abuse limit, or one workspace with 4 million issues becomes everyone's problem.
