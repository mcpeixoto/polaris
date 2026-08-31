/**
 * The provider buttons under the email and password form.
 *
 * Rendered from what the server says it offers, not from what this build knows how to draw.
 * A deployment with no Google client id gets no Google button — the alternative is a button
 * that opens a popup, completes a sign-in at Google, and then fails against a route that
 * answers 404, which is the worst of both.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, auth } from '~/sync/api';

import { fetchAuthProviders } from './providers';
import { mountGoogleButton, signInWithApple, type Assertion } from './social';
import styles from './SocialSignIn.module.css';

interface SocialSignInProps {
  /** Called once a session exists, with the same contract the password form uses. */
  onSignedIn: () => void;
  /** Redeemed on the sign-in call when somebody arrived from an invitation link. */
  inviteToken?: string | undefined;
}

export function SocialSignIn({ onSignedIn, inviteToken }: SocialSignInProps) {
  const [providers, setProviders] = useState<('google' | 'apple')[]>([]);
  const [googleClientId, setGoogleClientId] = useState('');
  const [appleClientId, setAppleClientId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const googleSlot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAuthProviders()
      .then((body) => {
        if (cancelled) return;
        setProviders(body.providers);
        setGoogleClientId(body.googleClientId);
        setAppleClientId(body.appleClientId);
      })
      .catch(() => {
        // Silent: a server that cannot answer this offers no providers, and an error message
        // about a feature nobody asked for is noise on the one screen that has to stay calm.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const exchange = useCallback(
    async (provider: 'google' | 'apple', assertion: Assertion) => {
      setBusy(true);
      setError(null);
      try {
        await auth.signInWithOIDC(provider, {
          idToken: assertion.idToken,
          nonce: assertion.nonce,
          ...(assertion.displayName === undefined ? null : { displayName: assertion.displayName }),
          ...(inviteToken === undefined ? null : { inviteToken }),
        });
        onSignedIn();
      } catch (failure) {
        setBusy(false);
        setError(
          failure instanceof ApiError ? failure.message : 'That sign-in did not work. Try again.',
        );
      }
    },
    [inviteToken, onSignedIn],
  );

  useEffect(() => {
    const slot = googleSlot.current;
    if (!providers.includes('google') || googleClientId === '' || slot === null) return;
    void mountGoogleButton(
      slot,
      googleClientId,
      (assertion) => void exchange('google', assertion),
      setError,
    );
  }, [providers, googleClientId, exchange]);

  const onApple = useCallback(async () => {
    setError(null);
    try {
      await exchange('apple', await signInWithApple(appleClientId));
    } catch (failure) {
      // A cancelled popup is not a failure worth shouting about: Apple rejects with
      // `popup_closed_by_user`, which is somebody changing their mind.
      const message = failure instanceof Error ? failure.message : String(failure);
      if (!message.includes('popup_closed')) setError(message);
    }
  }, [appleClientId, exchange]);

  if (providers.length === 0) return null;

  return (
    <div className={styles.wrap}>
      <div className={styles.divider} role="separator">
        <span>or</span>
      </div>

      {error === null ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {/* Google renders its own button in here — their terms require theirs, not ours. */}
      {providers.includes('google') ? <div ref={googleSlot} className={styles.slot} /> : null}

      {providers.includes('apple') && appleClientId !== '' ? (
        <button
          type="button"
          className={styles.apple}
          disabled={busy}
          onClick={() => void onApple()}
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
            <path d="M11.2 8.5c0-1.4 1.1-2.1 1.2-2.1-.6-1-1.6-1.1-2-1.1-.8-.1-1.6.5-2 .5s-1.1-.5-1.8-.5c-.9 0-1.8.5-2.3 1.4-1 1.7-.3 4.2.7 5.6.5.7 1 1.4 1.8 1.4.7 0 1-.5 1.9-.5s1.1.5 1.9.4c.8 0 1.3-.7 1.8-1.4.6-.8.8-1.6.8-1.6s-1.5-.6-1.5-2.1zM9.9 3.9c.4-.5.7-1.2.6-1.9-.6 0-1.3.4-1.7.9-.4.4-.7 1.1-.6 1.8.7.1 1.3-.3 1.7-.8z" />
          </svg>
          Continue with Apple
        </button>
      ) : null}
    </div>
  );
}
