# MCP server v1 (12.6)

**Status:** shipped on main  
**Migration:** none  
**Client schema:** 36 (unchanged by this slice; bumped with view subscriptions)

Polaris as a remote MCP server: Streamable HTTP on the existing `api` process, not a sixth container.

## Scope

- `POST/GET /mcp` (read-write) and `/mcp/readonly`
- Auth is the existing Bearer API key / OAuth token path
- 401 includes `WWW-Authenticate` plus well-known OAuth metadata
- Tools: `list_issues`, `get_issue`, `list_comments`, `list_teams`, `list_projects`, `get_viewer`, `create_issue`, `update_issue`, `create_comment`
- UUID or `ENG-123` on issue tools
- Read-only hides write tools and rejects write `tools/call`
- Settings → MCP documents the URLs, Claude Code command, and the API-key hop

## Deferred

- OAuth 2.1 dynamic client registration
- SSE fallback transport
- Broader tool surface (projects write, documents, cycles)
