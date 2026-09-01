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
 *
 * ## The submit button is never disabled, and that is the second decision
 *
 * It used to be, on a `ready` flag covering three fields. A greyed-out primary action is the
 * worst kind of refusal: it names nothing, it is not in the tab order, and the person looking
 * at it has to work out by elimination which of five fields it is unhappy about. So the button
 * stays live, the submit runs the same three checks, and each one lands as a message on the
 * field it is about with focus moved there. `Button`'s `loading` is the only state that stops
 * this form, and it does so with `aria-disabled` so the button keeps focus.
 */

import { useRef, useState, type FormEvent } from 'react';

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
  /** Which field the submit refused, and what to say about it. One at a time: the form is
   *  short, and three messages at once is a list of complaints rather than a next step. */
  const [problem, setProblem] = useState<{ field: Field; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  const urlKeyRef = useRef<HTMLInputElement>(null);
  const userNameRef = useRef<HTMLInputElement>(null);

  // Held as null until edited, so the suggestion keeps following the name it is derived from
  // and stops the instant somebody disagrees with it.
  const effectiveUrlKey = urlKey ?? suggestUrlKey(name);
  const effectiveTeamName = teamName.trim() === '' ? name : teamName;
  const effectiveTeamKey = teamKey ?? suggestTeamKey(effectiveTeamName);

  /** The message for `field`, or undefined — so `Input` decides between hint and error. */
  const messageFor = (field: Field) => (problem?.field === field ? problem.message : undefined);

  /** Clearing on the next keystroke: a message about a field somebody is already fixing is
   *  in the way, and re-mounting it on the next submit is what re-announces it. */
  const clear = (field: Field) => {
    if (problem?.field === field) setProblem(null);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    // Checked here rather than by the browser, because AuthForm is `noValidate`: the platform
    // bubble is in the browser's wording, appears over the field, and vanishes on the next
    // keystroke, which is the wrong shape for everything else on these screens.
    if (name.trim() === '') {
      setProblem({ field: 'name', message: 'Give the workspace a name — your company or team.' });
      nameRef.current?.focus();
      return;
    }
    if (effectiveUrlKey.length < 2) {
      setProblem({
        field: 'urlKey',
        message: 'An address needs at least two characters. Letters, digits and hyphens.',
      });
      urlKeyRef.current?.focus();
      return;
    }
    if (userName.trim() === '') {
      setProblem({
        field: 'userName',
        message: 'Add your own name — this is what your teammates will see.',
      });
      userNameRef.current?.focus();
      return;
    }

    setProblem(null);
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

  return (
    <AuthLayout
      title="Create a workspace"
      subtitle="A workspace holds your teams, their issues and everybody working on them."
    >
      <AuthForm onSubmit={(event) => void onSubmit(event)}>
        <AuthError message={error} />

        <Input
          ref={nameRef}
          label="Workspace name"
          name="workspace"
          value={name}
          placeholder="Acme"
          // The browser's own suggestion for a company name is a better guess than nothing,
          // and it is the only field on this form that maps to something it already knows.
          autoComplete="organization"
          error={messageFor('name')}
          autoFocus
          required
          onChange={(event) => {
            setName(event.target.value);
            clear('name');
          }}
        />

        {/* On its own line rather than beside the name, because of the prefix.
            "polaris.app/" is a fixed product string, so it may not be truncated, and `.affix`
            correctly refuses to shrink — which in the narrow half of a 2fr/1fr pair inside a
            420px card left the input itself about 20px wide. The pair below has no affix and
            is fine. */}
        <Input
          ref={urlKeyRef}
          label="Address"
          name="urlKey"
          value={effectiveUrlKey}
          prefix="polaris.app/"
          hint="Lowercase letters, digits and hyphens."
          error={messageFor('urlKey')}
          maxLength={URL_KEY_MAX}
          // Not a field any password manager or address book has an answer for, and a
          // suggestion dropdown over it would be offering a name where a URL segment goes.
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="none"
          required
          onChange={(event) => {
            setUrlKey(cleanUrlKey(event.target.value));
            clear('urlKey');
          }}
        />

        <Input
          ref={userNameRef}
          label="Your name"
          name="name"
          value={userName}
          placeholder="Ada Lovelace"
          hint="What your teammates will see beside your issues."
          error={messageFor('userName')}
          autoComplete="name"
          required
          onChange={(event) => {
            setUserName(event.target.value);
            clear('userName');
          }}
        />

        <AuthFieldPair>
          <Input
            label="First team"
            name="teamName"
            value={effectiveTeamName}
            placeholder="Engineering"
            autoComplete="off"
            onChange={(event) => setTeamName(event.target.value)}
          />
          <Input
            label="Team key"
            name="teamKey"
            value={effectiveTeamKey}
            hint="The prefix in every identifier."
            maxLength={TEAM_KEY_MAX}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="characters"
            onChange={(event) => setTeamKey(cleanTeamKey(event.target.value))}
          />
        </AuthFieldPair>

        <Button type="submit" variant="primary" fullWidth loading={busy}>
          Create workspace
        </Button>
      </AuthForm>
    </AuthLayout>
  );
}

/** The three fields a submit can refuse. The other two are optional and derived. */
type Field = 'name' | 'urlKey' | 'userName';

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
