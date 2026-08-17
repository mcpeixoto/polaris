/**
 * Create a workspace.
 *
 * One transaction on the server makes the workspace, the first team, five default statuses
 * and the user profile that belongs to the account creating it — because a workspace missing
 * any of those is not something anybody can use, and a partial failure would strand an
 * account somewhere it can neither work nor leave.
 *
 * The two derived fields are the whole design of this screen. The workspace address and the
 * team key are both generated from names as they are typed, and both stop being generated the
 * moment somebody edits them. That is what makes a suggestion a suggestion: a field that
 * silently reverts your correction is worse than one that was never filled in, and a field
 * you have to fill in yourself for no reason is a step nobody enjoys.
 */

import { useState, type FormEvent } from 'react';

import { Button, Input } from '~/components';
import { ApiError, auth } from '~/sync/api';
import { AuthError, AuthFieldPair, AuthForm, AuthLayout } from './AuthLayout';

export interface CreateWorkspaceProps {
  /** Called once the workspace exists. The boot sequence opens it. */
  onCreated: () => void;
}

/** The server's rule, restated so the hint is not a guess: 2–48 lowercase, digits, hyphens. */
const URL_KEY_MAX = 48;

/** The server's rule for a team key: 1–8, starts with a letter, uppercase letters and digits. */
const TEAM_KEY_MAX = 8;

export function CreateWorkspace({ onCreated }: CreateWorkspaceProps) {
  const [name, setName] = useState('');
  const [urlKey, setUrlKey] = useState<string | null>(null);
  const [userName, setUserName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [teamKey, setTeamKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Held as null until edited, so the suggestion keeps following the name it is derived from
  // and stops the instant somebody disagrees with it.
  const effectiveUrlKey = urlKey ?? suggestUrlKey(name);
  const effectiveTeamName = teamName.trim() === '' ? name : teamName;
  const effectiveTeamKey = teamKey ?? suggestTeamKey(effectiveTeamName);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await auth.createWorkspace({
        name: name.trim(),
        urlKey: effectiveUrlKey,
        userName: userName.trim(),
        // The browser knows this and the server would otherwise default everyone to UTC,
        // which makes "due today" mean the wrong day for most of the world.
        userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        firstTeamName: effectiveTeamName.trim(),
        firstTeamKey: effectiveTeamKey,
      });
      onCreated();
    } catch (failure) {
      setBusy(false);
      setError(
        failure instanceof ApiError
          ? failure.message
          : 'The workspace could not be created. Try again.',
      );
    }
  };

  const ready = name.trim() !== '' && userName.trim() !== '' && effectiveUrlKey.length >= 2;

  return (
    <AuthLayout
      title="Create a workspace"
      subtitle="A workspace holds your teams, their issues and everybody working on them."
    >
      <AuthForm onSubmit={(event) => void onSubmit(event)}>
        <AuthError message={error} />

        <AuthFieldPair>
          <Input
            label="Workspace name"
            value={name}
            placeholder="Acme"
            autoFocus
            required
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            label="Address"
            value={effectiveUrlKey}
            prefix="polaris.app/"
            hint="Lowercase letters, digits and hyphens."
            maxLength={URL_KEY_MAX}
            required
            onChange={(event) => setUrlKey(cleanUrlKey(event.target.value))}
          />
        </AuthFieldPair>

        <Input
          label="Your name"
          value={userName}
          placeholder="Ada Lovelace"
          hint="What your teammates will see beside your issues."
          autoComplete="name"
          required
          onChange={(event) => setUserName(event.target.value)}
        />

        <AuthFieldPair>
          <Input
            label="First team"
            value={effectiveTeamName}
            placeholder="Engineering"
            onChange={(event) => setTeamName(event.target.value)}
          />
          <Input
            label="Team key"
            value={effectiveTeamKey}
            hint="The prefix in every identifier."
            maxLength={TEAM_KEY_MAX}
            onChange={(event) => setTeamKey(cleanTeamKey(event.target.value))}
          />
        </AuthFieldPair>

        <Button type="submit" variant="primary" fullWidth loading={busy} disabled={!ready}>
          Create workspace
        </Button>
      </AuthForm>
    </AuthLayout>
  );
}

/**
 * A workspace name as a URL segment: lowercase, hyphenated, no punctuation.
 *
 * Diacritics are folded rather than stripped, so "Ação" suggests "acao" instead of "ao" —
 * losing a letter from somebody's company name is a worse first impression than a slightly
 * anglicised one.
 */
export function suggestUrlKey(name: string): string {
  return cleanUrlKey(
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .replace(/\s+/g, '-'),
  );
}

/** Keeps a typed address inside what the server will accept, without fighting the typist. */
export function cleanUrlKey(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      // A leading hyphen is the one thing the server's pattern refuses outright, and it is
      // what a name beginning with punctuation produces.
      .replace(/^-+/, '')
      .slice(0, URL_KEY_MAX)
  );
}

/**
 * A team key from a team name.
 *
 * Initials when the name has several words — "Platform Infrastructure" becomes PI, which is
 * what a team calls itself anyway — and the first few letters when it is one word. Both are
 * guesses, and both are editable.
 */
export function suggestTeamKey(name: string): string {
  const words = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/\s+/)
    .filter((word) => /[a-zA-Z0-9]/.test(word));

  if (words.length === 0) return '';
  if (words.length === 1) return cleanTeamKey((words[0] ?? '').slice(0, 4));
  return cleanTeamKey(words.map((word) => word.charAt(0)).join(''));
}

/** Keeps a typed key inside the server's rule: uppercase letters and digits, starting with a letter. */
export function cleanTeamKey(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^[0-9]+/, '')
    .slice(0, TEAM_KEY_MAX);
}
