/**
 * How to point an MCP client at this workspace.
 *
 * The command is the whole setup now: the server registers the client itself (RFC 7591) and
 * the client sends the person here to consent, so nobody has to mint a credential and paste
 * it into a config file before they have seen what the product does. The API-key hop stays
 * documented below, because clients that cannot do the browser round trip still exist and
 * telling them "use OAuth" is not an answer.
 *
 * Every value on it is copied rather than read, so each one gets a `CopyButton` — the shared
 * one, not the local `copyText(…).then(ok => ok && setCopied(…))` this file used to carry,
 * which did nothing at all on the insecure origins where the clipboard is refused and renamed
 * its own button "Copied" for the rest of the session.
 */

import { Link } from 'react-router';

import { CopyButton, SettingsPage, SettingsSection } from '~/components';
import { SettingsRow } from '~/components/SettingsSection';

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
        description="Polaris speaks Streamable HTTP MCP. Point a client at the read-write URL and it will open a browser for you to approve the connection. The read-only URL never exposes write tools."
      >
        <SettingsRow>
          <p className={styles.note}>
            The client registers itself, so there is nothing to create here first. It acts as you,
            in this workspace, and reaches exactly what you can.
          </p>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Endpoints">
        <Endpoint label="Read and write" value={mcpUrl} copyLabel="Copy URL" />
        <Endpoint label="Read only" value={readonlyUrl} copyLabel="Copy URL" />
      </SettingsSection>

      <SettingsSection
        title="Claude Code"
        description="Run this, then /mcp in Claude Code to approve the connection."
      >
        <Endpoint label="Add the server" value={claude} copyLabel="Copy command" />
      </SettingsSection>

      <SettingsSection
        title="Clients that cannot sign in"
        description="Some clients can set a header but not complete a browser sign-in. Those authenticate with a personal API key sent as Authorization: Bearer — it acts as you, and never reaches further than you can."
      >
        <SettingsRow>
          <p className={styles.note}>
            <Link className={styles.link} to="/settings/api-keys">
              Create an API key
            </Link>
          </p>
        </SettingsRow>
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
 * One copyable row: what it is on the left, the literal value and the button on the right.
 *
 * The button's accessible name names the row rather than repeating "Copy URL" three times —
 * a list of identically-named controls names nothing, and this page has three of them.
 */
function Endpoint({ label, value, copyLabel }: EndpointProps) {
  return (
    <SettingsRow label={label}>
      <div className={styles.endpoint}>
        <pre className={styles.code}>{value}</pre>
        <CopyButton
          value={value}
          label={copyLabel}
          ariaLabel={`${copyLabel} — ${label}`}
          variant="ghost"
          size="sm"
        />
      </div>
    </SettingsRow>
  );
}
