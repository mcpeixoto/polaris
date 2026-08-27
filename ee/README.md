# Enterprise edition

Commercially licensed features. Everything here is excluded from the AGPL core — see
[`LICENSE`](LICENSE) and [`../docs/06-product-model/01-licensing-and-distribution.md`](../docs/06-product-model/01-licensing-and-distribution.md).

## What belongs here

Only these, and the list is deliberately short:

- SAML SSO and SCIM provisioning
- The audit log and its SIEM streaming
- Dashboards
- Advanced Asks (private channels, web forms, multi-workspace)
- Third-party application approvals
- The workspace Owner role and workspace restrictions

## What does NOT belong here

Private teams, guests, the API, SLAs, triage rules and basic Insights are **core**.

Gating a security boundary is user-hostile: a team that cannot make a channel private
without a purchase order will keep sensitive work in the tool that lets them, and the
product loses the use case rather than winning the upsell. The paid pitch is "you don't
want to run this yourself", plus the compliance surface above — not "your data isn't safe
on the free tier".

## How the separation is enforced

Not by a runtime flag. Go files here carry `//go:build ee` and TypeScript is resolved
through a Vite alias, so the community build does not *contain* this code — it is absent
from the binary and the bundle rather than present and disabled. A licence check that can
be flipped by editing a boolean is not a licence check.

## Layout

```
ee/
├── LICENSE          the commercial terms; governs everything in this directory
├── go.mod           module github.com/peixotolabs/polaris/ee
├── audit/           the audit log's storage and queries      (//go:build ee)
└── web/             the commercial client modules, reached as `@ee/*`
```

`services/go.mod` requires this module and points a `replace` at `../ee`. The import that
pulls it in lives in exactly one file — `services/internal/domain/audit_ee.go`, which is
itself `//go:build ee` — so an untagged build never puts it in the module graph.

Two consequences worth knowing before adding code here:

- **This module cannot import `services/internal/...`.** Go's internal rule is by import
  path, and `.../polaris/ee` is not under `.../polaris/services`. The seam is therefore a
  narrow interface the core declares and an adapter the core owns; this side deals in pgx
  and its own SQL. That is why `audit/` writes SQL by hand instead of using sqlc.
- **Migrations stay in the core.** There is one migration history and one `polarisctl`, and
  both image sets are built from one commit. An empty `audit_log` table in a community
  install costs a catalogue row; a forked migration sequence costs an upgrade path.

## Building each edition

The community build is the default everywhere, so an unqualified command never produces
commercial artefacts:

```bash
# Community (AGPL). What `make check` runs and what self-hosters get.
cd services && go build ./... && go vet ./... && go test ./... -race
pnpm -C web build

# Enterprise. `make check-ee` runs all of this.
cd services && go build -tags ee ./... && go vet -tags ee ./... && go test -tags ee ./... -race
cd ee       && go test -tags ee ./...          # its own tests; ./... does not cross modules
pnpm -C web typecheck:ee && pnpm -C web test:ee
POLARIS_EDITION=ee pnpm -C web build

# Images. The licence label is an argument because the two are not under the same terms.
docker build -f services/Dockerfile -t polaris .
docker build -f services/Dockerfile -t polaris-ee \
  --build-arg POLARIS_EDITION=ee \
  --build-arg IMAGE_LICENSES="AGPL-3.0-only AND LicenseRef-Polaris-Enterprise" .
```

`scripts/lint-editions.sh` (`make lint-editions`, and a step in CI's `go-ee` job) is what
keeps the claim at the top of this section true: it reads `go list -deps` for the real
binaries and fails if a community one links anything from here, or if an enterprise one
links nothing. CI's `web` job does the same for the bundle, by asserting that no GraphQL
operation declared under `ee/web` appears in the community `dist`.
