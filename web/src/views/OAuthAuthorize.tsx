/**
 * Consent for a third-party OAuth application.
 *
 * Rendered at GET /oauth/authorize without AppShell: the person is deciding whether to
 * grant another product access, and the workspace chrome would be a distraction and a way
 * to navigate away mid-consent. Signed-out visitors keep this URL on the sign-in screen.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

import { Button } from '~/components';
import {
  createOauthAuthorization,
  loadOauthClientInfo,
  type OauthClientInfo,
} from '~/features/oauth/mutations';
import { ApiError } from '~/sync/api';
import { AuthError, AuthLayout } from './AuthLayout';
import styles from './OAuthAuthorize.module.css';

export function OAuthAuthorize() {
  const [params] = useSearchParams();
  const clientId = params.get('client_id')?.trim() ?? '';
  const redirectUri = params.get('redirect_uri')?.trim() ?? '';
  const responseType = params.get('response_type')?.trim() ?? '';
  const scope = params.get('scope')?.trim() ?? 'read';
  const state = params.get('state')?.trim() ?? '';
  const actor = params.get('actor')?.trim() || 'user';
  const codeChallenge = params.get('code_challenge')?.trim() ?? '';
  const codeChallengeMethod = params.get('code_challenge_method')?.trim() ?? '';

  const [info, setInfo] = useState<OauthClientInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (clientId === '' || redirectUri === '' || responseType !== 'code') {
      setError(
        'This authorization link is missing client_id, redirect_uri, or response_type=code.',
      );
      return;
    }
    let live = true;
    loadOauthClientInfo(clientId)
      .then((app) => {
        if (live) setInfo(app);
      })
      .catch((failure: unknown) => {
        if (!live) return;
        setError(
          failure instanceof ApiError ? failure.message : 'That application could not be found.',
        );
      });
    return () => {
      live = false;
    };
  }, [clientId, redirectUri, responseType]);

  const deny = () => {
    try {
      const target = new URL(redirectUri);
      target.searchParams.set('error', 'access_denied');
      if (state !== '') target.searchParams.set('state', state);
      window.location.assign(target.toString());
    } catch {
      setError('The redirect URI on this request is not a URL.');
    }
  };

  const authorize = async () => {
    if (busy || info === null) return;
    setBusy(true);
    setError(null);
    try {
      const next = await createOauthAuthorization({
        clientId,
        redirectUri,
        responseType,
        scope,
        ...(state === '' ? {} : { state }),
        ...(actor === '' ? {} : { actor }),
        ...(codeChallenge === '' ? {} : { codeChallenge }),
        ...(codeChallengeMethod === '' ? {} : { codeChallengeMethod }),
      });
      window.location.assign(next);
    } catch (failure: unknown) {
      setError(
        failure instanceof ApiError ? failure.message : 'Authorization could not be completed.',
      );
      setBusy(false);
    }
  };

  const scopes = scope
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '');

  return (
    <AuthLayout
      title={info ? `Authorize ${info.name}` : 'Authorize application'}
      subtitle={
        info
          ? `${info.developer ?? info.name} is asking to access this workspace${actor === 'app' ? ' as itself' : ' as you'}.`
          : 'Review the application before granting access.'
      }
    >
      {error ? <AuthError message={error} /> : null}
      {info === null && error === null ? (
        <p className={styles.pending}>Loading application…</p>
      ) : null}
      {info === null ? null : (
        <>
          {info.description ? <p className={styles.description}>{info.description}</p> : null}
          <p className={styles.legend}>This application is requesting:</p>
          <ul className={styles.scopes}>
            {scopes.map((item) => (
              <li key={item}>
                <code>{item}</code>
              </li>
            ))}
          </ul>
          <p className={styles.hint}>
            After you authorize, you will be sent back to <code>{redirectUri}</code>.
          </p>
          <div className={styles.actions}>
            <Button onClick={deny} disabled={busy}>
              Deny
            </Button>
            <Button variant="primary" onClick={() => void authorize()} loading={busy}>
              Authorize
            </Button>
          </div>
        </>
      )}
    </AuthLayout>
  );
}
