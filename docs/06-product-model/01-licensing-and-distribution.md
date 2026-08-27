# Licensing and distribution

## Decisions

| Question | Decision |
|---|---|
| Core licence | **AGPL-3.0-only** |
| Enterprise features | **`ee/` under a commercial licence** (Polaris Enterprise Licence) |
| Contributor agreement | **CLA required** (copyright assignment/grant), because dual-licensing is impossible without it |
| Distribution | Public GitHub repo; self-host free, self-host + licence key, or our EU-hosted cloud |
| Trademark | Name and marks **not** granted by the code licence |
| Hosted region | **EU only** (the VPS). Self-hosters choose their own — residency stops being a product feature |

## Why AGPL + `ee/`

AGPL's §13 closes the "run it as a service without contributing" hole that permissive licences leave open. A competitor may still host Polaris — but must publish their modifications, which removes most of the commercial incentive to do so while costing honest self-hosters nothing.

The `ee/` split is what makes the enterprise upsell legally possible. It is the pattern used by GitLab, Cal.com, and Sentry (pre-BSL), and it is well understood by the corporate buyers who will ask.

**The CLA is not optional under this model.** You cannot license *contributors'* AGPL code under commercial terms for `ee/` unless they granted you that right. Without a CLA, the moment someone else's patch lands in a file that `ee/` links against, the commercial licence is unsound. State this plainly in `CONTRIBUTING.md`; some contributors will refuse, and that is the real cost of this choice.

## Repository layout

> **The sketch below is the original plan and the repository did not follow it.** The
> commercial code lives under the top-level `ee/` directory — `ee/audit/`, `ee/web/` — and
> not under `services/ee/` and `web/src/ee/`. `ee/README.md` describes what is actually
> there.
>
> The reason is the scope rule in `ee/LICENSE`, which is the document that decides the
> question: it governs "the contents of the `ee/` directory", and closes with "If a file's
> placement is ambiguous, the directory it lives in decides — and a file that would be
> ambiguous belongs in the core." A directory called `ee` nested inside AGPL source is
> exactly that ambiguity, and resolving it in the licence's own terms puts the code under
> the licence that names it. The cost is that `ee/` is a second Go module and cannot import
> `services/internal/...`; the mechanism that works around it is described in
> `ee/README.md`.
>
> Everything below about *build separation being real*, the two image sets, and licence keys
> stands unchanged.

```
polaris/
├── LICENSE                 AGPL-3.0-only        <- everything except ee/
├── LICENSE.ee              Polaris Enterprise Licence
├── NOTICE                  third-party attributions
├── TRADEMARK.md            name/logo policy
├── CONTRIBUTING.md         DCO sign-off + CLA
├── SECURITY.md             disclosure process
│
├── services/
│   ├── internal/…          core (AGPL)
│   └── ee/                 commercial
│       ├── LICENSE
│       ├── saml/  scim/  audit/  dashboards/  advancedasks/  approvals/
│       └── license/        key verification
├── web/
│   ├── src/…               core (AGPL)
│   └── src/ee/             commercial
└── ee/                     docs + pricing pages for commercial features
```

### Build separation must be real

A "core" build must **not contain** enterprise code — not disabled, absent. Otherwise the licence boundary is a flag, and every honest reviewer will notice.

Go, via build tags:
```go
//go:build ee
package registry
func init() { Register(saml.Provider{}, scim.Provider{}, audit.Provider{}) }
```
```go
//go:build !ee
package registry
func init() { /* enterprise providers absent from this binary */ }
```

TypeScript, via a build-time alias that resolves `@ee/*` either to `web/src/ee` or to a stub module that renders upgrade prompts. Vite `resolve.alias`, switched by `POLARIS_EDITION`.

CI produces two image sets from one commit:

| Image | Tag | Contents |
|---|---|---|
| `ghcr.io/…/polaris` | `vX.Y.Z` | Core only, AGPL, what self-hosters pull |
| `ghcr.io/…/polaris-ee` | `vX.Y.Z-ee` | Core + `ee/`, gated by a licence key at runtime |

The cloud runs `-ee`. The public `docker-compose.yml` references the core image.

## Licence keys (self-host enterprise)

Offline-verifiable so an air-gapped customer works and so your licence server is never a dependency of their uptime.

```jsonc
// Ed25519-signed JWT, public key compiled into the binary
{
  "sub": "acme-corp",
  "edition": "enterprise",
  "seats": 250,
  "features": ["saml", "scim", "audit", "dashboards", "advanced_asks", "approvals"],
  "iat": 1767225600,
  "exp": 1798761600,
  "grace_days": 30
}
```

Behaviour rules — get these right or you will make an enemy of a paying customer at 3 a.m.:

1. **Never destroy or hide data on expiry.** Enterprise features go read-only; the audit log stops accepting new entries but existing entries remain exportable; SAML keeps working for 30 days' grace so nobody is locked out of their own workspace.
2. **Seat overage warns, never blocks.** Exceeding the seat count shows an admin banner and appears on the next invoice.
3. **No phone-home requirement.** Optional licence-status check for renewal reminders; failure to reach it changes nothing.
4. **Grace period is generous** (30 days) because clock skew, renewals in procurement, and expired cards are normal.

## Third-party licence audit

Every dependency shipped inside the distributed artefact needs checking. Findings that change earlier decisions:

| Dependency | Licence | Verdict |
|---|---|---|
| **Redis 7.4+** | RSALv2 / SSPLv1 — **not OSI** | ❌ **Replaced with Valkey 8 (BSD-3)**, drop-in, same protocol |
| PostgreSQL | PostgreSQL Licence | ✅ |
| Valkey | BSD-3-Clause | ✅ |
| Meilisearch | MIT | ✅ (optional profile) |
| MinIO | AGPL-3.0 | ✅ — reached over the S3 network API, not linked; and AGPL-compatible anyway. Community builds have shed features; the filesystem driver is the default for small installs |
| gqlgen, pgx, sqlc, asynq | MIT / Apache-2.0 | ✅ |
| React, Vite, TipTap, Yjs | MIT | ✅ |
| Electron | MIT (bundles Chromium, BSD-style) | ✅ |
| Nginx Proxy Manager | MIT | ✅ but fleet-specific — self-host ships Caddy instead |

Automate this: `go-licenses` + `license-checker` in CI, failing on any GPL-incompatible or unknown licence, with the output committed as `NOTICE`.

## Trademark

The code licence grants no rights to the name or logo. `TRADEMARK.md` should say, in plain words:

- You may run, modify, and redistribute the software freely under AGPL.
- You may say your product is "based on Polaris" or "a fork of Polaris".
- You may **not** call your hosted service "Polaris" or use the logo in a way implying endorsement.
- Distributing a modified version under the same name requires renaming.

This is the standard arrangement (Firefox/Iceweasel, Grafana, Mattermost). It is also the only lever you retain against a rehoster who complies with AGPL.

**Before committing to the name:** check EUIPO and USPTO for "Polaris" in software/SaaS classes — it is a common name and there are existing marks in other industries. Also check the npm scope, the GitHub org, and the domain. Cheap now, expensive after launch. **[OPEN]**

## What must never be in the public repo

- Anything from `/root/.config/polaris/polaris.env`
- The fleet's specifics: NPM host names, `registry.yml` shape, `admin-deploy.timer` internals, the VPS IP
- Cloud-only operational config, customer data, licence-signing **private** keys
- Trademarked third-party assets

The fleet deployment lives in a **separate private repo** or a private `deploy/` submodule. The public repo ships a generic `docker-compose.yml` that any stranger can run — see `05-infrastructure/10-self-host-and-cloud.md`.

## Legal posture on being a Linear clone

Worth writing down once, publicly and calmly:

- **Functionality is not copyrightable.** Building an issue tracker with cycles, triage, and initiatives is lawful.
- **Expression is.** No Linear code, assets, icons, copy, or documentation text. The scope docs in this repo are original prose describing observed behaviour.
- **Do not market as "Linear, but free."** Comparison is fine; trading on their trademark is not. Describe what Polaris does, not whose product it resembles.
- Keep the provenance note in `docs/00-overview/05-source-index.md` — it documents that the scope came from public documentation, which is exactly the record you want if anyone ever asks.
