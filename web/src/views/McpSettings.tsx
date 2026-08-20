/**
 * How to point an MCP client at this workspace.
 *
 * Interactive OAuth with dynamic client registration is deferred. v1 authenticates with the
 * same bearer API key (or OAuth token) every other integration uses, which is how Jules and
 * any client that can set a header already talk to Linear. This page exists so that hop is
 * written down next to the keys, not in a README somebody has to find.
 */

import { useState } from 'react';
import { Link } from 'react-router';

import { Button } from '~/components';
import { copyText } from '~/features/github/copy';

import styles from './McpSettings.module.css';

export function McpSettings() {
  const origin = window.location.origin;
  const mcpUrl = `${origin}/mcp`;
  const readonlyUrl = `${origin}/mcp/readonly`;
  const claude = `claude mcp add --transport http polaris ${mcpUrl}`;
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (label: string, value: string) => {
    void copyText(value).then((ok) => {
      if (ok) setCopied(label);
    });
  };

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>MCP</h1>
      </header>

      <div className={styles.body}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Connect a client</h2>
          <p className={styles.sectionNote}>
            Polaris speaks Streamable HTTP MCP. Create a personal API key, then send it as{' '}
            <code>Authorization: Bearer</code>. The read-only URL never exposes write tools.
          </p>
          <p className={styles.sectionNote}>
            <Link className={styles.link} to="/settings/api-keys">
              Create an API key
            </Link>
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Endpoints</h2>
          <p className={styles.sectionNote}>Read and write</p>
          <pre className={styles.code}>{mcpUrl}</pre>
          <Button variant="ghost" size="sm" onClick={() => copy('mcp', mcpUrl)}>
            {copied === 'mcp' ? 'Copied' : 'Copy URL'}
          </Button>
          <p className={styles.sectionNote}>Read only</p>
          <pre className={styles.code}>{readonlyUrl}</pre>
          <Button variant="ghost" size="sm" onClick={() => copy('readonly', readonlyUrl)}>
            {copied === 'readonly' ? 'Copied' : 'Copy URL'}
          </Button>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Claude Code</h2>
          <p className={styles.sectionNote}>
            Then set the Authorization header to your API key in the client’s MCP config. OAuth
            sign-in from the client is not wired yet.
          </p>
          <pre className={styles.code}>{claude}</pre>
          <Button variant="ghost" size="sm" onClick={() => copy('claude', claude)}>
            {copied === 'claude' ? 'Copied' : 'Copy command'}
          </Button>
        </section>
      </div>
    </div>
  );
}
