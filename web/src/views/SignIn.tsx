/**
 * Sign in.
 *
 * Email and password, and nothing else — magic links and passkeys are M1, and the account
 * table already has the credential rows waiting for them. The form is the platform's: a real
 * `<form>` with a submit button, so Enter works because HTML says it does rather than because
 * somebody wired a key handler, which in this codebase they may not.
 *
 * Failures are reported exactly as the server phrased them. A sign-in form that says "invalid
 * credentials" when the real answer is "your account is suspended" costs a support ticket, and
 * the API already distinguishes the two.
 */

import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';

import { Button, Input } from '~/components';
import { SocialSignIn } from '~/features/auth/SocialSignIn';
import { ApiError, auth } from '~/sync/api';
import { AuthError, AuthForm, AuthLayout } from './AuthLayout';

export interface SignInProps {
  /** Called once the session exists. The boot sequence takes it from there. */
  onSignedIn: () => void;
}

export function SignIn({ onSignedIn }: SignInProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await auth.login(email.trim(), password);
      onSignedIn();
    } catch (failure) {
      setBusy(false);
      setError(failure instanceof ApiError ? failure.message : 'That did not work. Try again.');
      emailRef.current?.focus();
    }
  };

  return (
    <AuthLayout
      title="Sign in to Polaris"
      subtitle="Your issues, your team, and everything you left open."
      footer={
        <>
          New here? <Link to="/signup">Create an account</Link>
          {' · '}
          <Link to="/">What is Polaris?</Link>
        </>
      }
    >
      <AuthForm onSubmit={(event) => void onSubmit(event)}>
        <AuthError message={error} />
        <Input
          ref={emailRef}
          label="Email"
          type="email"
          name="email"
          value={email}
          // The browser's own credential manager is the best password manager most people
          // have. Naming the fields the way it expects is what lets it offer to fill them.
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
          autoComplete="current-password"
          required
          onChange={(event) => setPassword(event.target.value)}
        />
        <Button type="submit" variant="primary" fullWidth loading={busy}>
          Sign in
        </Button>
      </AuthForm>

      {/* Rendered from what the server offers. A deployment with no provider configured
          gets nothing here, not an empty rule with a heading over it. */}
      <SocialSignIn onSignedIn={onSignedIn} />
    </AuthLayout>
  );
}
