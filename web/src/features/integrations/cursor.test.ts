import { describe, expect, it } from 'vitest';

import {
  cursorMcpInstallConfig,
  cursorMcpInstallHref,
  cursorMcpSnippet,
  polarisMcpUrl,
} from './cursor';

describe('cursor MCP install', () => {
  it('points the server at this origin, not a hardcoded cloud host', () => {
    expect(polarisMcpUrl('http://localhost:5173')).toBe('http://localhost:5173/mcp');
    expect(polarisMcpUrl('https://tracker.example/')).toBe('https://tracker.example/mcp');
  });

  it('encodes a url-only config so Cursor opens OAuth against this replica', () => {
    const href = cursorMcpInstallHref('https://polaris.peixotolabs.com');
    expect(
      href.startsWith('cursor://anysphere.cursor-deeplink/mcp/install?name=polaris&config='),
    ).toBe(true);
    const encoded = href.split('config=')[1] ?? '';
    expect(JSON.parse(atob(encoded))).toEqual(
      cursorMcpInstallConfig('https://polaris.peixotolabs.com'),
    );
  });

  it('offers the same snippet a person would paste into mcp.json', () => {
    expect(cursorMcpSnippet('https://polaris.peixotolabs.com')).toContain(
      '"url": "https://polaris.peixotolabs.com/mcp"',
    );
  });
});
