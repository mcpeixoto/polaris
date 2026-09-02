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
import { Link, useParams } from 'react-router';

import { Button, Input } from '~/components';
import { ApiError, auth, isSignedIn } from '~/sync/api';
import { AuthError, AuthForm, AuthLayout, authSubmitClass } from './AuthLayout';

export interface AcceptInviteProps {
  /**
   * Called once this account is a member of the workspace, with the workspace it just
   * joined — the boot sequence has no other way to know that the one to open is the one the
   * link was for rather than whichever this browser last had open.
   */
  onAccepted: (workspaceId?: string) => void;
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
      const name = displayName.trim() === '' ? undefined : displayName.trim();

      // Registering redeems the invitation; it does not merely precede it.
      //
      // `POST /auth/register` takes the token and creates the account AND the membership in
      // one transaction, which is the only arrangement with no half-state to land in: the
      // two-call version left a refused registration holding a token, or an account on a
      // server that admits nobody, belonging to no workspace, with an invitation that may
      // since have expired — and there is no screen for that.
      //
      // So this branch must NOT call `acceptInvite` afterwards. The membership is already
      // there and the token is already spent, so the second call can only fail, and it would
      // fail with "this invitation cannot be used" on a join that had in fact just worked.
      if (!signedIn && mode === 'register') {
        // A brand-new account belongs to exactly the workspace that invited it, so the one
        // workspace the register call comes back with is the one to open.
        const registered = await auth.register(email.trim(), password, {
          inviteToken: token,
          displayName: name,
        });
        onAccepted(registered.workspaces[0]?.id);
        return;
      }

      // The other two paths still accept explicitly. Somebody who already has an account —
      // whether they were signed in when they followed the link, or have just signed in on
      // this form — is joining a second workspace, and there is no registration to fold the
      // membership into.
      if (!signedIn) await auth.login(email.trim(), password);
      const joined = await auth.acceptInvite(token, name);
      onAccepted(joined.workspaceId);
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
        subtitle="An invitation link carries a token. Follow the one in the email exactly as it was sent, or ask whoever invited you for a new one."
        // A dead end otherwise: this screen has no form, no button and — until now — nothing
        // to click. Somebody who already has an account and mangled the link on the way here
        // does not need a new invitation at all, they need the sign-in page.
        footer={
          <>
            Already have an account? <Link to="/signin">Sign in</Link>
            {' · '}
            <Link to="/">What is Polaris?</Link>
          </>
        }
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
      // Switching modes clears the failure with it. A registration refused as invite-only,
      // left standing over a sign-in form, is a red sentence about a flow the reader has just
      // left — and the obvious next move after that refusal is exactly this button.
      footer={
        signedIn ? undefined : mode === 'register' ? (
          <>
            Already have an account?{' '}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setError(null);
                setMode('login');
              }}
            >
              Sign in instead
            </Button>
          </>
        ) : (
          <>
            New to Polaris?{' '}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setError(null);
                setMode('register');
              }}
            >
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

        {/* autoFocus only when it is the first field on the form. Somebody already signed in
            sees this and nothing above it, and a screen that arrives with nothing focused
            leaves a keyboard user tabbing in from the address bar. */}
        <Input
          label="Your name in this workspace"
          name="name"
          value={displayName}
          placeholder="Ada Lovelace"
          hint="Optional. Leave it blank to keep the name you already use."
          autoComplete="name"
          autoFocus={signedIn}
          onChange={(event) => setDisplayName(event.target.value)}
        />

        <Button
          type="submit"
          variant="primary"
          fullWidth
          loading={busy}
          className={authSubmitClass}
        >
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
