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
 *
 * ## The two refusals that pressing the button again cannot fix
 *
 * They are also the two most likely ones, and the screen used to treat both as retryable — a
 * red sentence over a button that would fail identically for ever, and, for somebody already
 * signed in, no footer at all, so the card was a dead end with no sign-out and no way back.
 *
 *  - `FORBIDDEN` is "this invitation was sent to a different email address". The invitation is
 *    fine; the session is the wrong one. So the answer is to drop the session and land back on
 *    this same `/invite/:token` URL as a stranger, which is the form that can redeem it.
 *  - `VALIDATION` on `token` is "this invitation is no longer valid". Nothing on this screen
 *    can change that, so the form goes away and what is left is an explanation and a route
 *    back into the product.
 *
 * Everything else keeps the form, because everything else may work next time.
 */

import { useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';

import { Button, Input } from '~/components';
import { looksLikeEmail } from '~/features/auth/validation';
import { ApiError, auth, isSignedIn } from '~/sync/api';
import { AuthError, AuthForm, AuthLayout, authSubmitClass } from './AuthLayout';
import styles from './AuthLayout.module.css';

export interface AcceptInviteProps {
  /**
   * Called once this account is a member of the workspace, with the workspace it just
   * joined — the boot sequence has no other way to know that the one to open is the one the
   * link was for rather than whichever this browser last had open.
   */
  onAccepted: (workspaceId?: string) => void;
}

type Mode = 'register' | 'login';

/** The credentials fields, which exist only while nobody is signed in. */
type Field = 'email' | 'password';

/**
 * A refusal this screen cannot retry its way out of. `null` is every other outcome,
 * including the ordinary failures that keep the form.
 */
type Dead = 'wrong-account' | 'spent' | null;

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
  const [problem, setProblem] = useState<{ field: Field; message: string } | null>(null);
  const [dead, setDead] = useState<Dead>(null);
  const [busy, setBusy] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const messageFor = (field: Field) => (problem?.field === field ? problem.message : undefined);
  const clear = (field: Field) => {
    if (problem?.field === field) setProblem(null);
  };

  const refuse = (field: Field, message: string) => {
    setProblem({ field, message });
    (field === 'email' ? emailRef : passwordRef).current?.focus();
  };

  /**
   * Drop the session and come back to this URL as a stranger.
   *
   * A reload rather than a state flip, because `signedIn` is read once at mount on purpose,
   * and because the boot sequence and the auth client both hold session state this screen
   * does not own. The URL carries the token, so the invitation survives the trip.
   */
  const signOutAndRetry = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await auth.logout();
    } catch {
      // The local session is cleared either way, and the whole point of this button is to
      // get back to the form. A failed server-side logout is not a reason to stay stuck.
    }
    window.location.reload();
  };

  const accept = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    if (!signedIn) {
      if (email.trim() === '') {
        refuse('email', 'Enter the email this invitation was sent to.');
        return;
      }
      if (!looksLikeEmail(email)) {
        refuse('email', 'That does not look like an email address.');
        return;
      }
      if (password === '') {
        refuse(
          'password',
          mode === 'register' ? 'Choose a password for your account.' : 'Enter your password.',
        );
        return;
      }
    }

    setProblem(null);
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
      if (!(failure instanceof ApiError)) return;

      if (failure.code === 'FORBIDDEN') {
        setDead('wrong-account');
        return;
      }
      if (failure.code === 'VALIDATION' && failure.field === 'token') {
        setDead('spent');
        return;
      }
      // Field-scoped and retryable: it belongs on the control, not in the banner above it.
      const scoped = asField(failure.field);
      if (scoped !== null && !signedIn) {
        setError(null);
        refuse(scoped, failure.message);
      }
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

  // A spent invitation: nothing on the form can redeem it, so the form goes.
  if (dead === 'spent') {
    return (
      <AuthLayout
        title="This invitation has expired"
        subtitle="Invitations are one-time and they lapse. Ask whoever invited you to send a new one — the link in that email will bring you straight back here."
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
      //
      // There is always something here. Somebody already signed in used to get no footer at
      // all, which made a refusal a card with one red sentence and a button that could not
      // work — no sign out, no way back to the workspace they already have.
      footer={
        signedIn ? (
          <Link to="/">Back to Polaris</Link>
        ) : mode === 'register' ? (
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
      <AuthForm onSubmit={(event) => void accept(event)} step={signedIn ? 'signed-in' : mode}>
        <AuthError message={error} />

        {/* The invitation is fine and the session is the wrong one, so the way forward is to
            stop being this account. Under the server's sentence rather than instead of it:
            the server says which side of the mismatch it saw, and this says what to do. */}
        {dead === 'wrong-account' ? (
          <>
            <p className={styles.refusal}>
              This invitation belongs to a different email address. Sign out and follow the link
              again with the account it was sent to — the invitation stays where it is.
            </p>
            <Button
              variant="secondary"
              fullWidth
              loading={busy}
              onClick={() => void signOutAndRetry()}
            >
              Sign out and use another account
            </Button>
          </>
        ) : null}

        {signedIn ? null : (
          <>
            <Input
              ref={emailRef}
              label="Email"
              type="email"
              name="email"
              value={email}
              autoComplete="email"
              error={messageFor('email')}
              autoFocus
              required
              onChange={(event) => {
                setEmail(event.target.value);
                clear('email');
              }}
            />
            <Input
              ref={passwordRef}
              label="Password"
              type="password"
              name="password"
              value={password}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              error={messageFor('password')}
              required
              onChange={(event) => {
                setPassword(event.target.value);
                clear('password');
              }}
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

/** The server's field name, if this screen has a control to put it on. */
function asField(field: string | undefined): Field | null {
  return field === 'email' || field === 'password' ? field : null;
}
