## Why

What was wrong, or what this makes possible. The diff already says what changed. If this is
a fix, say what the failure looked like from the outside.

## What changed

## Tests

Which test covers the behaviour this PR changes. A bug that escaped needs a test that would
have caught it.

## Checklist

- [ ] `make check` passes locally
- [ ] `make generate` run and committed, if `schema/schema.graphql` or any `.sql` file changed
- [ ] One concern — a fix and a reformat are two pull requests
- [ ] No hardcoded colours or sizes; keyboard handling goes through the keymap registry
- [ ] Nothing resembling a credential, hostname or workspace data in the diff
