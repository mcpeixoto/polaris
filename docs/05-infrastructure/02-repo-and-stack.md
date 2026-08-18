# Repository layout and stack

## Monorepo

One repo, one deployable unit, matching the fleet's one-repo-per-product habit.

```
polaris/
├── app.sh                     # house standard entrypoint
├── docker-compose.yml         # all services (see 05-deployment.md)
├── Makefile                   # dev tasks: generate, test, lint, migrate
├── docs/                      # this scope
│
├── schema/
│   ├── schema.graphql         # ONE source of truth for the API
│   └── gqlgen.yml
│
├── services/                  # Go module: github.com/peixotolabs/polaris
│   ├── go.mod
│   ├── cmd/
│   │   ├── api/main.go        # the api service
│   │   ├── sync/main.go       # the sync service
│   │   ├── worker/main.go     # the worker service
│   │   └── polarisctl/main.go # admin CLI: backfill, reindex, replay, seed
│   ├── internal/
│   │   ├── domain/            # THE mutation layer — every write goes here
│   │   │   ├── issue/  project/  cycle/  team/  label/  comment/
│   │   │   ├── customer/  initiative/  view/  template/  sla/
│   │   │   └── events.go      # change_log emission, one place
│   │   ├── authz/             # visibility predicate + role checks (one impl)
│   │   ├── store/             # sqlc-generated queries + tx helpers
│   │   ├── graph/             # gqlgen resolvers -> domain calls only
│   │   ├── syncsrv/           # hub, sessions, delta assembly, backpressure
│   │   ├── jobs/              # asynq handlers + cron definitions
│   │   ├── integrations/      # github/ gitlab/ slack/ sentry/ jira/ ...
│   │   ├── oauth/             # authorize, token, refresh, revoke, PKCE
│   │   ├── webhookout/        # signing, delivery, retry, disable
│   │   ├── search/            # meili indexing + query
│   │   ├── files/             # S3 client, presigning, scanning
│   │   ├── mail/              # outbound relay, inbound parse
│   │   ├── ratelimit/         # request + complexity budgets
│   │   └── platform/          # config, logging, tracing, health, shutdown
│   └── migrations/            # golang-migrate, forward-only
│
├── web/                       # TypeScript, one bundle for web + desktop
│   ├── src/
│   │   ├── store/             # local-first store: IndexedDB, indexes, outbox
│   │   ├── sync/              # WS client, delta apply, rebase, bootstrap
│   │   ├── gql/               # generated types + typed documents
│   │   ├── views/  features/  components/  editor/
│   │   ├── platform/          # runtime shim: web vs electron capabilities
│   │   └── keys/              # keymap registry + command menu
│   └── vite.config.ts
│
├── desktop/                   # Electron shell only
│   ├── src/main/              # window, tray, badge, updater, protocol, deep links
│   ├── src/preload/           # contextBridge surface
│   └── electron-builder.yml
│
├── sdk/                       # published TS SDK, generated from schema.graphql
├── proxy/                     # NPM notes + custom-location config reference
└── scripts/                   # backup, restore-drill, reindex, release
```

## Go stack

| Concern | Choice | Why |
|---|---|---|
| GraphQL | **gqlgen** | Schema-first (matches "the schema is the contract"), typed resolvers, dataloader support, built-in complexity limiting — required by the API spec |
| DB access | **sqlc** + `pgx/v5` | Hand-written SQL, generated typed Go. The filter grammar produces dynamic SQL that an ORM fights you on |
| Dynamic filters | Small internal query builder over `pgx` | Linear's filter grammar (AND/OR groups, relation filters, `every`, comparators) compiles to SQL; keep it in one package with heavy tests |
| Migrations | **golang-migrate** | Forward-only, additive, deploy-compatible with the previous revision — rollback reverts code, not schema |
| Jobs + cron | **asynq** (Redis) | Retries, scheduling, dead-letter, a web UI, no extra infra |
| WebSocket | **nhooyr/websocket** (`coder/websocket`) | Context-aware, simple, no gorilla legacy quirks |
| Auth | Self-issued JWT (short) + opaque refresh in Postgres | Sessions must be individually revocable — the product exposes a session list |
| Config | envconfig struct, fail fast on missing | Matches fleet secret injection |
| Logging | `log/slog` JSON | Container logs are already capped and shipped |
| Metrics | `prometheus/client_golang` | `/metrics`, internal only |
| Tracing | OpenTelemetry, sampled | Off by default; on when chasing a latency regression |
| Testing | `testcontainers-go` + Postgres | Integration tests against real SQL, not mocks |

**Package rule:** `graph/` (resolvers), `syncsrv/`, `jobs/`, and `integrations/` may only call `domain/`. Only `domain/` calls `store/`. Enforce with an import-lint rule in CI — this is what keeps API parity honest.

## TypeScript stack

| Concern | Choice | Why |
|---|---|---|
| Framework | React 19 + Vite | Fast HMR, plain SPA, trivially wrapped by Electron |
| Local store | Custom over **IndexedDB** (`idb`) + in-memory indexes | The sync engine owns this; see `03-sync-engine.md` |
| State | Zustand-style stores fed by the local store | Views subscribe to query results, not to the network |
| Routing | React Router (hash-free), same routes in Electron | Deep links map 1:1 |
| Editor | **TipTap/ProseMirror** + **Yjs** for collaborative docs | Yjs only for documents and long descriptions; scalar fields use the delta protocol |
| Virtualisation | TanStack Virtual | Lists of 10k+ issues must stay at 60fps |
| GraphQL codegen | `graphql-codegen` from `schema/schema.graphql` | Types shared by app and SDK |
| Styling | CSS modules or Tailwind — pick one and never mix | Theme tokens must be swappable (custom themes are a feature) |
| Tests | Vitest + Playwright | Playwright drives both web and the Electron build |

## The one contract: `schema/schema.graphql`

```
schema/schema.graphql
   ├── gqlgen  ──> services/internal/graph/generated  (Go types + resolver stubs)
   ├── codegen ──> web/src/gql                        (TS types + documents)
   └── codegen ──> sdk/src/generated                  (published SDK)
```

CI fails if generated output is stale. One command regenerates everything:

```make
generate:
	cd services && go run github.com/99designs/gqlgen generate
	pnpm -C web codegen
	pnpm -C sdk codegen
	cd services && sqlc generate
```

**Consequence to accept:** adding a field is a schema change, not a resolver change. That friction is the mechanism that stops a private backdoor API from appearing.

## Build outputs

| Artifact | Produced by | Consumed by |
|---|---|---|
| `polaris-api`, `polaris-sync`, `polaris-worker` | Go static builds, `CGO_ENABLED=0` | Docker images, distroless base |
| `web/dist` | Vite | Baked into `web` nginx image **and** into the Electron app |
| `Polaris.dmg`, `Polaris Setup.exe` | electron-builder | GitHub Releases (auto-update feed) |
| `@polaris/sdk` | tsup | npm |

The **same `web/dist`** goes into both the nginx image and the Electron bundle, built once per release so the desktop app can never drift from the web app.

## Dockerfiles

Multi-stage, pinned digests, non-root 10001, distroless runtime:

```dockerfile
# services/Dockerfile (one image, three entrypoints)
FROM golang:1.24.4-alpine AS build
WORKDIR /src
COPY services/go.mod services/go.sum ./
RUN go mod download
COPY services/ ./
ARG GIT_SHA=unknown
RUN CGO_ENABLED=0 go build -trimpath \
      -ldflags "-s -w -X main.revision=${GIT_SHA}" \
      -o /out/api ./cmd/api && \
    CGO_ENABLED=0 go build -trimpath -o /out/sync ./cmd/sync && \
    CGO_ENABLED=0 go build -trimpath -o /out/worker ./cmd/worker && \
    CGO_ENABLED=0 go build -trimpath -o /out/polarisctl ./cmd/polarisctl

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/ /usr/local/bin/
USER 10001:10001
ENTRYPOINT ["/usr/local/bin/api"]
```

One image, three commands — `command: ["/usr/local/bin/sync"]` in compose selects the role. Halves build time and guarantees the three binaries share a revision.

## Local development

```bash
make dev     # docker compose -f compose.dev.yml up: postgres, redis, minio, meili
make api     # go run ./cmd/api with air-style reload
make web     # vite dev server, proxying /graphql and /sync to localhost
make desktop # electron pointing at the vite dev server
```

Dev compose **does** publish ports (it's not the VPS). Production compose never does.

Seed data matters more than usual here: a realistic workspace (3 teams, 2k issues, cycles, projects, labels) is the only way to catch list-virtualisation and sync-volume problems early. `polarisctl seed --scale=large`.

## Conventions worth writing down now

- **Timestamps** are `timestamptz`, always UTC, always ISO-8601 at the boundary.
- **IDs** are UUIDv7 (time-ordered → better index locality than v4, and the change log is time-ordered by nature).
- **Every entity carries** `created_at`, `updated_at`, `archived_at`, `workspace_id`.
- **Soft delete** (`deleted_at`) for anything with a 30-day recovery window; hard delete only via a purge job.
- **No `SELECT *`** in generated queries — column drift breaks sync payload shapes silently.
- **Errors** are typed domain errors mapped once to GraphQL extensions codes (`RATELIMITED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION`).
