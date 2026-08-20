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

export function AskFormPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [form, setForm] = useState<PublicAskForm | 'missing' | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [requesterName, setRequesterName] = useState('');
  const [requesterEmail, setRequesterEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (token === '') {
      setForm('missing');
      return;
    }
    let cancelled = false;
    asks
      .get(token)
      .then((body) => {
        if (!cancelled) setForm(body);
      })
      .catch(() => {
        if (!cancelled) setForm('missing');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || token === '') return;
    setBusy(true);
    setError(null);
    try {
      await asks.submit(token, {
        title: title.trim(),
        description: description.trim(),
        requesterName: requesterName.trim(),
        requesterEmail: requesterEmail.trim(),
      });
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
        />
        <Input
          label="Your email"
          type="email"
          value={requesterEmail}
          onChange={(event) => setRequesterEmail(event.target.value)}
          autoComplete="email"
          required
        />
        <Input
          label="Title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
        />
        <Textarea
          label="Details"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <Button type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Submit'}
        </Button>
      </AuthForm>
    </AuthLayout>
  );
}
