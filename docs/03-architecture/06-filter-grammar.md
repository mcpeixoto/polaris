# The filter grammar

One grammar, one AST, two evaluators.

A filter is written once — in the view bar, in a saved view, in a search, in an export —
and must mean the same thing every time. The failure this document exists to prevent is
the one where a saved view and a search with identical filters return different issues,
because each call site compiled the filter slightly differently. That bug is not found by
a unit test; it is found by a user who no longer trusts the tool.

## Why there are two evaluators and still one grammar

The client filters against its local replica: that is the whole point of the architecture,
and it is why a four-clause filter over five thousand issues re-renders in under a
millisecond instead of a round trip. The server filters in SQL, because search must run
against issues the client has not replicated and because an export cannot ship a replica
first.

So there are two implementations. What there is not, and must never be, is two
*grammars*. `internal/filter` and `web/src/filter` read the same AST, implement the same
semantics, and are pinned to each other by a conformance fixture that both test suites
run. When the two disagree, one of them fails — rather than both passing and the product
being wrong.

## The AST

JSON, and the same bytes in `view.filter`, in a `SearchInput`, and in the client's store.

A node is either a clause or a group. They are distinguished by their keys, not by a
discriminator field: a clause has `field`, a group has `nodes`.

```jsonc
// clause
{ "field": "assignee", "op": "in", "values": ["<uuid>", "<uuid>"] }

// group
{ "conj": "and", "nodes": [ /* clauses and groups */ ] }
```

### Canonical empty

`{"conj":"and","nodes":[]}` matches everything, because an AND over nothing is vacuously
true. `{}` is also accepted and means the same thing — the column default is `'{}'`, and
rejecting it would make a freshly created view unopenable. Both evaluators must treat them
identically, and there is a conformance case for it.

### Fields

| Field | Type | Notes |
|---|---|---|
| `state` | uuid | The workflow state |
| `stateCategory` | enum | `triage`…`duplicate`. Filtering by category survives a team renaming its statuses |
| `assignee` | uuid or null | |
| `creator` | uuid or null | |
| `subscriber` | uuid | Whether that user is subscribed and has not unsubscribed |
| `priority` | int | `0` none, `1` urgent … `4` low. The raw value, not the display rank |
| `label` | uuid | Multi-valued: an issue matches if *any* of its labels matches |
| `team` | uuid | |
| `estimate` | int or null | |
| `dueDate` | date | `2006-01-02` |
| `createdAt`, `updatedAt`, `completedAt` | timestamp | RFC 3339, or a relative token — see below |
| `title`, `description` | text | `contains` is case- and diacritic-insensitive |
| `parent` | uuid or null | |
| `blockedBy`, `blocking` | uuid | Relation traversal, one hop |
| `archived`, `deleted` | bool | Default: both excluded unless a clause says otherwise |
| `template` | uuid or null | Which template filed the issue |
| `recurring` | bool | Whether the issue belongs to a recurring schedule |
| `customer` | uuid | Customers attributed via a request. Multi: any of them matches |
| `customerCount` | int | How many requests the issue has, unattributed ones included. Zero when none |
| `customerStatus` | enum | `active` / `prospect` / `churned`. Any related customer |
| `customerTier` | text | Workspace-defined plan name. Any related customer; `contains` folds |
| `customerRevenue`, `customerSize` | int or null | Any related customer. Null means no related customer has the attribute |
| `customerImportant` | bool | Whether any request on the issue is marked important |

An unknown field is a **hard error**, not an ignored clause. Ignoring it would silently
widen the result set, and a filter that silently matches more than it says is exactly the
class of bug that makes people stop trusting a filter.

### Operators

| Op | Applies to | Meaning |
|---|---|---|
| `eq`, `neq` | all | Single value |
| `in`, `notIn` | all | Any of `values` |
| `contains`, `notContains` | text | Substring, folded |
| `gt`, `gte`, `lt`, `lte` | number, date, timestamp | |
| `isNull`, `isNotNull` | nullable | `values` must be absent |

An operator that does not apply to the field's type is a hard error, for the same reason.

### Relative dates

`createdAt`, `updatedAt`, `completedAt` and `dueDate` accept a relative token instead of a
literal. There are seven keywords —

| Token | Means |
|---|---|
| `now` | the current instant |
| `today` | the start of today |
| `yesterday` | the start of yesterday, exactly `-1d` |
| `tomorrow` | the start of tomorrow, exactly `+1d` |
| `startOfWeek` | the start of Monday of this week |
| `startOfMonth` | the start of the 1st of this month |
| `startOfYear` | the start of 1 January this year |

— and an offset form, `[+-]<count><unit>` where the unit is `d`, `w`, `M` or `y`: `-7d`,
`+2w`, `-1M`, `+3d`, `-1y`. The sign is required, because `7d` reads as both "seven days
ago" and "in seven days" depending on who is reading it. `M` is months and is
case-sensitive, leaving `m` free for minutes if a timestamp filter ever wants them.

`now` is the only token that is not the start of a day, which is what makes `dueDate lt now`
mean overdue. On a date field it means today, because a `DATE` column holds no instants.

`endOfWeek` is deliberately absent: it has two defensible readings — the last day, or the
exclusive bound after it — and a grammar shared by two implementations cannot afford a token
whose meaning each side picks for itself.

**The set of tokens is part of the contract, not an implementation detail.** A token one
evaluator understands and the other does not is a filter that returns different issues
depending on where it was evaluated, and the symptom is not an error: the filter bar builds
it, the screen answers it correctly from the replica, and then saving the view fails. That
happened — the client shipped five of the seven above before the server had any of them.

So the set grows here first, then in both implementations, then in
`schema/filter-conformance.json`, which records the exact instant every token resolves to at
a fixed clock. Both suites read that table. It exists separately from the case list because
the case list structurally cannot catch this class of divergence: a case using a token only
one side accepts fails on the side that rejects it, so nobody writes one.

These are resolved **at evaluation time, in the workspace's timezone**, not at save time.
A view called "Updated this week" that quietly means "the week of 4 March" because that is
when it was saved is worse than useless — and it is what storing the resolved date
produces.

## Semantics that are easy to get wrong

Each of these has a conformance case, because each is a place where two independent
implementations naturally diverge.

**Null and `neq`.** `{"field":"assignee","op":"neq","values":["<ada>"]}` matches
unassigned issues. SQL's three-valued logic says `NULL <> 'ada'` is `NULL`, so the
straightforward `WHERE assignee_id <> $1` drops them — and the user who asked for
"everything not assigned to Ada" does not get the unassigned ones, which is the opposite
of what the words mean.

**`label` with `notIn`.** Means "has no label from this set", not "has some label that is
not in this set". Every issue with two labels matches the second reading and almost none
of them are what was asked for.

**`in` with an empty `values`.** Matches nothing. `notIn` with an empty `values` matches
everything. Both follow from set semantics and both are worth pinning, because the
"obvious" implementation of an empty IN-list in SQL is a syntax error and the obvious fix
is to skip the clause — which silently turns "assigned to nobody in this list" into "no
filter at all".

**Text comparison.** `contains` folds case and diacritics: searching `acao` finds `Ação`.
Someone typing without an accent is not asking for a different issue.

**Archived and deleted.** Excluded unless an explicit clause includes them. This is a
default, not a hidden clause: it applies to the whole filter, and a group containing
`{"field":"archived","op":"eq","values":["true"]}` turns it off for the entire query
rather than for that group. Scoping it per group would mean an OR could resurrect deleted
issues into a view that never asked for them.

## Display options

Stored beside the filter, and equally shared, so that "group by assignee, ordered by
priority" survives being saved, shared and reopened.

```jsonc
{
  "layout": "list",              // list | board
  "groupBy": "state",            // none | state | stateCategory | assignee | priority | label | team | dueDate | parent
  "orderBy": "manual",           // manual | priority | dueDate | estimate | createdAt | updatedAt | title
  "direction": "asc",
  "showSubIssues": true,         // false hides children whose parent is in the same view
  "showCompleted": true,
  "properties": ["priority", "assignee", "labels", "estimate", "dueDate"]
}
```

Every key is optional and absence means the default. A client built before an option
existed must render a view that uses it — degraded, never broken.

## The conformance fixture

`schema/filter-conformance.json` holds a small workspace and a list of cases, each a
filter and the ids it must return, in order.

Both suites load it: the Go test inserts the workspace into Postgres and runs the compiled
SQL, the TypeScript test loads it into the store and runs the evaluator. Neither computes
the expected answer — it is recorded in the file, so a change that makes both
implementations agree on something wrong still fails.

Adding a case is the way to fix a filter bug. Fixing one implementation without adding a
case leaves the other one wrong.
