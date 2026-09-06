# The in-app agent (12.8)

**Status:** shipped on main
**Migrations:** `000083_agent_sessions`, `000084_ai_credits`
**Client schema:** 54 — deliberately unchanged, see below

Natural language in a side panel, and `@polaris` in a comment. The agent reads the workspace,
proposes the writes it wants to make, and carries them out when somebody approves.

## The rule the design turns on: a run never writes

Read tools execute immediately. A **write** tool called by the model is not performed — it is
recorded as a step in a proposal, and the tool result tells the model exactly that, so it
describes a plan rather than reporting work as done. Approval is what runs the steps, through
`internal/agent`'s executor, as the person who approved.

That is not only a safety preference. Everything the model reads — titles, descriptions,
comments — is text somebody else wrote, and on a workspace with public Asks intake it is text
a stranger wrote. Treating it as data rather than instruction is the only defence that does
not depend on the model being hard to talk into things, and the confirmation step is what
makes that defence visible to the person who lives with the result.

`applyAgentProposal` marks the proposal applied **before** running anything. The mark is a
conditional update on the row still being pending, so it doubles as the lock that makes
approval single-shot: a double click, a retry or two open tabs cannot create the same three
issues twice.

**Auto-apply** (`setAgentAutoApply`) is the "accept everything" mode, per person, off by
default.

## Shape

- `internal/llm` — provider abstraction and an Anthropic client: tool use, streaming, typed
  and classified errors, bounded retry with jitter, accurate usage including cache tokens.
  A scripted `Fake` makes the loop testable with no key and no network.
- `internal/agent` — the run loop and the executor. Uses the **same tool registry the MCP
  server uses**, which is why that registry was extracted in
  [55-mcp-oauth-and-tools.md](55-mcp-oauth-and-tools.md): one tool catalogue, one authz path.
- `agent_session` / `agent_message` — the conversation. The first entities in the product
  that are **private to one person**: change rows carry `authz.UserScope`, so they reach that
  user's own devices and nobody else's, and every read is filtered by the caller's id.
- `agent_identity` — the agent's own `kind='app'` user, minted per workspace on first use. A
  reply must not be signed by the person who summoned it; `CountWorkspaceSeats` already
  excludes app users, so it costs no seat.

**Two entry points, one runner.** Interactive chat runs on the api and streams over SSE at
`GET /agent/sessions/{id}/stream`, because that is where somebody is waiting. A comment
mention has no open connection, so it enqueues and the worker drains it.

**No client-schema bump.** The client already skips entity types it does not know
(`web/src/store/types.ts` — `isEntityType`), so agent entities sync without forcing every
user's replica to rebuild, and transcripts stay out of the bootstrap snapshot. The panel
reads over GraphQL and streams over SSE.

## Metering

Denominated in **micros of a US dollar**, because model prices are quoted per million tokens:
one micro per token is exactly one dollar per million, so a charge is a multiplication and
nothing rounds. `ai_credit_ledger` is append-only — when somebody asks why their balance is
what it is, the answer has to be a list of things that happened — with the running total
beside it so the pre-flight check does not sum a customer's whole history.

Off unless `POLARIS_AI_CREDITS_ENABLED` is set, which is the split
`docs/06-product-model/02-plans-and-packaging.md` commits to: a self-hosted install brings its
own key and pays its provider directly, and metering it would be charging twice.

The balance is checked **before** a run, never after — the alternative is telling somebody
their credits ran out by handing them work they have already been charged for. Reads are never
gated: running out narrows what you can do, it never hides what you have.

## Deferred

- Streaming the transcript live across a person's own devices. The change rows are already
  emitted under a user scope; no client consumes them yet.
- Workspace-level spend caps and Stripe top-ups. `grantAgentCredits` adds credit today.
- Loops and scheduled runs.
