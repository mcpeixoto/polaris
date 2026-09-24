/**
 * /llm.txt is the public setup note for MCP clients. nginx serves the file from
 * public/ the same way it serves the privacy policy, so a client that fetches
 * the URL is reading this document. The test locks the endpoints and the
 * command the product itself shows in Settings → MCP.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'llm.txt');

function load(): string {
  return readFileSync(FILE, 'utf8');
}

describe('llm.txt', () => {
  const text = load();

  it('gives the hosted MCP endpoints and the Claude Code command', () => {
    expect(text).toContain('https://polaris.peixotolabs.com/mcp');
    expect(text).toContain('https://polaris.peixotolabs.com/mcp/readonly');
    expect(text).toContain(
      'claude mcp add --transport http polaris https://polaris.peixotolabs.com/mcp',
    );
  });

  it('names the read tools and the write tools a read-only client must not see', () => {
    expect(text).toContain('list_issues');
    expect(text).toContain('create_issue');
    expect(text).toContain('cycle_summary');
    expect(text).toContain('roadmap_planning');
  });
});
