/**
 * Create an account.
 *
 * An account, not a workspace: the two are separate tables and separate steps, because one
 * account belongs to many workspaces. Registering signs you in with nothing to look at yet,
 * and the boot sequence sends you straight to `CreateWorkspace` — or, if you arrived from an
 * invitation, to the workspace that invited you.
 *
 * The confirmation field is the one piece of validation that could only be done here. A
 * mistyped password is not something the API can detect — both values are perfectly valid —
 * and the failure lands a week later as somebody locked out of an account they thought they
 * had. The other two checks below could have been the server's and are not, because
 * `AuthForm` is `noValidate`: without them a four-character password made a round trip to be
 * told about a rule the hint under the field had already stated.
 *
 * Where a refusal lands is one decision for both sources. The submit's own checks and the
 * server's `ApiError.field` both go through `problem`, so a password the server calls too
 * short is marked on the password field exactly as a mismatch is marked on the confirmation.
 * `AuthError` keeps the failures that name no field — chiefly the invite-only refusal below.
 *
 * **This form is refused on a default install, and that is not a fault.**
 * `POLARIS_REGISTRATION_MODE` is `invite`, so the only people who may register are somebody
 * holding an invitation and the very first account on an empty server. The client cannot know
 * which install it is talking to — nothing exposes the mode — so the screen offers the form
 * and reads the answer, and a refusal is presented as the policy it is rather than as a
 * failure to retry. The invitation link is not a route *to* this screen: it registers, joins
 * and signs in on one submit, which is why the copy points at the link rather than telling
 * somebody to come back here with a token.
 */

import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';

import { Button, Input } from '~/components';
import { SocialSignIn } from '~/features/auth/SocialSignIn';
import { MIN_PASSWORD_LENGTH, looksLikeEmail } from '~/features/auth/validation';
import { ApiError, auth } from '~/sync/api';
import { AuthError, AuthForm, AuthLayout, authSubmitClass } from './AuthLayout';
import styles from './AuthLayout.module.css';

export interface SignUpProps {
  /** Called once the account exists and the session is live. */
  onSignedIn: () => void;
}

/** The three fields a submit — or the server — can refuse. */
type Field = 'email' | 'password' | 'confirmation';

export function SignUp({ onSignedIn }: SignUpProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  /** One message at a time, on the field it is about. Same shape as CreateWorkspace's. */
  const [problem, setProblem] = useState<{ field: Field; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Set when the server said this install does not take open registrations.
   *
   * Kept apart from `error` because it is a different kind of answer: `error` is something
   * that went wrong and may not next time, and this is a standing fact about the server that
   * pressing the button again cannot change.
   */
  const [refused, setRefused] = useState(false);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);

  const fieldRef = (field: Field) =>
    field === 'email' ? emailRef : field === 'password' ? passwordRef : confirmationRef;
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

    // In submit order, so the cursor lands on the first thing wrong rather than on the last
    // check that happened to run.
    if (email.trim() === '') {
      refuse('email', 'Enter the email this account should belong to.');
      return;
    }
    if (!looksLikeEmail(email)) {
      refuse('email', 'That does not look like an email address.');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      refuse('password', `Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmation) {
      refuse('confirmation', 'These two do not match.');
      return;
    }

    setProblem(null);
    setBusy(true);
    setError(null);
    setRefused(false);
    try {
      await auth.register(email.trim(), password);
      onSignedIn();
    } catch (failure) {
      setBusy(false);
      // FORBIDDEN from this endpoint means one thing: the server is invite-only and this
      // caller has no invitation. Anything else is an ordinary failure.
      setRefused(failure instanceof ApiError && failure.code === 'FORBIDDEN');
      // A field-scoped refusal — "that does not look like an email address", "use at least 10
      // characters" — goes on its field, the way this screen's own checks do. Sending it to
      // the banner instead is two treatments for one class of problem on one card.
      const scoped = failure instanceof ApiError ? asField(failure.field) : null;
      if (scoped !== null && failure instanceof ApiError) {
        refuse(scoped, failure.message);
        return;
      }
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
        {/* Under the server's own sentence rather than instead of it: the server says what
            the rule is, and this says what to do about it — which is the part the person
            reading a refusal actually needs, and the part the server cannot know. Retrying
            with a different address is legitimate, so the form stays. */}
        {refused ? (
          <p className={styles.refusal}>
            An invitation link signs you up on its own — follow the one you were sent rather than
            creating an account first. If you were invited at a different address, use that one
            here.
          </p>
        ) : null}
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
          hint={`At least ${MIN_PASSWORD_LENGTH} characters — a passphrase is easiest.`}
          error={messageFor('password')}
          // `new-password` rather than `current-password`, which is what makes a password
          // manager offer to generate one instead of offering the one you already use.
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          onChange={(event) => {
            setPassword(event.target.value);
            clear('password');
          }}
        />
        <Input
          ref={confirmationRef}
          label="Confirm password"
          type="password"
          name="confirmation"
          value={confirmation}
          error={messageFor('confirmation')}
          autoComplete="new-password"
          required
          onChange={(event) => {
            setConfirmation(event.target.value);
            clear('confirmation');
          }}
        />
        <Button
          type="submit"
          variant="primary"
          fullWidth
          loading={busy}
          className={authSubmitClass}
        >
          Create account
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
