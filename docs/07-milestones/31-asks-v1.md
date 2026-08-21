# Asks v1 (intake from a shareable form)

**Status:** shipped on main  
**Migration:** `000059_ask_forms`  
**Client schema:** 40

Slack-less intake: a token URL that anyone (no account) can submit. Each submission creates a triage issue on the form's team.

## Scope

- Settings → Asks: create a named form on a team, copy `{origin}/ask/{token}`, delete
- Public page at `/ask/:token` works signed out and signed in
- `GET`/`POST /asks/{token}` — token is the credential; unknown/archived/deleted is 404
- Submit lands in triage when the team has it on (same outsider path as email intake)
- Provenance is written into the issue description (`Submitted by Name <email> via Asks.`)
- Replica type `askForm`, team-scoped; archive/delete emit `OpDelete`

## Deferred

- Slack Asks — shipped in `40-asks-slack.md`
- SAML-gated web forms
- Form-template-driven fields
- `issue.ask_form_id`
- Token rotation
- Returning the issue identifier to the requester
