/**
 * First run in the desktop app: which Polaris server is yours?
 *
 * The web client never sees this screen and never should — it was served by its own API, so
 * the question is already answered. The desktop app is the case where it is not: Polaris is
 * self-hosted, the same download has to work against anybody's server, and an address
 * compiled into the binary would mean a build per customer.
 *
 * It comes before sign-in because it has to. There is nowhere to send credentials until
 * somebody says where the server is.
 */

import { useState, type FormEvent } from 'react';

import { Button, Input } from '~/components';
import { setDesktopServerUrl } from '~/platform/runtime';
import { normaliseServerUrl } from '~/sync/endpoint';
import { AuthError, AuthForm, AuthLayout } from './AuthLayout';

export interface ConnectServerProps {
  /**
   * The server currently configured, if this screen was reached from settings rather than
   * on first run. Prefilled so somebody correcting a typo does not retype the whole address.
   */
  current?: string | undefined;
}

export function ConnectServer({ current }: ConnectServerProps) {
  const [address, setAddress] = useState(current ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    const origin = normaliseServerUrl(address);
    if (origin === null) {
      setError('That does not look like a web address. Try something like polaris.acme.com.');
      return;
    }

    // No reachability check before saving, and that is deliberate. A probe here would need
    // its own timeout, its own error vocabulary and its own retry, and it would still be
    // wrong for the person setting the app up on a laptop that is not on the VPN yet. The
    // sign-in screen that follows makes a real request and reports a real failure, which is
    // the same information one step later and about a page the user was going to see anyway.
    setBusy(true);
    setError(null);
    setDesktopServerUrl(origin);
  };

  return (
    <AuthLayout
      title="Connect to your Polaris"
      subtitle="Polaris is self-hosted, so it needs the address of your team's server. Your administrator will have it."
    >
      <AuthForm onSubmit={onSubmit}>
        <AuthError message={error} />

        <Input
          label="Server address"
          value={address}
          placeholder="polaris.acme.com"
          hint="https:// is assumed unless you say otherwise."
          autoFocus
          required
          autoComplete="url"
          spellCheck={false}
          autoCapitalize="none"
          onChange={(event) => setAddress(event.target.value)}
        />

        <Button type="submit" variant="primary" fullWidth loading={busy} disabled={address === ''}>
          Connect
        </Button>
      </AuthForm>
    </AuthLayout>
  );
}
