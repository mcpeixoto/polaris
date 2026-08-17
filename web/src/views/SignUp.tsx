/**
 * Create an account.
 *
 * An account, not a workspace: the two are separate tables and separate steps, because one
 * account belongs to many workspaces. Registering signs you in with nothing to look at yet,
 * and the boot sequence sends you straight to `CreateWorkspace` — or, if you arrived from an
 * invitation, to the workspace that invited you.
 *
 * The confirmation field is the one piece of validation done here rather than at the server.
 * A mistyped password is not something the API can detect — both values are perfectly valid —
 * and the failure lands a week later as somebody locked out of an account they thought they
 * had.
 */

import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';

import { Button, Input } from '~/components';
import { ApiError, auth } from '~/sync/api';
import { AuthError, AuthForm, AuthLayout } from './AuthLayout';

export interface SignUpProps {
  /** Called once the account exists and the session is live. */
  onSignedIn: () => void;
}

/** Matches the server's floor. Stated in the hint, so nobody discovers it by being refused. */
const MIN_PASSWORD_LENGTH = 10;

export function SignUp({ onSignedIn }: SignUpProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [mismatch, setMismatch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirmationRef = useRef<HTMLInputElement>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    if (password !== confirmation) {
      setMismatch('These two do not match.');
      confirmationRef.current?.focus();
      return;
    }
    setMismatch(null);
    setBusy(true);
    setError(null);
    try {
      await auth.register(email.trim(), password);
      onSignedIn();
    } catch (failure) {
      setBusy(false);
      setError(failure instanceof ApiError ? failure.message : 'That did not work. Try again.');
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="One account, as many workspaces as you are invited to."
      footer={
        <>
          Already have one? <Link to="/signin">Sign in</Link>
        </>
      }
    >
      <AuthForm onSubmit={(event) => void onSubmit(event)}>
        <AuthError message={error} />
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
          hint={`At least ${MIN_PASSWORD_LENGTH} characters — a passphrase is easiest.`}
          // `new-password` rather than `current-password`, which is what makes a password
          // manager offer to generate one instead of offering the one you already use.
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          onChange={(event) => setPassword(event.target.value)}
        />
        <Input
          ref={confirmationRef}
          label="Confirm password"
          type="password"
          name="confirmation"
          value={confirmation}
          error={mismatch ?? undefined}
          autoComplete="new-password"
          required
          onChange={(event) => {
            setConfirmation(event.target.value);
            if (mismatch !== null) setMismatch(null);
          }}
        />
        <Button type="submit" variant="primary" fullWidth loading={busy}>
          Create account
        </Button>
      </AuthForm>
    </AuthLayout>
  );
}
