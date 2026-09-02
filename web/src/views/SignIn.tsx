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
 *
 * ## Where a failure lands, and why it is not always the banner
 *
 * A refusal that is about one field belongs on that field: `Input` marks the control
 * `aria-invalid`, wires `aria-describedby`, and clears the message on the next keystroke. So
 * the submit's own checks and the server's `ApiError.field` both go through `problem`, and
 * `AuthError` is left for the failures that name no field — a suspended account, a server
 * that did not answer.
 *
 * Credentials that are simply wrong name no field, and the cursor still should not go back to
 * the email: the address is almost certainly right and the password is the thing to retype.
 * So that one case focuses the password and selects it, which is what makes the next attempt
 * one keystroke rather than a tab and a triple-click.
 */

import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';

import { Button, Input } from '~/components';
import { SocialSignIn } from '~/features/auth/SocialSignIn';
import { looksLikeEmail } from '~/features/auth/validation';
import { ApiError, auth } from '~/sync/api';
import { AuthError, AuthForm, AuthLayout, authSubmitClass } from './AuthLayout';

export interface SignInProps {
  /** Called once the session exists. The boot sequence takes it from there. */
  onSignedIn: () => void;
}

/** The two fields a submit — or the server — can refuse. */
type Field = 'email' | 'password';

export function SignIn({ onSignedIn }: SignInProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** One message at a time, on the field it is about. Same shape as CreateWorkspace's. */
  const [problem, setProblem] = useState<{ field: Field; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const fieldRef = (field: Field) => (field === 'email' ? emailRef : passwordRef);
  const messageFor = (field: Field) => (problem?.field === field ? problem.message : undefined);
  const clear = (field: Field) => {
    if (problem?.field === field) setProblem(null);
  };

  const refuse = (field: Field, message: string) => {
    setProblem({ field, message });
    fieldRef(field).current?.focus();
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    if (email.trim() === '') {
      refuse('email', 'Enter the email you signed up with.');
      return;
    }
    if (!looksLikeEmail(email)) {
      refuse('email', 'That does not look like an email address.');
      return;
    }
    if (password === '') {
      refuse('password', 'Enter your password.');
      return;
    }

    setProblem(null);
    setBusy(true);
    setError(null);
    try {
      await auth.login(email.trim(), password);
      onSignedIn();
    } catch (failure) {
      setBusy(false);
      // The server scopes what it can: "that does not look like an email address" arrives
      // with `field: 'email'`. Sending it to the banner while the same screen's own checks
      // mark the field is two treatments for one class of problem.
      const scoped = failure instanceof ApiError ? asField(failure.field) : null;
      if (scoped !== null && failure instanceof ApiError) {
        refuse(scoped, failure.message);
        return;
      }
      setError(failure instanceof ApiError ? failure.message : 'That did not work. Try again.');
      // Field-less, so the banner says it — and the cursor goes where the correction is.
      passwordRef.current?.focus();
      passwordRef.current?.select();
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
          autoComplete="current-password"
          error={messageFor('password')}
          required
          onChange={(event) => {
            setPassword(event.target.value);
            clear('password');
          }}
        />
        <Button
          type="submit"
          variant="primary"
          fullWidth
          loading={busy}
          className={authSubmitClass}
        >
          Sign in
        </Button>
      </AuthForm>

      {/* Rendered from what the server offers. A deployment with no provider configured
          gets nothing here, not an empty rule with a heading over it. */}
      <SocialSignIn onSignedIn={onSignedIn} />
    </AuthLayout>
  );
}

/** The server's field name, if this screen has a control to put it on. */
function asField(field: string | undefined): Field | null {
  return field === 'email' || field === 'password' ? field : null;
}
