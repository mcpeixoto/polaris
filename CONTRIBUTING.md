# Contributing to Polaris

## Getting it running

```bash
make install     # Go modules + pnpm workspace
make up          # postgres + valkey in Docker
make migrate
make seed        # a realistic workspace: 3 teams, ~2000 issues, 9 people
```

Then, in separate terminals:

```bash
make api         # GraphQL API on :8088
make sync        # WebSocket hub on :8089
make web         # Vite on :5173, proxying both
```

Open http://localhost:5173/. On loopback the API signs you in as `dev@polaris.local`
(after `make seed`) and the login form does not appear. Off localhost, or on a
self-hosted install, sign in with `dev@polaris.local` / `polaris-dev-password`.

Seed the **large** scale before touching anything performance-sensitive. A list looks fine
at twelve issues and janks at five thousand, and the difference is invisible until you
have the data.

## Before you open a pull request

```bash
make check       # everything CI runs: fmt, vet, both lint rules, both test suites
```

CI runs the same commands, plus a check that generated code is not stale. If you changed
`schema/schema.graphql` or any `.sql` file, run `make generate` and commit the result.

## The rules that are enforced mechanically

Three, and each exists because the alternative is a bug that is very hard to find later.

**Only `internal/domain` may import `internal/store`.** Resolvers, the sync hub and job
handlers all go through the domain layer. That is what guarantees every mutation emits its
change-log row in the same transaction as the entity write. A resolver that could reach
the database directly would eventually write something the sync stream never hears about,
and it would be investigated as a sync bug for a day before anybody looked at the
resolver. Enforced by `scripts/lint-imports.sh`.

**Keyboard handling lives in the keymap registry.** Register an action; do not add an
`onKeyDown`. An action that is registered works, appears in the command menu, appears in
the help overlay, and is checked for conflicts at startup — none of which a local handler
gets. Enforced by `scripts/lint-keymap.sh`, which has a short, explicit allowlist for the
three widgets that own a focus trap.

**No hardcoded colours or sizes in components.** Everything is a `var(--token)` from
`web/src/styles/tokens.css`. Custom themes are a product feature, and one stray hex is
enough to make a theme look broken.

## Things worth knowing before you start

- **Issues have no stored identifier.** `ENG-123` is derived from the team key and the
  issue number, because team keys are mutable and storing it would mean rewriting every
  issue in a team to fix a typo.
- **The sync version is minted under a row lock**, per workspace, inside the mutation's
  transaction. That lock is the serialisation point of the whole engine; it is what makes
  the version sequence gapless and the client's resume logic trivial. Do not optimise it
  away without reading `docs/05-infrastructure/03-sync-engine.md` first.
- **Mutations are idempotent on `(clientId, opId)`.** The client replays from a durable
  outbox, so a mutation that is not replay-protected will eventually run twice.
- **Tests run against a real Postgres**, not mocks. The parts most likely to be wrong are
  the partial unique indexes, the lock ordering and the CHECK constraints, and a mock
  asserts only that the code called the function its author expected.

## Commits and pull requests

Explain **why** in the message, not what — the diff already says what. If the change is a
fix, say what the failure looked like from the outside.

Keep pull requests to one concern. A PR that fixes a bug and reformats a file is two PRs,
and the reformatting hides the fix.

## Contributor Licence Agreement

Contributions to the **AGPL core** — everything outside `ee/` — need no CLA. You keep your
copyright; your contribution is licensed under AGPL-3.0-only like the rest of the file.

Contributions to **`ee/`** require a CLA, because that code is dual-licensed and we cannot
relicense a contribution we do not hold the rights to. The bot will ask you to sign on
your first PR touching that directory.

This is worth being blunt about: a CLA is a real cost to contributors, and it is being
asked for only where it is structurally necessary. If you would rather not sign one, the
core is where almost all of the interesting work is anyway.

## Reporting a security issue

Do not open an issue. Email **security@peixotolabs.com**. You will get an acknowledgement
within 72 hours and an assessment within a week. Please give us 90 days before disclosing.
