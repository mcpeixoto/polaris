# Settings leftovers (profile, workspace general, team timezone)

**Status:** shipped on this branch  
**Migration:** none  
**Client schema:** unchanged

The mutations already existed. The screens did not. `G S` went to Members because there
was no workspace general page to land on.

## Scope

- Settings → Profile: username, display name, avatar URL, timezone
- Settings → Workspace: name, logo URL; URL key shown read-only
- Team settings: timezone next to name and key
- Preferences: convert text emoticons into emoji (comments)
- `G S` opens workspace general

## Deferred

- Changing the workspace URL key (redirects every bookmark and invite)
- Avatar / logo file upload (the columns already hold URLs)
- Sessions list and passkeys
- Leave workspace
