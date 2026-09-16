# Polaris Cursor plugin

Official [Cursor](https://cursor.com) plugin for [Polaris](https://polaris.peixotolabs.com). It connects the agent to a Polaris workspace over Streamable HTTP MCP so it can read and write issues, projects, and comments.

The server is the same `/mcp` surface the product already ships. Auth is OAuth 2.1 with dynamic client registration: Cursor registers itself and opens a browser for you to approve. The connection acts as you, in that workspace, and reaches exactly what you can.

## Install

1. Open Cursor → **Customize** → **Plugins** → **Browse Marketplace**.
2. Search for **Polaris**.
3. Install, then approve the workspace in the browser.

The marketplace listing is the MIT repo [mcpeixoto/polaris-cursor-plugin](https://github.com/mcpeixoto/polaris-cursor-plugin) — Cursor's publisher terms do not allow AGPL inside a listed plugin, so this folder is a copy of that packaging, not the submission tree.

Until the listing is live, Settings → MCP in Polaris has **Add to Cursor**, which installs the server for *this* origin (cloud or self-hosted).

Manual `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "polaris": {
      "url": "https://polaris.peixotolabs.com/mcp"
    }
  }
}
```

Self-hosted: replace the URL with `https://<your-origin>/mcp`. The same string is on Settings → MCP.

Read-only: `https://<origin>/mcp/readonly`.

## Support

- Docs: [MCP server](https://github.com/mcpeixoto/polaris/blob/main/docs/03-platform/05-mcp-server.md)
- Issues: https://github.com/mcpeixoto/polaris/issues
