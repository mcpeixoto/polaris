/**
 * The provider buttons under the email and password form.
 *
 * Rendered from what the server says it offers, not from what this build knows how to draw.
 * A deployment with no Google client id gets no Google button — the alternative is a button
 * that opens a popup, completes a sign-in at Google, and then fails against a route that
 * answers 404, which is the worst of both.
 *
 * The failure here is drawn by `AuthError`, the same component the password form above it
 * uses, rather than by a red line of this file's own. There is one card, and a sign-in that
 * failed at Google is the same kind of news as a sign-in that failed against the password —
 * two different-looking answers to the same question is how a form comes to look assembled
 * from parts. Importing a view's component from a feature is the layering this codebase
 * already accepts for exactly this reason; see `features/projects/ProjectStatusSettings`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { isDesktop, signInWithGoogleDesktop } from '~/platform/runtime';
import { ApiError, auth } from '~/sync/api';
import { AuthError } from '~/views/AuthLayout';

import { fetchAuthProviders } from './providers';
import {
  appleFailureMessage,
  mountGoogleButton,
  prepareApple,
  signInWithApple,
  type Assertion,
} from './social';
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
    // Desktop hosts Google through the system browser (see signInWithGoogleDesktop), not
    // through GIS: the packaged app's scheme and CSP cannot load accounts.google.com, and
    // pretending otherwise produced the "content blocker" error on every Windows install.
    if (isDesktop) return;
    const slot = googleSlot.current;
    if (!providers.includes('google') || googleClientId === '' || slot === null) return;
    mountGoogleButton(
      slot,
      googleClientId,
      (assertion) => void exchange('google', assertion),
      setError,
    ).catch(() => {
      // `void` used to stand here, which meant a script that never arrived became an
      // unhandled rejection in the console and an empty rectangle on the page — the reader
      // was left clicking at nothing with no idea why. Google's script is a third-party
      // origin, and a content blocker or a strict privacy mode refusing it is the ordinary
      // case, not the exotic one.
      setError('Google sign-in could not load. A content blocker is the usual cause.');
    });
  }, [providers, googleClientId, exchange]);

  // Apple's SDK is loaded and initialised here rather than on the click, because
  // `AppleID.auth.signIn()` opens a popup and a browser only permits that while it can still
  // see the gesture. Awaiting a script download inside the handler is the difference between
  // a sign-in window and a silently blocked one.
  //
  // Skipped on desktop for the same CSP reason as Google: the script cannot load, and a
  // click that only ever says "content blocker" is worse than a button that says so up front.
  useEffect(() => {
    if (isDesktop) return;
    if (!providers.includes('apple') || appleClientId === '') return;
    void prepareApple(appleClientId).catch(() => {
      // Left to the click to report. An SDK that failed to load is not something to
      // announce on a page the reader may be about to use a password on.
    });
  }, [providers, appleClientId]);

  const onGoogleDesktop = useCallback(() => {
    if (busy || googleClientId === '') return;
    setBusy(true);
    setError(null);
    void signInWithGoogleDesktop(googleClientId)
      .then((result) => {
        if (result === null) {
          setBusy(false);
          setError('Google sign-in is unavailable in this build.');
          return;
        }
        if (!result.ok) {
          setBusy(false);
          if (!result.cancelled) setError(result.reason);
          return;
        }
        return exchange('google', { idToken: result.idToken, nonce: result.nonce });
      })
      .catch(() => {
        setBusy(false);
        setError('Google sign-in failed. Try again.');
      });
  }, [busy, exchange, googleClientId]);

  const onApple = useCallback(() => {
    // Guarded here rather than by `disabled` on the element; see the button below.
    if (busy) return;
    if (isDesktop) {
      setError(
        'Sign in with Apple is not available in the desktop app yet. Use email and password, or Continue with Google.',
      );
      return;
    }
    setError(null);
    // Not awaited before `signInWithApple`: the popup has to be opened in the same task as
    // the click, or the browser blocks it.
    signInWithApple()
      .then((assertion) => exchange('apple', assertion))
      .catch((failure: unknown) => {
        // Apple rejects with a plain object, not an Error. `appleFailureMessage` returns
        // null for the cases that are somebody changing their mind.
        const message = appleFailureMessage(failure);
        if (message !== null) setError(message);

        // Then set the SDK up again for the next click. The preparation on mount happens
        // once, so a script that was still downloading — or that failed on a flaky
        // connection — left the button dead for the rest of the session: every click after
        // it said "not ready yet" and opened nothing. Re-initialising costs one call and a
        // fresh nonce, and the nonce is only ever read by the attempt that follows it.
        void prepareApple(appleClientId).catch(() => {
          // Same silence as on mount: the click that needs it is the one that reports it.
        });
      });
  }, [appleClientId, busy, exchange]);

  if (providers.length === 0) return null;

  return (
    <div className={styles.wrap}>
      {/* No `role="separator"`. A separator is a structural role with no accessible name, so
          the word inside it was being announced as a divider or not at all — and "or" is the
          only thing on this card that says the two halves are alternatives rather than steps.
          As plain text in the flow it is simply read. The rules either side are pseudo-
          elements and were never in the accessibility tree to begin with. */}
      <div className={styles.divider}>
        <span>or</span>
      </div>

      <AuthError message={error} />

      {/* On the web, Google renders its own button in here — their terms require theirs, not
          ours. On desktop we draw the button (same shape as Apple) and the shell opens the
          system browser; GIS cannot run under polaris-app://. */}
      {providers.includes('google') ? (
        isDesktop ? (
          <button
            type="button"
            className={styles.google}
            aria-disabled={busy ? true : undefined}
            aria-busy={busy ? true : undefined}
            onClick={onGoogleDesktop}
          >
            <GoogleMark />
            Continue with Google
          </button>
        ) : (
          <div ref={googleSlot} className={styles.slot} />
        )
      ) : null}

      {providers.includes('apple') && appleClientId !== '' ? (
        // `aria-disabled`, not `disabled`, for the reason spelled out in Button: a disabled
        // element cannot hold focus, so a keyboard user who pressed this is dropped to the
        // top of the document the instant the exchange starts. The click handler refuses
        // instead, which is the same guarantee without the focus loss.
        <button
          type="button"
          className={styles.apple}
          aria-disabled={busy ? true : undefined}
          aria-busy={busy ? true : undefined}
          onClick={onApple}
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

/** Google's "G" mark, four colours, as their branding asks for on a custom button. */
function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
      <path
        fill="#4285F4"
        d="M15.7 8.2c0-.5-.05-1.1-.14-1.6H8v3h4.3c-.19 1-.75 1.9-1.6 2.4v2h2.6c1.5-1.4 2.4-3.5 2.4-5.8z"
      />
      <path
        fill="#34A853"
        d="M8 16c2.2 0 4-0.7 5.3-2l-2.6-2c-.7.5-1.6.8-2.7.8-2.1 0-3.8-1.4-4.4-3.3H.9v2.1C2.2 14.2 4.9 16 8 16z"
      />
      <path
        fill="#FBBC05"
        d="M3.6 9.5c-.2-.5-.3-1-.3-1.5s.1-1.1.3-1.5V4.4H.9C.3 5.5 0 6.7 0 8s.3 2.5.9 3.6l2.7-2.1z"
      />
      <path
        fill="#EA4335"
        d="M8 3.2c1.2 0 2.3.4 3.1 1.2l2.3-2.3C13.9.8 12.1 0 8 0 4.9 0 2.2 1.8.9 4.4l2.7 2.1C4.2 4.6 5.9 3.2 8 3.2z"
      />
    </svg>
  );
}
