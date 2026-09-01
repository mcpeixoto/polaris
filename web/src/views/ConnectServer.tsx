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
 *
 * ## Why the address complaint is on the field and not above the form
 *
 * It was an `AuthError` — the banner the other screens use for a failure that came back from
 * a server. This one never left the browser: it is `normaliseServerUrl` saying that what was
 * typed is not an address, which is a fact about one field, and `Input` puts it under that
 * field, marks the control `aria-invalid` and wires `aria-describedby` without anyone here
 * doing it by hand.
 *
 * It also fixes an announcement bug that the banner could not. The banner is announced by
 * mounting, so the same sentence set twice in a row is silent the second time — and typing
 * the same bad address twice is the ordinary way to meet this message. Clearing it on the
 * next keystroke, which is what a field message can do and a form banner cannot, means the
 * element genuinely goes away and comes back. `AuthError` stays for a real failure from
 * somewhere else, which is why the slot is still here.
 */

import { useRef, useState, type FormEvent } from 'react';

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
  const [invalid, setInvalid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const addressRef = useRef<HTMLInputElement>(null);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    if (address.trim() === '') {
      setInvalid('Enter the address your administrator gave you.');
      addressRef.current?.focus();
      return;
    }

    const origin = normaliseServerUrl(address);
    if (origin === null) {
      setInvalid('That does not look like a web address. Try something like polaris.acme.com.');
      addressRef.current?.focus();
      return;
    }
    setInvalid(null);

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
          ref={addressRef}
          label="Server address"
          name="server"
          value={address}
          placeholder="polaris.acme.com"
          hint="https:// is assumed unless you say otherwise."
          error={invalid ?? undefined}
          autoFocus
          required
          autoComplete="url"
          inputMode="url"
          spellCheck={false}
          autoCapitalize="none"
          onChange={(event) => {
            setAddress(event.target.value);
            if (invalid !== null) setInvalid(null);
          }}
        />

        {/* Not disabled on an empty address. The submit says what is missing and puts the
            cursor in the field that is missing it, which a greyed-out button cannot do —
            and which is the same bargain the rest of these screens make. */}
        <Button type="submit" variant="primary" fullWidth loading={busy}>
          Connect
        </Button>
      </AuthForm>
    </AuthLayout>
  );
}
