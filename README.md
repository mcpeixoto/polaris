# Polaris

**Polaris** is a working name for a clone of [Linear](https://linear.app) — an issue tracker and product-development platform for software teams.

The repository contains two things: a **complete functional scope** — every feature Linear ships, how those features depend on each other, what the data model has to look like, what the integrations do, what the API surface is — and the **implementation of Milestone 0**, the slice that makes it a usable issue tracker.

## What runs today

The backend is complete and tested end to end; the web client's data layer is complete and the screens are in progress.

| Working | |
|---|---|
| Schema | 11 migrations, 16 tables, monthly-partitioned change log, UUIDv7 |
| Sync engine | Gapless per-workspace versions, NDJSON bootstrap, WebSocket hub, resume, revoke, backpressure |
| API | GraphQL over the whole domain, complexity-limited, one contract in `schema/schema.graphql` |
| Auth | Argon2id, rotating refresh tokens, HttpOnly cookies, invitations |
| Client store | IndexedDB replica, in-memory indexes, durable outbox, optimistic mutations |
| Keyboard | One registry; the command menu and help overlay are views over it |
| Deployment | Dockerfiles, self-contained compose + Caddy, `app.sh`, CI |

Measured, not asserted: filter/group/sort over **5,000 issues in 0.42 ms** against a 50 ms budget; a full workspace snapshot in **24 ms / 20 KB gzipped**; commit-to-delta under 100 ms locally.

```bash
make up          # postgres + valkey
make migrate
make seed        # a realistic workspace
make api         # and, in other terminals: make sync, make web
```

See [`docs/07-milestones/00-milestone-0.md`](docs/07-milestones/00-milestone-0.md) for the scope freeze and the fifteen acceptance tests that define done.

## Source of truth

Everything here was derived from Linear's public documentation, crawled and read in full on **2026-08-14**:

- `https://linear.app/docs` — 138 pages (all pages listed in `linear.app/sitemap.xml` under `/docs/`)
- `https://linear.app/developers` — the API/platform pages (GraphQL, pagination, filtering, rate limiting, webhooks, OAuth, agents, attachments, customers, SDK)

Where a behaviour is stated in the docs, it is recorded here as fact. Where the docs are silent and a design decision is required for a clone, it is marked **[INFERRED]** or **[OPEN]**. Nothing here was reverse-engineered from the running product, and no Linear source code, assets, or trademarks are included.

## How to read this

| Path | What's in it |
|---|---|
| [`docs/00-overview/`](docs/00-overview/) | Product shape, domain model (ERD), plan/tier gating matrix, glossary |
| [`docs/01-features/`](docs/01-features/) | One file per feature area — behaviour, config surface, edge cases, dependencies |
| [`docs/02-integrations/`](docs/02-integrations/) | The integration catalogue and per-integration contracts |
| [`docs/03-platform/`](docs/03-platform/) | GraphQL API, webhooks, OAuth + scopes, agent platform, rate limits |
| [`docs/04-scope/`](docs/04-scope/) | Feature inventory checklist, dependency graph, build phases, non-goals and risks |
| [`docs/05-infrastructure/`](docs/05-infrastructure/) | How it gets built and run: stack, repo layout, sync engine, data layer, deployment, Electron desktop, API/integration infra, security & ops, scaling & cost, self-host vs cloud |
| [`docs/06-product-model/`](docs/06-product-model/) | Licensing, packaging and running the open-source project |
| [`docs/07-milestones/`](docs/07-milestones/) | The scope freeze for each milestone and its acceptance tests |
| [`services/`](services/) | Go: GraphQL API, sync hub, worker, admin CLI |
| [`web/`](web/) | TypeScript: local-first store, sync client, keymap, UI |
| [`desktop/`](desktop/) | Electron shell — same bundle as the web app |

**Read order for someone new:** `00-overview/01-product-summary.md` → `00-overview/02-domain-model.md` → `04-scope/03-dependency-graph.md` → `04-scope/02-build-phases.md` → `05-infrastructure/01-architecture-overview.md`. Then dive into feature files as you pick up work.

## How it will be built

Decisions taken (see [`docs/05-infrastructure/`](docs/05-infrastructure/) for the reasoning):

- **Go** backend (`gqlgen` GraphQL + a WebSocket sync hub), **TypeScript/React** frontend
- **Custom delta sync over WebSocket** — local-first client store, optimistic mutations, offline outbox
- **Electron** desktop for Windows + macOS, loading the same bundle as the web app
- **Docker Compose**, with a reverse proxy terminating TLS in front of it and no published ports on any datastore — see [`docs/05-infrastructure/11-self-hosting.md`](docs/05-infrastructure/11-self-hosting.md), which is written to be followed on a machine that is not ours
- **One GraphQL API** serving web, desktop, the published SDK, agents, and every integration — no private backdoor API

## How it will be distributed

- **Open source on GitHub**: **AGPL-3.0** core, with enterprise features in `ee/` under a commercial licence (CLA required)
- **Self-host free and unlimited on seats** — the paid pitch is "you don't want to run it" plus SSO, SCIM, audit log and dashboards
- **Hosted cloud in the EU**, freemium: Free (≤5 users) → Pro (per seat) → Enterprise
- **Invite-only beta first** — no open signup until per-workspace quotas and abuse controls are proven
- Residency is EU-only for the cloud; self-hosters choose their own hardware

## The one-paragraph version

A **workspace** contains **teams**. A team owns **issues**, which move through the team's ordered **workflow statuses**. Issues carry properties (assignee, priority, labels, estimate, due date, SLA, relations, parent/sub-issues) and are grouped for delivery by **cycles** (time-boxed, per-team, auto-repeating) and for outcome by **projects** (cross-team, with milestones, updates, graphs). Projects roll up into **initiatives** (nestable, strategic). Everything is surfaced through **views** (filters + display options + layouts: list/board/timeline), analysed with **Insights** and **dashboards**, and fed by **intake** surfaces (Triage, Asks, support integrations, email, Slack, GitHub). Layered on top: a **real-time sync engine** with offline support, an **agent platform** (first-party and third-party agents, coding sessions), and a **GraphQL API + webhooks** that every integration is built on, including our own.

## Scale of the thing

Rough count of what a faithful clone has to ship:

- **~28 first-class entities** in the domain model
- **~35 distinct feature areas**
- **~20 first-party integrations** + a directory of 250+ third-party ones
- **4 pricing tiers** with feature gating woven through nearly every surface
- **5 clients** (web, macOS, Windows, iOS, Android) sharing one sync engine
- **1 public GraphQL API** that is the same API the product itself uses — this is an architectural constraint, not a bolt-on

See [`docs/04-scope/02-build-phases.md`](docs/04-scope/02-build-phases.md) for what a sane sequencing looks like, and [`docs/04-scope/04-risks-and-non-goals.md`](docs/04-scope/04-risks-and-non-goals.md) for the parts that are much harder than they look (the sync engine, the command menu, keyboard-first UX, and the perf budget that Linear's whole brand rests on).
