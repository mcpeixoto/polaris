/**
 * Public Asks intake. The token in the URL is the credential; this screen works signed out.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';

import { Button, Input, Textarea } from '~/components';
import { ApiError, asks } from '~/sync/api';
import { AuthError, AuthForm, AuthLayout } from './AuthLayout';

interface PublicAskForm {
  name: string;
  description: string;
  teamName: string;
}

/**
 * `missing` is the server saying this token is not a live form; `unreachable` is every
 * other way the lookup can fail.
 *
 * Keeping them apart matters more here than anywhere else in the product. The requester is
 * a stranger with one link and no account, so the page is the only thing that can tell them
 * what to do next — and "the link may have been retired" is advice that ends the journey.
 * Saying it because the request was rate limited, or because the server was restarting,
 * sends somebody away from a form that works and would have worked again a second later.
 */
type LoadFailure = 'missing' | 'unreachable';

export function AskFormPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [form, setForm] = useState<PublicAskForm | LoadFailure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [requesterName, setRequesterName] = useState('');
  const [requesterEmail, setRequesterEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // Only true once a send has actually been attempted. Validating from the first keystroke
  // tells a stranger their name is wrong before they have finished typing it.
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (token === '') {
      setForm('missing');
      return;
    }
    let cancelled = false;
    setForm(null);
    asks
      .get(token)
      .then((body) => {
        if (!cancelled) setForm(body);
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        setForm(
          failure instanceof ApiError && failure.code === 'NOT_FOUND' ? 'missing' : 'unreachable',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  /*
   * What the server is actually sent, which is not what the browser validated.
   *
   * Every field goes over the wire `.trim()`ed, and native `required` only asks whether the
   * control is non-empty — so a title of three spaces passed validation and filed an issue
   * with no title at all, on the one screen in the product a stranger uses. Validating the
   * trimmed value is validating the thing that gets stored.
   */
  const trimmed = {
    title: title.trim(),
    description: description.trim(),
    requesterName: requesterName.trim(),
    requesterEmail: requesterEmail.trim(),
  };

  // Reported through `Input`'s own `error` prop rather than as loose text, so each message
  // gets Field's treatment and the `aria-describedby` wiring that points the field at it.
  const problems = {
    requesterName: trimmed.requesterName === '' ? 'Enter your name' : undefined,
    // Not a format check. The browser already refuses a value with no "@" via type="email",
    // and a client-side pattern that is stricter than the server's is a form that rejects
    // addresses which would have worked.
    requesterEmail: trimmed.requesterEmail === '' ? 'Enter your email' : undefined,
    title: trimmed.title === '' ? 'Say what you need in a few words' : undefined,
  };
  const invalid =
    problems.requesterName !== undefined ||
    problems.requesterEmail !== undefined ||
    problems.title !== undefined;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || token === '') return;
    setAttempted(true);
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      await asks.submit(token, trimmed);
      setDone(true);
    } catch (failure) {
      setBusy(false);
      setError(
        failure instanceof ApiError
          ? failure.message
          : 'That request could not be sent. Try again.',
      );
    }
  };

  if (token === '' || form === 'missing') {
    return (
      <AuthLayout
        title="This form is no longer available"
        subtitle="The link may have been retired, or it was never valid. Ask whoever sent it for a new one."
      />
    );
  }

  if (form === 'unreachable') {
    return (
      <AuthLayout
        title="This form could not be loaded"
        subtitle="The link is fine — we could not reach the server just now. Try again in a moment."
      >
        <Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
      </AuthLayout>
    );
  }

  if (form === null) {
    return <AuthLayout title="Asks" subtitle="Loading the form…" />;
  }

  if (done) {
    return (
      <AuthLayout
        title="Request sent"
        subtitle={`Thanks. ${form.teamName} will see it in triage.`}
      />
    );
  }

  return (
    <AuthLayout
      title={form.name}
      subtitle={
        form.description === ''
          ? `This files an issue for ${form.teamName}. You do not need an account.`
          : form.description
      }
    >
      <AuthForm onSubmit={(event) => void submit(event)}>
        <AuthError message={error} />
        <Input
          label="Your name"
          value={requesterName}
          onChange={(event) => setRequesterName(event.target.value)}
          autoComplete="name"
          required
          error={attempted ? problems.requesterName : undefined}
        />
        <Input
          label="Your email"
          type="email"
          value={requesterEmail}
          onChange={(event) => setRequesterEmail(event.target.value)}
          autoComplete="email"
          required
          error={attempted ? problems.requesterEmail : undefined}
        />
        <Input
          label="Title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          error={attempted ? problems.title : undefined}
        />
        <Textarea
          label="Details"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        {/* `loading`, not `disabled`: a disabled button cannot hold focus, so the browser
            drops the requester to the top of the document the moment they press send.

            The label is "Submit", which the copy rules name as a label a button may not
            carry — "buttons are verbs and name their outcome". It stays because this form's
            existing tests assert the accessible name and a pre-existing test may not be
            edited to accommodate a change. Renaming it to "Send request" is right and is
            the one-line change to make the moment those assertions can move with it. */}
        <Button type="submit" loading={busy}>
          Submit
        </Button>
      </AuthForm>
    </AuthLayout>
  );
}
