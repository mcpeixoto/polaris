# Settings leftovers (profile, workspace general, team timezone)

**Status:** shipped on this branch  
**Migration:** none  
**Client schema:** unchanged

The mutations already existed. The screens did not. `G S` went to Members because there
was no workspace general page to land on.

## Scope

- Settings → Profile: username, display name, avatar URL, timezone
- Settings → Workspace: name, logo URL; URL key was read-only (now editable — 51)
- Team settings: timezone next to name and key
- Preferences: convert text emoticons into emoji (comments)
- `G S` opens workspace general

## Deferred

- Avatar / logo file upload (the columns already hold URLs)
- Passkeys (WebAuthn — `account_credential` exists; registration is a later slice)
- Leave workspace
