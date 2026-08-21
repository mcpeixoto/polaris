# Workspace URL-key change

**Status:** shipped on this branch
**Migration:** `000075_workspace_url_key`
**Client schema:** unchanged (52) — `workspace.urlKey` already syncs

Settings → Workspace could show the slug and not change it. Changing it is an admin write
plus a reserved alias so the previous address cannot be taken and still resolves.

## Scope

- `updateWorkspace(urlKey:)` — same format as create (2–48 lowercase, digits, hyphens)
- Previous key stored in `workspace_url_alias`; `GetWorkspaceByURLKey` follows it
- Creating or renaming onto a live or retired key is refused
- Renaming back to a previous key reclaims the alias
- Settings → Workspace: the URL key field is editable for admins

## Deferred

- Client routes still do not prefix `/<urlKey>/` (Linear does); aliases are ready for it
- Sessions list and passkeys
- Leave workspace
- Avatar / logo file upload
