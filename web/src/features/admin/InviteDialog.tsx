/**
 * Inviting somebody to the workspace.
 *
 * The dialog has two states and they are not two steps of one form — the second is the whole
 * reason the first exists. `inviteToWorkspace` returns a token that the server keeps only as
 * a SHA-256, so the link built from it exists in that response, in this component's state,
 * and nowhere else in the world. Close the dialog and it is gone; there is no screen that can
 * show it again and no support process that can recover it, only a fresh invitation.
 *
 * Everything about the second state follows from that. The link is rendered into a field the
 * user copies from rather than into a sentence they have to select by hand, the consequence
 * is stated in the field rather than in small print, and the dialog does not close itself on
 * success — an auto-dismissing dialog would take the one copy of a credential off screen
 * while the user was still reaching for the mouse.
 *
 * Nothing here writes the token anywhere durable. It is not put in the route, not handed to
 * the outbox (see mutations.ts for why that mattered), and not kept after the dialog unmounts.
 */

import { useMemo, useRef, useState, type FormEvent } from 'react';

import { Button, Checkbox, Input, Modal, Select } from '~/components';
// Not from the barrel: SecretField is new in this milestone and the barrel is edited in a
// separate pass. See the note accompanying these screens.
import { SecretField } from '~/components/SecretField';
import { when } from '~/features/time';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { UUID } from '~/store';
import { ApiError } from '~/sync/api';
import { seatBlock, type Entitlements } from './entitlements';
import { inviteToWorkspace, type CreatedInvite } from './mutations';
import styles from './InviteDialog.module.css';

export interface InviteDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after an invitation is created, so the pending list can re-read itself. */
  onInvited?: (() => void) | undefined;
  entitlements: Entitlements;
}

/**
 * The roles an invitation may carry.
 *
 * `owner` is absent because the server refuses it, and for a good reason: ownership is
 * granted to somebody already in the workspace, by somebody who can see who they are, rather
 * than promised to an email address that has not been claimed yet.
 */
const INVITE_ROLES: readonly { readonly value: string; readonly label: string }[] = [
  { value: 'admin', label: 'Admin — can manage members, teams and billing' },
  { value: 'member', label: 'Member — can see and change the teams they are in' },
  { value: 'guest', label: 'Guest — only the teams you choose below' },
];

export function InviteDialog({ open, onClose, onInvited, entitlements }: InviteDialogProps) {
  const emailRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [teamIds, setTeamIds] = useState<readonly UUID[]>([]);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  /**
   * The created invitation, held only while this dialog is mounted.
   *
   * State and not a ref, because it is what the dialog renders; and cleared by `close` below
   * rather than left for the unmount, so re-opening the dialog can never show the previous
   * invitation's link to whoever opens it next.
   */
  const [created, setCreated] = useState<CreatedInvite | null>(null);

  const teams = useLiveQuery(
    (store) =>
      [...store.teams.values()]
        .filter((team) => team.archivedAt === undefined && team.retiredAt === undefined)
        .map((team) => ({ id: team.id, key: team.key, name: team.name }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    ['team'],
  );

  const seats = seatBlock(entitlements);

  /**
   * The link the recipient follows.
   *
   * Assembled from the page's own origin rather than from a configured base URL, because the
   * invitation has to land on the deployment the admin is looking at — an invite sent from a
   * self-hosted install must not point at anybody else's.
   */
  const link = useMemo(
    () => (created === null ? '' : `${window.location.origin}/invite/${created.token}`),
    [created],
  );

  const close = () => {
    // Clearing here rather than relying on unmount: React keeps state for a component that
    // is merely hidden, and a link surviving into the next opening is a credential handed to
    // whoever opens it.
    setCreated(null);
    setEmail('');
    setTeamIds([]);
    setEmailError(null);
    setTeamError(null);
    setFailure(null);
    onClose();
  };

  const toggleTeam = (id: UUID) => {
    setTeamError(null);
    setTeamIds((current) =>
      current.includes(id) ? current.filter((held) => held !== id) : [...current, id],
    );
  };

  const submit = async () => {
    if (sending) return;
    const address = email.trim();
    if (address === '') {
      setEmailError('An invitation needs an email address to go to.');
      emailRef.current?.focus();
      return;
    }
    if (role === 'guest' && teamIds.length === 0) {
      // The server refuses this too. Saying it here means the admin does not fill in the
      // form twice to find out.
      setTeamError('A guest can only see the teams you name, so choose at least one.');
      return;
    }

    setSending(true);
    setEmailError(null);
    setTeamError(null);
    setFailure(null);
    try {
      const invite = await inviteToWorkspace({ email: address, role, teamIds });
      setCreated(invite);
      onInvited?.();
    } catch (error) {
      setFailure(
        error instanceof ApiError ? error.message : 'That invitation could not be created.',
      );
    } finally {
      setSending(false);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit();
  };

  if (created !== null) {
    return (
      <Modal
        open={open}
        onClose={close}
        title={`${created.email} has been invited`}
        description="Send them this link. It is the only copy — closing this dialog destroys it, and nobody, including us, can show it again."
        size="md"
        footer={
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        }
      >
        <SecretField
          label="Invitation link"
          value={link}
          consequence="Copy it now. It will not be shown again; if you lose it, invite them a second time."
        />
        <p className={styles.detail}>
          It expires {when(created.expiresAt)}, and only {created.email} can use it — anybody else
          following the link is turned away.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Invite somebody"
      description="They join as soon as they follow the link you get back."
      size="md"
      initialFocus={emailRef}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            loading={sending}
            disabled={seats !== null}
            onClick={() => void submit()}
          >
            Create invitation
          </Button>
        </>
      }
    >
      <form className={styles.form} onSubmit={onSubmit}>
        {/* Announced rather than merely drawn: the reason a control is disabled is exactly
            what a person who cannot see it being grey needs to be told. */}
        {seats === null ? null : (
          <p className={styles.blocked} role="status">
            {seats}
          </p>
        )}

        <Input
          ref={emailRef}
          label="Email address"
          type="email"
          value={email}
          error={emailError ?? undefined}
          placeholder="ada@example.com"
          autoComplete="off"
          onChange={(event) => {
            setEmail(event.target.value);
            if (emailError !== null) setEmailError(null);
          }}
        />

        <Select
          label="Role"
          value={role}
          onChange={(event) => {
            setRole(event.target.value);
            setTeamError(null);
          }}
        >
          {INVITE_ROLES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

        <fieldset className={styles.teams}>
          <legend className={styles.legend}>Teams</legend>
          <p className={styles.hint}>
            {role === 'guest'
              ? 'A guest sees nothing but the teams named here.'
              : 'Optional — they can be added to more later.'}
          </p>
          {teams.length === 0 ? (
            <p className={styles.hint}>This workspace has no teams yet.</p>
          ) : (
            <div className={styles.teamList}>
              {teams.map((team) => (
                <Checkbox
                  key={team.id}
                  label={`${team.key} · ${team.name}`}
                  checked={teamIds.includes(team.id)}
                  onChange={() => toggleTeam(team.id)}
                />
              ))}
            </div>
          )}
          {teamError === null ? null : (
            <p className={styles.error} role="alert">
              {teamError}
            </p>
          )}
        </fieldset>

        {failure === null ? null : (
          <p className={styles.error} role="alert">
            {failure}
          </p>
        )}
      </form>
    </Modal>
  );
}
