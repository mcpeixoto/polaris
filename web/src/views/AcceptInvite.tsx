/**
 * Join a workspace from an invitation link.
 *
 * The token is in the URL because the link is followed from an email, which means this screen
 * has to survive landing on a browser that has never signed in — bouncing to `/signin` would
 * lose the token on the way, and the person would arrive at a workspace they are not in yet
 * with no way back to the invitation.
 *
 * So the screen does both halves. Somebody already signed in sees one button. Somebody who is
 * not chooses between creating an account and signing in, and the invitation is accepted with
 * the same submit — because "you are now signed in, and here is a second form" is where people
 * close the tab.
 *
 * Accepting is a REST call rather than a mutation: it creates the workspace-scoped user that
 * every GraphQL request is authorised against, so there is nothing yet to scope one to. The
 * same reasoning puts sign-in and workspace creation outside the API.
 */

import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router';

import { Button, Input } from '~/components';
import { ApiError, auth, isSignedIn } from '~/sync/api';
import { AuthError, AuthForm, AuthLayout } from './AuthLayout';

export interface AcceptInviteProps {
  /** Called once this account is a member of the workspace. */
  onAccepted: () => void;
}

type Mode = 'register' | 'login';

export function AcceptInvite({ onAccepted }: AcceptInviteProps) {
  const { token = '' } = useParams<{ token: string }>();
  // Read once, at mount. It flips as a side effect of the submit below, and a value that
  // changed mid-render would swap the form out from under the person filling it in.
  const [signedIn] = useState(() => isSignedIn());

  const [mode, setMode] = useState<Mode>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const accept = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!signedIn) {
        const credentials: [string, string] = [email.trim(), password];
        if (mode === 'register') await auth.register(...credentials);
        else await auth.login(...credentials);
      }
      const name = displayName.trim();
      await auth.acceptInvite(token, name === '' ? undefined : name);
      onAccepted();
    } catch (failure) {
      setBusy(false);
      setError(
        failure instanceof ApiError
          ? failure.message
          : 'The invitation could not be accepted. Ask for a new one.',
      );
    }
  };

  if (token === '') {
    return (
      <AuthLayout
        title="That link is incomplete"
        subtitle="An invitation link carries a token. Follow the one in the email exactly as it was sent, or ask for a new invitation."
      />
    );
  }

  return (
    <AuthLayout
      title="Join the workspace"
      subtitle={
        signedIn
          ? 'You have been invited. Accepting adds this account to the workspace.'
          : 'You have been invited. Create an account or sign in, and you will be taken straight in.'
      }
      footer={
        signedIn ? undefined : mode === 'register' ? (
          <>
            Already have an account?{' '}
            <Button variant="ghost" size="sm" onClick={() => setMode('login')}>
              Sign in instead
            </Button>
          </>
        ) : (
          <>
            New to Polaris?{' '}
            <Button variant="ghost" size="sm" onClick={() => setMode('register')}>
              Create an account
            </Button>
          </>
        )
      }
    >
      <AuthForm onSubmit={(event) => void accept(event)}>
        <AuthError message={error} />

        {signedIn ? null : (
          <>
            <Input
              label="Email"
              type="email"
              name="email"
              value={email}
              autoComplete="email"
              autoFocus
              required
              onChange={(event) => setEmail(event.target.value)}
            />
            <Input
              label="Password"
              type="password"
              name="password"
              value={password}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              required
              onChange={(event) => setPassword(event.target.value)}
            />
          </>
        )}

        <Input
          label="Your name in this workspace"
          value={displayName}
          placeholder="Ada Lovelace"
          hint="Optional. Leave it blank to keep the name you already use."
          autoComplete="name"
          onChange={(event) => setDisplayName(event.target.value)}
        />

        <Button type="submit" variant="primary" fullWidth loading={busy}>
          {signedIn
            ? 'Join workspace'
            : mode === 'register'
              ? 'Create account and join'
              : 'Sign in and join'}
        </Button>
      </AuthForm>
    </AuthLayout>
  );
}
