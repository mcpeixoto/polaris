# MCP server (Linear as a tool for AI clients)

Standardised interface letting any MCP-compatible model or agent read and write Linear. Available on **all plans** (though the connecting client may have its own plan restrictions).

## Endpoints and transport

- Primary transport is **Streamable HTTP**: `https://mcp.linear.app/mcp` (read-write by default).
- **Read-only**: either connect to `https://mcp.linear.app/mcp/readonly` (only ever exposes read tools), or use `/mcp` while requesting only the `read` OAuth scope — clients granted `read` are restricted and the underlying token cannot reach write APIs.
- `https://mcp.linear.app/sse` is a **deprecated** fallback for clients without Streamable HTTP support (still needed for some WSL setups).
- Centrally hosted and managed, following the authenticated remote MCP spec.
- Interactive setup uses **OAuth 2.1 with dynamic client registration**; you may instead pass `Authorization: Bearer <token>` with an OAuth token or a Linear API key — enabling app-user access, restricted read-only keys, or reuse of an existing OAuth application without a second auth hop.

## Tooling surface

Tools for finding, creating, and updating Linear objects — issues, projects, comments — with more planned.

## Client setup matrix

| Client | Setup |
|---|---|
| **Claude (Team/Enterprise)** | claude.ai → Connectors → connect Linear |
| **Claude (Free/Pro)** | Claude desktop → Settings → Connectors → add Linear |
| **Claude Code** | `claude mcp add --transport http linear-server https://mcp.linear.app/mcp`, then `/mcp` to authenticate |
| **Codex** | `codex mcp add linear --url https://mcp.linear.app/mcp`, or config in `~/.codex/config.toml` under `[mcp_servers.linear]` plus `codex mcp login linear`. Requires `[features] experimental_use_rmcp_client = true` on first use |
| **Cursor** | One-click install or search Linear in Cursor's MCP tools page |
| **VS Code** | `Cmd/Ctrl+P` → *MCP: Add Server* → Command (stdio) → `npx mcp-remote https://mcp.linear.app/mcp` → name it Linear → start it via *MCP: List Servers* |
| **Windsurf** | Settings → Cascade → MCP servers → Add custom server with the `npx mcp-remote` command |
| **Zed** | `context_servers.linear` entry with the same command |
| **Jules** | Generate a Linear API key (Settings → Account → Security & Access) and paste it into Jules' MCP settings |
| **v0 by Vercel** | Install from the connections page |
| **Anything else** | Command `npx`, args `-y mcp-remote https://mcp.linear.app/mcp`, no env |

## Enterprise-managed authorisation

With Okta: configure SAML for Linear, enable **MCP enterprise managed authentication** on the Okta IdP entry, and supply the Okta Issuer URI (`https://your-org.okta.com/oauth2/default`). Supported external clients then authenticate users automatically under Okta policy.

## Documented use cases and prompts

Linear publishes six canonical workflows — reproduce these as onboarding content because they define what "good" looks like:

1. **Roadmap planning** — turn a planning document into a project with issues, milestones, and relations; show the proposed structure before creating anything; flag ambiguity instead of inventing dependencies.
2. **Standup note automation** — match notes to issues by ID/title/owner/context, comment only on confident matches, list unmatched notes rather than guessing.
3. **Incoming bug investigation** — start from a referenced issue, find a likely root cause with evidence, post a summary comment; call out uncertainty rather than guessing.
4. **Team cycle summarisation** — summarise the most recently completed cycle for given team keys, focusing on what actually completed and the themes across it.
5. **Timeline generation** — build a chronological history of work around a topic from issue/project activity, flagging gaps instead of inferring events.
6. **Implementation plan** — draft an approach, get approval, then create a parent issue plus sub-issues, delegating only where explicitly requested.

Simpler positioning examples: "what's on my plate today" in Claude; research a bug in ChatGPT then create a detailed issue; pull project context into Cursor while coding and push technical notes back.

## Operational notes

- **Multi-workspace**: each session authenticates via OAuth and reconnecting does **not** switch workspace — each workspace needs its own auth context. With `mcp-remote`, point `MCP_REMOTE_CONFIG_DIR` at a different path per workspace.
- Internal server error on connect → `rm -rf ~/.mcp-auth` and retry; may also need a newer Node.
- Dropped connections are usually fixed by disconnecting/reconnecting in the client; it doesn't affect Linear data or the auth session.
- WSL: fall back to the `/sse` endpoint with `--transport sse-only`.

## Don't confuse the two MCP directions

- **This page**: Linear exposed *to* AI clients.
- **`01-features/15-ai-agents-loops-coding-sessions.md`**: MCP connectors consumed *by* Linear Agent and loops (Amplitude, Attio, Better Stack, Datadog, GitHub, Glean, Granola, HubSpot, incident.io, Intercom, Jam, Notion, PostHog, Sentry, Slack, Stripe, custom URLs) — admin-gated at the workspace level and connected per user.
