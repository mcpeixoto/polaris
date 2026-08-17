# Risks, hard parts, and non-goals

## The parts that are much harder than the feature list suggests

### 1. The sync engine (XL, and the whole product's reputation)
Local-first store, optimistic mutations, real-time fan-out to every client, an offline queue with retry, and a "Syncing N" affordance. Linear openly documents that its offline mode does **not** compare change timestamps, so heavy offline editing can clobber a teammate — meaning even the shipped product accepts a correctness compromise here. Decide your conflict policy deliberately (LWW? CRDT for text, LWW for scalars? server-authoritative with rebase?) and write it down, because every feature inherits it.

Second-order effects: archived data is deliberately *not* cached client-side; search must work over data the client doesn't hold; every list view is rendered from the local store, so schema changes are client migrations.

### 2. The editor (XL)
Markdown-equivalent rich text with collaborative editing, presence, version history with restore, inline resolvable comments, mermaid, tables, embeds, file upload, mentions that create relations, placeholder formatting for templates, and AI-authored text highlighting. It is used in issues, comments, documents, project descriptions, updates, templates, and guidance fields — so it must be embeddable in a dozen contexts with different toolbars and permissions.

### 3. Insights (XL)
Computed **live** over the current view's filter set — six measures including duration-based scatterplots and burn-up/cumulative-flow, with slices and segments, percentile interactions, drill-through filtering, CSV export, and archived-inclusion. This is an analytics engine over an OLTP store with per-user permission filtering. It is the single most likely thing to force a read-model/warehouse split.

### 4. Keyboard-first UX and the command menu (L, and unglamorous)
Dozens of shortcuts, contextual command resolution, scoped prefixes, peek preview integrated into navigation, and the guarantee that every action is reachable both by mouse and keyboard. Getting this wrong is invisible in a demo and fatal in daily use — it's the thing Linear's users actually love.

### 5. Perceived performance
Linear treats slowness as a bug class with a formal reporting flow (screen recording + Chrome performance profile + consent to inspect obfuscated data). A clone that's 200 ms slower per interaction is not a clone. Budget: instrumented interaction latency targets, a regression suite, and someone who owns it.

### 6. The AI subsystem (multiple XLs)
Agent core with permission-scoped context assembly; sandboxed coding sessions with multi-runtime dependency installation, browser automation, and artifact capture; a permission-aware code index; loops with a seven-dimension permission matrix, versioning, and run history; Triage Intelligence with a workspace-wide semantic index and 1–4 minute latency budget. Plus metered billing, spend limits with approximate enforcement, and a documented privacy posture (no training on customer data; ZDR where supported).

### 7. Enterprise identity (L each, high support burden)
SAML with multi-IdP mapping, JIT provisioning field precedence, domain claiming by DNS TXT; SCIM 2.0 with group push mapping 1:1 to teams, three role groups, uniquification rules, disconnect semantics, and a documented migration path when a workspace upgrades to Enterprise and `linear-admins` silently starts controlling *owners*. Every one of these has a "what happens if a customer does it wrong" branch.

### 8. Integration surface area (≈20 first-party)
Each is small individually and large collectively — plus each has a permission story, a private-team story, a failure/reconnect story, and a support burden. Note how much of Linear's documentation is integration troubleshooting; that's the real cost.

---

## Product risks

| Risk | Note |
|---|---|
| **Opinionated defaults are the product** | Fixed priority scale, no custom fields, shallow hierarchy, no WIP limits, no manual archiving, single project per issue. Copy them and inherit the complaints; "fix" them and you're building something else. Decide consciously per item |
| **Scope creep into a platform** | Linear started as an issue tracker and grew into planning + support + code review + release management + an agent platform. Its own docs show the seams (e.g. `view-demos` is unfinished filler; `ai-at-linear` has literal `tbd` answers). Pick where you stop |
| **Feature gating drives the pricing model** | Private teams, guests, insights, SLAs, initiatives-at-depth and SSO are the paid tiers. Get the entitlement boundaries right early or repricing becomes a migration |
| **The 60k issues/team limit** | A performance concession, not a product choice. Your architecture will have an equivalent ceiling; find it before customers do |
| **Migration is the sales motion** | Jira/GitHub importers with ID matching and post-import sync are how customers switch. Under-investing here caps adoption regardless of product quality |
| **AI cost exposure** | Metered features can lose money per customer. Spend limits are approximate (up to ~2 min enforcement lag, parallel work can overshoot), and balances can go negative |

## Legal and ethical constraints

- Do **not** copy Linear's trademarks, logo, brand assets, marketing copy, or documentation text. This scope describes *functionality*, which is not itself protectable, but the expression is.
- Do not scrape or reuse Linear's application code, and don't reuse their published copy verbatim in your product UI.
- Their published domain names, IP ranges, and endpoints appear here only to document how *their* integrations work — a clone needs its own.
- Any migration tooling you build ("import from Linear") must use their public API within their terms and rate limits.

## Explicit non-goals (things Linear deliberately does not do)

Inherit these unless you have a reason not to — each is a documented decision, and reversing one usually costs more than it looks:

| Non-goal | Linear's position |
|---|---|
| Custom priorities / more granular priority | "Easy to get carried away"; use statuses or labels |
| Custom fields | Not supported; not imported from Jira |
| WIP limits on boards | Contradicts their philosophy of removing friction |
| Manual archiving | Archival is automatic only |
| Multiple project leads | One lead keeps ownership clear |
| Issues in multiple projects | One project per issue; use sub-issues |
| Milestones shared across projects | Recreate per project |
| Board as a workspace-wide default layout | Per-view default only |
| Per-commit code review | PR-level only |
| Linux desktop client | Browser only, not on the roadmap |
| REST API | GraphQL only — acknowledged as painful for bulk import |
| Notification archiving | Not supported |
| Choosing what enters the Inbox | Everything lands there; other channels link back |
| Cross-team cycle views | Cycles are team-scoped; align via sub-teams |
| Asks as a customer support desk | No first-response metrics, no NPS, "not planned" |
| GitLab issue import/sync | Only the CSV/CLI path |
| Multiple Slack/GitLab/Sentry orgs per workspace | One each (Slack multi-workspace is Enterprise-only) |
| Self-hosted Sentry | Cloud only |
| Two-way Notion workflow | Preview only |

## Open decisions for this project

1. **Do we ship data residency (US/EU)?** Decide in Phase 0 — it's a migration project later.
2. **Do we ship a REST API and a bulk-import endpoint?** Linear's absence of these is a documented pain point and a cheap differentiator.
3. **Do we allow custom fields?** The single biggest "why we didn't switch to Linear" objection. Also the fastest route to becoming Jira.
4. **Conflict-resolution policy** for offline edits — match Linear's LWW compromise, or do better?
5. **Multiple workspaces per account** from day one, or single-workspace accounts?
6. **How much of the AI layer is in scope at all?** It's ~6 XL items and a metered billing system. A credible clone can ship without it; a competitive one probably can't for long.
7. **Which integrations are launch-blocking?** Realistically GitHub + Slack. Everything else is expansion.
8. **Mobile: native or not?** Two XL items. A PWA covers Linear's own documented mobile use cases (Inbox triage, quick create, search) at a fraction of the cost.
