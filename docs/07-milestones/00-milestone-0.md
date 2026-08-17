# Milestone 0 — scope freeze

**Goal:** a team can create issues, move them through statuses, see them in a list, in real
time, on the web — and stop using its old tracker.

Everything not on this page is out of scope for M0. Adding to this list requires deleting
something else from it.

---

## Schema decisions closed here

These change the table shapes, so they are decided before the first migration.

### 1. Custom fields — **NO**

Linear deliberately does not ship user-defined custom fields, and the reason is structural,
not a backlog item: every view, filter, insight, sort, template, import, export, webhook
payload, and sync payload would have to become schema-driven at runtime. Labels + label
groups + templates + projects + estimates cover the demand that custom fields usually
absorb.

**Consequence accepted:** some Jira migrations will lose data. The importer maps unmapped
Jira fields into a label group or appends them to the description, and says so.

**Reversal cost if wrong:** high but bounded — an `issue_custom_value` table plus a
filter-grammar extension. Not a rewrite. Deferring is the cheaper bet.

### 2. Multiple workspaces per account — **YES**

`account` (auth identity: email, credential, sessions) is a separate table from `user`
(workspace-scoped profile: name, avatar, role, memberships). One account → many users, one
per workspace.

This is *not* deferrable. Making it one-to-one now means that adding it later rewrites
auth, session, JWT claims, sync scoping, notification routing, and every `user_id` foreign
key's meaning. The cost today is one extra table and one extra join at login.

M0 ships the schema and the workspace switcher endpoint; the switcher **UI** is M2.

### 3. Data residency — **EU only** (already decided)

No `region` column, no routing layer, no US shard. Recorded here so nobody adds one
speculatively.

---

## Entity list — exactly these tables

Anything else is M1+. Every table gets `id uuid` (v7), `created_at`, `updated_at`,
`archived_at`, and — except the four marked global — `workspace_id`.

| Table | Notes |
|---|---|
| `account` | **global.** Auth identity. email, password_hash, email_verified_at |
| `account_session` | **global.** Opaque refresh token, revocable, device/IP/user-agent |
| `account_credential` | **global.** Reserved for passkeys/OAuth logins. Shipped empty in M0 |
| `schema_migrations` | **global.** golang-migrate bookkeeping |
| `workspace` | name, url_key (unique), logo_url, settings jsonb |
| `workspace_version` | The sync counter. `(workspace_id, version)` |
| `user` | account_id, workspace_id, name, display_name, avatar_url, role, status, timezone |
| `team` | key, name, icon, color, private, parent_team_id (nullable — hierarchy is M3), settings |
| `team_membership` | user_id, team_id, role (`member`\|`owner`) |
| `workflow_state` | team_id, name, category, position, color, is_default |
| `issue` | see field list below |
| `issue_history` | The activity feed. actor, field, from, to, grouped_at |
| `comment` | issue_id, parent_id (threads), body, actor |
| `change_log` | The sync stream. Partitioned monthly |
| `idempotency_key` | (client_id, op_id) → result, 24h TTL |
| `invite` | workspace_id, email, role, token, expires_at |

**16 tables.** If a PR adds a 17th, it is out of scope.

### Issue fields in M0

`team_id`, `number`, `identifier` (generated `KEY-n`), `title`, `description` (markdown
text — *not* Yjs yet), `state_id`, `assignee_id`, `creator_id`, `priority` (0–4),
`sort_order` (fractional index, workspace-global), `started_at`, `completed_at`,
`canceled_at`, `archived_at`, `deleted_at`.

**Deliberately absent in M0:** labels, estimate, due date, cycle, project, milestone,
parent/sub-issue, relations, subscribers, attachments, SLA, delegate, release,
recurring, shared_with, snoozed_until, triaged_at, auto_closed_at.

`number` is allocated per team by a row-locked counter on `team`, not a sequence — team
moves must not renumber, and gaps are ugly in a product where the identifier is the name.

---

## Screen list — exactly these

| Screen | Contents |
|---|---|
| Sign in / sign up | Email + password. Magic-link and passkeys are M1 |
| Create workspace | Name → url_key, seeds the first team + 5 default statuses |
| Join via invite | Token → account create-or-link → workspace member |
| App shell | Sidebar (workspace switcher stub, team list, My Issues, Inbox stub), main pane, connection indicator |
| Issue list | Virtualised, grouped by status, keyboard-navigable, multi-select, bulk actions |
| Issue detail | Title, description editor, status/assignee/priority pickers, activity feed, comments |
| Issue create | Modal (`C`), fully keyboard-driven |
| Command menu | `⌘K` — every action registered in the keymap registry, fuzzy-searched |
| Team settings | Rename, key, workflow statuses (create/rename/reorder/recolor/default) |
| Members | Invite, list, change role, suspend |
| Keyboard help | `?` — generated from the keymap registry, never hand-written |

Not in M0: My Issues (real), Inbox, search, board layout, filters, projects, cycles,
triage, views, profile pages, billing.

---

## The keyboard model — decided in M0, not later

This is architecture, not polish. Retrofitting a keymap over hand-wired `onKeyDown`
handlers is a full-client refactor.

- **One registry.** Every action is `{id, title, keys, when, group, run}` registered once.
  The command menu, the help overlay, the context menus, and the key handler are all
  *views over that registry.* No component owns a shortcut.
- **Context stack**, not global listeners. `when` is evaluated against the active context
  (`list`, `detail`, `editor`, `modal`, `menu`). Highest context wins.
- **Sequences supported from day one** (`g` then `i`), because Linear's model uses them
  and a single-chord implementation cannot be extended to sequences without rewriting the
  matcher.
- **Nothing is hardcoded in a component.** CI greps for `onKeyDown` outside `web/src/keys/`
  and the editor package, and fails.

M0 keymap: `⌘K`, `?`, `C`, `Esc`, `↑/↓/J/K`, `X` select, `⇧↑/↓` range-select, `E` archive,
`A` assign, `S` status, `P` priority, `⌘⏎` submit, `G` then `I`/`M` navigate.

---

## Acceptance tests — the definition of done

Each is an automated test, not a manual check. M0 is done when all fifteen are green in CI.

**Correctness**
1. Create issue in browser A → visible in browser B in < 500 ms, no refresh.
2. Kill the network in A, change status of 20 issues, restore → all 20 land, in order,
   exactly once. Replaying the same `opId` returns the original result, not a second write.
3. A and B edit the same issue's priority concurrently → both converge to the
   server-ordered last write; neither client is left showing a stale value.
4. Delete the client's IndexedDB, reload → identical rendered state after bootstrap.
5. Bump `clientSchema` → client drops the store and re-bootstraps without user action.
6. A user removed from a team receives `revoke` and the team's issues vanish locally.
   *(M0 has no private teams; this tests the mechanism, which M3 then relies on.)*
7. Stop the sync hub mid-session → client reconnects with backoff, resumes from `version`,
   loses nothing.
8. Force `version` retention past the client's position → server sends `resync`, client
   recovers cleanly.

**Contract**
9. Every M0 mutation is reachable from a personal API key over `POST /graphql` with the
   same result as the UI. There is no endpoint the web app uses that the API does not
   expose.
10. Import-lint passes: `graph/`, `syncsrv/`, `jobs/` contain zero imports of `store/`.
11. Every mutation writes a `change_log` row and an `issue_history` row in the *same*
    transaction as the entity write. A test asserts this by aborting the tx and checking
    all three are absent.
12. Every mutation carries an actor of type `user | app_user | integration | system`; a
    write with no actor fails at compile time (the domain API requires it).

**Performance** — measured against a seeded 5,000-issue workspace, in CI, as regressions.
13. Filter/group/sort re-render: **< 50 ms**.
14. Optimistic render after keypress: **< 16 ms**.
15. Cold bootstrap of a 10,000-issue workspace: **< 5 s**.

---

## Status

Updated as tests land. A row is only ticked when an automated test asserts it — "it worked
when I tried it" is how a regression ships.

| # | Acceptance test | Status | Where |
|---|---|---|---|
| 1 | Create in A → visible in B < 500 ms | ✅ | `syncsrv/sync_test.go`, **and confirmed in Chrome**: a write from curl moved the open tab 3335→3336 with no refresh |
| 2 | Offline replay: exactly once, in order | ✅ | `domain/idempotency_test.go`, verified live |
| 3 | Concurrent edits converge, server-ordered | ✅ | `domain/conflict_test.go` |
| 4 | Drop IndexedDB → identical state after bootstrap | ✅ | `e2e/sync.spec.ts` |
| 5 | `clientSchema` bump → drop and re-bootstrap | ✅ | `syncsrv/sync_test.go` (server) + `e2e/sync.spec.ts` (client) |
| 6 | Removed from team → `revoke`, issues vanish | ✅ | `syncsrv/sync_test.go` |
| 7 | Hub restart → resume from version, lose nothing | ✅ | `syncsrv/sync_test.go` |
| 8 | Retention past client → `resync`, clean recovery | ✅ | `domain/conflict_test.go` |
| 9 | Every mutation reachable over the public API | ✅ | `graph/api_parity_test.go` |
| 10 | Import-lint: no `store/` outside `domain/` | ✅ | `scripts/lint-imports.sh` |
| 11 | Entity + change_log + history share one tx | ✅ | `domain/events_test.go` |
| 12 | Every mutation carries an actor | ✅ | compile-time; `domain/events_test.go` |
| 13 | Filter/group/sort < 50 ms @ 5,000 issues | ✅ | `store/perf.test.ts` — **0.42 ms** |
| 14 | Optimistic render < 16 ms | ✅ | `store/perf.test.ts` — **~0 ms** |
| 15 | Cold bootstrap < 5 s @ 10,000 issues | ✅ | 12,509 entities / 7.36 MB raw / **914 KB gzipped in 70 ms** server side, and the browser renders the 10,002-issue workspace from a cold load |

**All fifteen are green.** A sixteenth behaviour is covered too, because it is the one the
whole architecture exists for: an edit made with the network down renders immediately, the
sync indicator says the work is unsent, and the outbox replays it on reconnect — asserted
end to end in `e2e/sync.spec.ts`.

Three rules are enforced mechanically in CI, each catching something no type checker can:
the import rule (`scripts/lint-imports.sh` — only `domain/` may reach `store/`, which is
what guarantees every mutation emits a change row), the keymap rule
(`scripts/lint-keymap.sh` — no keyboard handling outside the registry), and design tokens
(`scripts/lint-tokens.sh` — no literal colours, and no `var(--token)` that does not exist).

## Done criterion

> The Polaris team tracks Polaris's own development in Polaris, and nobody opens the old
> tracker for a week.

Not "the tests pass". Dogfooding is the test that catches what the other fifteen cannot:
that the thing is pleasant to use.

---

## Build order

Sequenced so each step is verifiable before the next depends on it.

| # | Step | Verified by |
|---|---|---|
| 1 | Repo scaffold, Go module, Makefile, compose.dev, CI | `make check` green on a clean clone |
| 2 | Migrations 1–16, sqlc, testcontainers harness | Schema round-trips; rollback-free forward migration test |
| 3 | `platform/` (config, slog, health, shutdown), `store/` | `/healthz` up, pool connects |
| 4 | `authz/` visibility predicate + `domain/events.go` | Unit tests before any caller exists |
| 5 | Auth: account, session, JWT, invite flow | 9 (contract) partially green |
| 6 | `domain/` workspace, team, workflow_state, user | Integration tests |
| 7 | `schema.graphql` v0 + gqlgen + resolvers | 9, 10 green |
| 8 | `domain/issue` + history + comments | 11, 12 green |
| 9 | Bootstrap endpoint (NDJSON) | 4 green |
| 10 | Client store: IndexedDB, indexes, outbox | 13 green |
| 11 | Sync hub + delta fan-out + resume | 1, 7, 8 green |
| 12 | Optimistic mutations + idempotency | 2, 3 green |
| 13 | Revoke events | 6 green |
| 14 | Keymap registry + command menu | Help overlay generates itself |
| 15 | Screens | Playwright covers the eleven |
| 16 | Seed + perf harness | 13, 14, 15 green |

Steps 1–4 are load-bearing and are built solo and carefully. 5–16 parallelise.
