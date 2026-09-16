/**
 * Cursor's official Polaris install: a Streamable HTTP MCP server on this origin.
 *
 * The marketplace plugin points at the hosted cloud. This helper is for Settings → MCP,
 * which must install *this* replica — cloud or self-hosted — so a deeplink copied from
 * localhost does not silently attach the agent to production.
 */

export function polarisMcpUrl(origin: string): string {
  return `${origin.replace(/\/$/, '')}/mcp`;
}

/** Server config Cursor's install deeplink expects (name is a query param, not in here). */
export function cursorMcpInstallConfig(origin: string): { url: string } {
  return { url: polarisMcpUrl(origin) };
}

export function cursorMcpInstallHref(origin: string): string {
  const config = btoa(JSON.stringify(cursorMcpInstallConfig(origin)));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=polaris&config=${config}`;
}

export function cursorMcpSnippet(origin: string): string {
  return JSON.stringify({ mcpServers: { polaris: { url: polarisMcpUrl(origin) } } }, null, 2);
}
