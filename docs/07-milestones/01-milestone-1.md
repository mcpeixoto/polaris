# Milestone 1 — the daily loop

**Goal:** the tracker stops being a demo. A team that adopted it in M0 has no reason to
keep a second tool open.

M0 proved the architecture: one API, a gapless change stream, a local-first replica, one
keymap. M1 adds the properties and surfaces people reach for a dozen times a day and
notice the absence of within an hour.

Written after M0 shipped, so the estimates below carry what M0 actually taught rather than
what it was expected to.

---

## What M0 taught, and what changes because of it

**The sync engine was the right thing to build first, and it was cheaper than budgeted.**
Version minting under a row lock, a self-contained `scope` on every change row, and one
visibility predicate turned out to be enough. There is no gap-detection logic on the
client at all, and the whole delta path is a few hundred lines. Nothing in M1 should be
allowed to weaken those three decisions.

**The local store has far more headroom than expected.** Filter, group and sort over 5,000
issues measures 0.42 ms against a 50 ms budget. That changes what M1 can afford: filters
and saved views can be computed eagerly on every keystroke rather than debounced, and the
board layout does not need its own index.

**One thing is already known to be wrong, and is fixed here rather than deferred.** An
issue created while offline keeps its provisional id until the next full sync, so the
server's copy and the stand-in are both briefly on screen. See "Provisional identity"
below.

**Generated code needs guarding.** gqlgen rewrites its resolver file and silently comments
out anything it does not recognise. One helper in the wrong file broke the build. Every
new resolver-adjacent helper goes in its own file.

---

## Schema decisions closed here

Written as they were made, with the reasoning, because the reasoning is the part that is
expensive to reconstruct. Two of these were changed after the first version failed against
a real Postgres; both are marked.

### Labels are one table, and a group is a label

`label` with `parent_id` and `is_group`, not `label_group` plus `label`. A group has
exactly the fields a label has, so two tables would mean two entity types on the change
stream, two pickers, two permission rules and two places where scoping is decided.

**Changed after testing.** The first version defined "is a group" as "has children", which
is the obvious shortcut and is wrong: a group you have just created has no children yet, so
under that definition it stays an ordinary applicable label until somebody adds one — and
every application made in the meantime becomes invalid the moment they do. `is_group` is
declared.

Nesting is one level, as a CHECK rather than a trigger. "Priority > P0" is how people
describe these; "Priority > Urgency > P0" is not, and allowing it would make the
one-per-group rule ambiguous.

### Applying a label is a row, not an array

`issue_label` has its own id and is its own entity on the sync stream. Labels are the first
*set* the engine carries, and a set written as a whole loses writes: two people adding
different labels a second apart both send the full new set and the second overwrites the
first. As individual rows an add is an upsert of one row and a remove is a delete of one,
so both survive with no merge logic anywhere. That is M1 acceptance test 1, and it is
satisfied by the shape of the data rather than by code.

The one-per-group rule is a partial unique index on `(issue_id, group_id)`, with `group_id`
denormalised from the label and maintained by trigger. In the database because it is a data
invariant: a UI that enforces it and an importer that does not gives you issues that are
both "P0" and "P3".

### A due date is a `date`, and it says where it came from

`due_date date`, never `timestamptz`. A due date is a calendar day in the team's timezone;
as an instant it becomes due on the previous day for everybody west of whoever set it, and
nobody notices until somebody misses a deadline by a few hours. The client has the same
rule — see `web/src/features/time.ts`, where `new Date('2026-09-01')` is specifically
avoided because it parses as UTC midnight.

`due_date_source` is `manual` or `sla`. SLAs arrive later and will also want to set a date;
the two are mutually exclusive, and which subsystem owns the date decides whether a human
may edit it. One column now, versus guessing the provenance of every date already stored.

### Only `blocks` is stored

"Blocked by" is the same row read from the other end. Two rows can disagree, and an issue
that blocks another without the other being blocked by it is a state no user can explain or
repair.

`related` has no direction and is stored with the smaller id first, enforced by a CHECK.
That is what makes one unique index enough to stop A-related-B and B-related-A both
existing — without it the duplicate is invisible to the database and shows up twice in the
UI.

### Notifications coalesce on a key, and derive from `change_log`

One row per recipient per event, with `UNIQUE (user_id, group_key)`. That index is what
makes the fan-out safely resumable: a worker that crashes mid-batch and restarts
re-processes the same versions and conflicts rather than delivering everything twice.

`group_key` is the change version for a single event and the batch id for a bulk operation,
so two hundred issues updated at once produce one inbox row per person carrying a count.
Acceptance test 8 is a property of this key, not of a later optimisation.

An unsubscribe is a flag, not a deleted row. Deleting instead would let the next comment
auto-subscribe the user again, so unsubscribe would be a button that works for about four
minutes.

### The filter AST is a JSON scalar, deliberately

A typed GraphQL input and output tree would be a *second* definition of the grammar
alongside the compiler — which is precisely the trap this milestone names. The compiler
validates at the boundary and rejects anything it does not recognise, including an unknown
field, which is a hard error rather than an ignored clause: ignoring one silently widens
the result set, and a filter that quietly matches more than it says is what makes people
stop trusting filters.

There are two evaluators — TypeScript against the replica, Go against SQL — and they are
pinned to each other by `schema/filter-conformance.json`, which both test suites run.
Neither computes the expected answer, so a change that makes both implementations agree on
something wrong still fails.

### One folding function for search and for `contains`

`search_fold(text)` = `lower(unaccent(...))`, used by the generated `tsvector` columns and
by the filter compiler's `contains`. Two different foldings would mean a search and a saved
view typed with the same words return different issues — acceptance test 2 failing at the
storage layer, before either evaluator is involved.

The dictionary is `simple`, not `english`. Stemming with the wrong dictionary mangles
exactly the domain terms people search for, and Polaris is EU-first with workspaces that
are multilingual inside a single issue.

**Changed after testing.** The first version was a readable pair of functions — an
`immutable_unaccent` wrapper with `lower()` on top. It failed: a migration file reaches the
server as one query batch, the planner inlines a SQL function at first use, and an
unqualified reference to another function created earlier in the same batch does not
resolve. The migration failed with "function does not exist" pointing at a function that
plainly did. Flattened to one schema-qualified function.

`unaccent` is also `STABLE` rather than `IMMUTABLE`, so Postgres refuses it in a generated
column or an index expression until the dictionary is named explicitly. The honest caveat
is recorded in the migration: that immutability is a promise about a file on disk, and a
major-version upgrade needs a `REINDEX`.

### API keys are not on the sync stream

Every other new entity replicates because it is rendered in a hot path. Keys are listed on
one settings screen, rarely, and replicating them would put a credential's metadata in
every device's IndexedDB for no gain. The token itself is never in the model at all — it
exists in the response to the call that created it and nowhere else.

### The entitlement matrix is Go; only the facts are data

Which plan may use which feature changes with a release, not with data. In the database it
would mean a deploy that adds a feature also needs a data migration in every self-hosted
install, and that a bug in the matrix is a production data fix rather than a revert. The
workspace table carries only what the matrix cannot know: its plan, when that lapses, and
any negotiated seat override.

When a paid plan lapses, reads keep working and gated writes do not. Locking people out of
their own data over a failed card is not a business model.

---

## Scope

Grouped by the question each answers.

### "I cannot describe my work" — issue properties

| Feature | Notes |
|---|---|
| Labels and label groups | Workspace- and team-scoped. At most one label per group per issue — that constraint is what makes groups useful and it belongs in the database, not the UI |
| Estimates | Per-team scale (exponential, Fibonacci, linear, t-shirt). Store the number; render the scale |
| Due dates | Mutually exclusive with SLA later, so model the exclusion now |
| Sub-issues | Parent/child, cross-team allowed. Progress rolls up |
| Relations | blocks / blocked-by / related / duplicate. Blocked-by is the inverse of blocks, not a separate row |
| Templates (standard) | Prefilled properties plus a description. Issues remember the template that made them |

Labels are the load-bearing one. They are many-to-many, they are filtered on constantly,
and they are the first entity whose *set* semantics the sync engine has to carry —
add/remove ops rather than whole-set writes, so two people adding different labels at the
same moment both survive.

### "I cannot find my work" — filters, views, search

| Feature | Notes |
|---|---|
| Filter grammar | AND/OR groups, comparators, relation filters. One compiler, heavily tested — this is where a filter that silently matches everything comes from |
| Quick filters and URL sync | A filtered view must be a shareable link |
| Display options | Grouping, ordering, which properties show. Per view, remembered |
| Board layout | Columns are statuses. The store already supports it |
| Search | Postgres full-text first. Meilisearch only when relevance complaints appear |
| In-view find | Already possible: the trigram index measures 0.18 ms over 5,000 titles |
| Custom views + favourites | Saved filters with a name |

### "I do not know what happened" — notifications

| Feature | Notes |
|---|---|
| Notification engine | One row per recipient per event. Derived from `change_log`, not re-derived from entities |
| Inbox | Read/unread, snooze, delete |
| My Issues | Real, replacing the M0 placeholder |
| Subscriptions | Auto-subscribe on create, assign, mention, comment |
| Email delivery | Digest first. Per-notification email is a preference, not a default |

Notifications are where a change stream stops being an implementation detail: every
notification is a `change_log` row filtered by "does this concern you". Building it any
other way means a second, divergent definition of what happened.

### "I cannot run this for a team" — administration

| Feature | Notes |
|---|---|
| Invitations UI | The backend shipped in M0 and has no screen |
| Member management | Roles, suspension, removal |
| Personal API keys | Scoped, revocable, listed |
| Rate limiting + complexity budgets | The complexity limiter is wired; the per-caller budget is not |
| Entitlement service | Before any gating exists, not after — see the trap below |
| Issue delete, restore, undo | Soft delete exists; the recovery UI does not |

---

## Provisional identity — the known M0 defect

The server allocates an issue's id and its number, the number from a row-locked counter, so
no client can predict either. An optimistic create therefore shows a stand-in row and swaps
it when the response arrives. That works online. Offline, the outbox replays the mutation
later and the server's issue arrives as a delta while the stand-in is still on screen — two
rows for one issue until the next full sync.

Three options, in order of preference:

1. **Client-generated ids, server-allocated numbers.** The client mints the UUIDv7 and
   sends it; the server honours it and allocates only the number. The stand-in *is* the
   issue, and the swap disappears. Costs: the id becomes client-controlled input and must
   be validated as v7 and unused; a malicious client can pick ids, which matters less than
   it sounds because it can already pick any content.
2. **Persist the pairing in the outbox** and reconcile on delta arrival. Keeps ids
   server-authoritative; adds a reconciliation path that only runs in a case that is hard
   to test.
3. **Leave it.** Honest, documented, and briefly confusing exactly when the user is least
   able to reason about it — on a train.

Recommendation: (1). It is less code than (2) and removes the problem rather than
managing it.

---

## Deliberately still out

Cycles, projects, milestones, initiatives, triage, documents, customers, SLAs, insights,
dashboards, releases, and every integration. They are M2 and later.

Two of those are worth naming because they will be argued for: **projects** and **GitHub**.
Both are the most-requested things at this stage and both are large. Taking either into M1
means M1 does not ship, and a tracker with projects but no labels, filters or notifications
is not a tracker anybody switches to.

---

## Traps specific to M1

| Trap | Why it bites |
|---|---|
| Building labels as a flat list | Groups, scoping and the one-per-group rule all change the schema. Retrofitting means a migration across every issue |
| Whole-set writes for labels | Two people adding different labels at once, and one loses. Sets need add/remove ops on the change stream |
| Filters that compile to SQL per call site | The grammar must be one compiler with one test suite, or a filter means something different in a view than in search |
| Deferring the entitlement service | Gating touches ~40 features. Scattered `if plan ==` checks are unmaintainable, and the first one is written the day gating ships |
| Notifications derived from entities | They must derive from `change_log`, or "what happened" has two definitions that diverge |
| Debouncing filter input | Unnecessary. It measures 0.42 ms; a debounce adds latency to hide a cost that is not there |

---

## Acceptance tests

The M0 fifteen still have to pass. These are additional.

**Correctness**
1. Two clients add different labels to one issue at the same moment → both survive.
2. A filter expressed in the UI, in a saved view and in a search returns identical ids for
   the same workspace state.
3. An issue is assigned → exactly one notification row exists for the assignee, and none
   for anybody else.
4. A sub-issue's completion updates its parent's progress with no extra round trip.
5. Deleting an issue and undoing within the window restores it, its comments and its
   relations.

**Performance** — same seeded 5,000-issue workspace.
6. Filter with four active clauses re-renders in < 50 ms.
7. Search returns in < 300 ms p95.
8. The notification fan-out for a bulk update of 200 issues completes in < 2 s and produces
   one row per affected subscriber, not per issue per subscriber.

**Contract**
9. Every new mutation is reachable over the public API — `api_parity_test.go` enforces it.
10. Every new entity carries `workspace_id` and appears on the change stream with a scope.

## Done criterion

> Somebody who joined the team in M1 files, finds and closes their work without being told
> where anything is.
