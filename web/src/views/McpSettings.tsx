/**
 * How to point an MCP client at this workspace.
 *
 * Interactive OAuth with dynamic client registration is deferred. v1 authenticates with the
 * same bearer API key (or OAuth token) every other integration uses, which is how Jules and
 * any client that can set a header already talk to Linear. This page exists so that hop is
 * written down next to the keys, not in a README somebody has to find.
 *
 * Every value on it is copied rather than read, so each one gets a `CopyButton` — the shared
 * one, not the local `copyText(…).then(ok => ok && setCopied(…))` this file used to carry,
 * which did nothing at all on the insecure origins where the clipboard is refused and renamed
 * its own button "Copied" for the rest of the session.
 */

import { Link } from 'react-router';

import { CopyButton, SettingsPage, SettingsSection } from '~/components';

import styles from './McpSettings.module.css';

export function McpSettings() {
  const origin = window.location.origin;
  const mcpUrl = `${origin}/mcp`;
  const readonlyUrl = `${origin}/mcp/readonly`;
  const claude = `claude mcp add --transport http polaris ${mcpUrl}`;

  return (
    <SettingsPage title="MCP">
      <SettingsSection
        title="Connect a client"
        description="Polaris speaks Streamable HTTP MCP. Create a personal API key, then send it as an Authorization: Bearer header. The read-only URL never exposes write tools."
      >
        <p className={styles.note}>
          <Link className={styles.link} to="/settings/api-keys">
            Create an API key
          </Link>
        </p>
      </SettingsSection>

      <SettingsSection title="Endpoints">
        <Endpoint label="Read and write" value={mcpUrl} copyLabel="Copy URL" />
        <Endpoint label="Read only" value={readonlyUrl} copyLabel="Copy URL" />
      </SettingsSection>

      <SettingsSection
        title="Claude Code"
        description="Then set the Authorization header to your API key in the client’s MCP config. OAuth sign-in from the client is not wired yet."
        flush
      >
        <Endpoint label="Add the server" value={claude} copyLabel="Copy command" />
      </SettingsSection>
    </SettingsPage>
  );
}

interface EndpointProps {
  label: string;
  value: string;
  copyLabel: string;
}

/**
 * One copyable line: what it is, the literal value, and the button.
 *
 * The button's accessible name names the row rather than repeating "Copy URL" three times —
 * a list of identically-named controls names nothing, and this page has three of them.
 */
function Endpoint({ label, value, copyLabel }: EndpointProps) {
  return (
    <div className={styles.endpoint}>
      <p className={styles.note}>{label}</p>
      <pre className={styles.code}>{value}</pre>
      <CopyButton
        value={value}
        label={copyLabel}
        ariaLabel={`${copyLabel} — ${label}`}
        variant="ghost"
        size="sm"
      />
    </div>
  );
}
