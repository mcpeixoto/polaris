# Running the open-source project

Being on GitHub is not the same as having an open-source project. This is the operational half.

## Repository hygiene (before the repo goes public)

| File | Content |
|---|---|
| `README.md` | What it is, a screenshot, a 60-second self-host command, licence, links |
| `LICENSE` | AGPL-3.0-only |
| `LICENSE.ee` | Polaris Enterprise Licence |
| `NOTICE` | Generated third-party attributions |
| `TRADEMARK.md` | Name/logo policy |
| `CONTRIBUTING.md` | Dev setup, DCO sign-off, **CLA explanation**, PR expectations, architecture rules |
| `CODE_OF_CONDUCT.md` | Contributor Covenant 2.1 |
| `SECURITY.md` | Disclosure address, PGP key, response SLA, safe-harbour statement |
| `SUPPORT.md` | Bugs → issues, questions → discussions, paid support → contact |
| `.github/ISSUE_TEMPLATE/` | bug / feature / security-redirect |
| `.github/PULL_REQUEST_TEMPLATE.md` | Checklist incl. "does this change a sync payload shape?" |
| `docs/` | This scope, rendered on a docs site |
| `CHANGELOG.md` | Keep-a-changelog, generated from conventional commits |

**Audit the git history before publishing.** A private repo made public carries every secret ever committed. `gitleaks detect --no-git` over the whole history; if anything is found, start a fresh repo rather than rewriting history — squashing and force-pushing does not remove blobs from forks or caches.

## CI that works for strangers

Fork PRs get **no secrets**. Therefore:

- `lint`, `generate-check`, `test-go`, `test-web`, `sync-conformance` must run with zero credentials — testcontainers, seeded data, no external calls.
- Image publishing, desktop signing, and SDK publishing run only on tags from the main repo.
- Add `pull_request_target` nowhere. It is the standard way open-source CI gets compromised.
- Pin all GitHub Actions to commit SHAs, not tags.
- Provide a devcontainer / `make bootstrap` so a first-time contributor gets a running stack in one command. Contribution volume is inversely proportional to setup pain.

## The CLA

Required by the dual-licensing model, and the single biggest source of contributor friction.

- Use **cla-assistant** (bot comments on first PR, contributor signs once, status check gates merge).
- Explain **why** in plain language in `CONTRIBUTING.md`: "so we can offer the enterprise edition and a hosted service that funds this work". People accept an honest commercial rationale; they resent an unexplained legal wall.
- Accept **DCO sign-off** as well for trivial changes (typos, docs) to lower the bar.
- Keep a signature log. If you ever want to relicense, this is the evidence.

Expect a percentage of would-be contributors to decline. That is the cost of the licence model you chose; it's a known, survivable one.

## Versioning and releases

- **SemVer** on the product: breaking API/schema changes bump major.
- Two version numbers matter and must not be conflated: the **app version** and the **sync `clientSchema` version**. The PR template asks about the latter for a reason.
- **Release cadence**: fortnightly minors while pre-1.0, monthly after. Predictability matters more than speed for self-hosters who must schedule upgrades.
- **Upgrade support window**: state it — e.g. migrations support upgrading from any release within the last 12 months. Skipping further requires a stepped upgrade. Without a stated window, you support every version ever released, forever.
- Every release notes: breaking changes first, migration notes, and whether a re-bootstrap is forced.

## Telemetry

The fastest way to lose the room. Rules:

1. **Opt-in, never opt-out.** Ask during first-run setup, default off.
2. **Publish the exact payload** in `docs/telemetry.md` and print it on the console when enabled.
3. `POLARIS_TELEMETRY=off` always wins, including over the UI setting.
4. Never send: workspace names, issue content, emails, IPs, user counts below aggregation thresholds.
5. Acceptable: version, edition, deployment shape, feature-enabled booleans, aggregate scale bucket (`1-10 users`), error fingerprints without payloads.
6. **Never** use telemetry for upsell targeting in a self-hosted install.

## Support boundary

Write it down before the first angry thread, because it will otherwise be litigated in public:

| Channel | For | Response |
|---|---|---|
| GitHub Issues | Reproducible bugs, feature requests | Best effort; triaged weekly |
| GitHub Discussions | Questions, setup help, show-and-tell | Community-first |
| `security@` | Vulnerabilities | 48 h acknowledgement |
| Cloud Pro | Product support | Email, business days |
| Cloud/Self-host Enterprise | Everything, incl. deployment | Contractual SLA |

"I self-hosted it and it broke" is a **Discussions** question, not an entitlement. Being explicit is kinder than being vague and then resentful.

## Security disclosure

- `SECURITY.md`: contact, PGP key, 48 h acknowledgement, 90-day disclosure window, safe harbour for good-faith research.
- Use **GitHub Security Advisories** to develop fixes privately, request CVEs, and publish coordinated releases.
- Backport security fixes to the previous minor at minimum.
- Notify cloud customers of anything they'd need to act on, even when you've already patched the cloud.

The permission boundary (`08-security-and-operations.md`) is where the serious reports will come from. Have the fuzz test in CI *before* the repo is public.

## Governance

Be honest and simple at the start: **BDFL, single maintainer**. Roadmap is yours; contributions are welcome; not every PR will be merged.

State the architecture rules that will get PRs rejected, so rejection is never a surprise:
1. `graph/`, `syncsrv/`, `jobs/`, `integrations/` may only call `domain/`.
2. Every mutation emits change-log rows in the same transaction.
3. New feature ⇒ same behaviour through GraphQL as through the UI.
4. No second permission-filtering implementation.
5. Sync payload shape changes bump `clientSchema`.

If the project grows maintainers, revisit with a written governance doc rather than drift.

## Community expectations to plan for

- **"Why AGPL and not MIT?"** — answer once, link to it forever.
- **"Why is SSO paid?"** — the sso.tax argument will be made. Your counter is that the whole product including private teams, guests, and the API is free and unlimited on seats. Have that answer ready and don't be defensive.
- **Feature-request pressure** toward Jira parity (custom fields, workflows-per-project). The non-goals list in `04-scope/04-risks-and-non-goals.md` is your published defence — link it rather than re-arguing.
- **Fork threats.** Someone will fork. If the licence, trademark, and docs are clean, this is fine and occasionally useful.
- **Packaging PRs** (Helm chart, Nix, TrueNAS, Unraid, YunoHost). Welcome them, but only adopt into the main repo what you'll actually maintain; otherwise link to community-maintained repos.

## Launch checklist

- [ ] History scanned for secrets; fleet-specific config moved to a private repo
- [x] LICENSE, ee/LICENSE, NOTICE, TRADEMARK, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT in place
- [ ] CLA bot wired and tested with a throwaway account
- [x] CI needs no secrets to pass — six jobs, all secret-free except the optional gitleaks scan
- [ ] `docker compose up` works on a clean machine, documented, with a first-run wizard
- [ ] Screenshots and a 90-second demo video in the README
- [ ] Docs site live
- [ ] Telemetry off by default, payload documented
- [ ] Permission fuzz test in CI
- [ ] Security contact reachable and monitored
- [ ] Trademark search done
- [ ] Answers drafted for "why AGPL", "why is SSO paid", "how is this different from Linear"
