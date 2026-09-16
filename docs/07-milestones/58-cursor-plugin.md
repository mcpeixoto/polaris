# Cursor official plugin (12.8)

**Status:** shipped on this branch  
**Migration:** none  
**Client schema:** unchanged

Polaris as a Cursor marketplace plugin: the same Streamable HTTP `/mcp` the product already
serves, packaged the way Cursor reviews official listings (Agent Plugin + Cursor Plugin
manifests, `mcp.json`, mark as `logo.svg`).

## Scope

- `integrations/cursor/` — manifests, hosted MCP URL, README
- `.cursor-plugin/marketplace.json` — so the public repo can be submitted as a plugin source
- Settings → MCP: **Add to Cursor** deeplink for *this* origin, plus a copyable `mcp.json`
- Directory row **Cursor** under AI, linking at the same settings page

## Deferred

- Cursor Marketplace listing: submit **https://github.com/mcpeixoto/polaris-cursor-plugin** (MIT) at https://cursor.com/marketplace/publish. Do not submit this AGPL repository.
- A dedicated `mcp.polaris…` host; `/mcp` on the public origin is the contract
