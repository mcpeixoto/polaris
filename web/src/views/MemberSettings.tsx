/**
 * Everyone in the workspace, what they may do, and how many seats that costs.
 *
 * A table rather than a list of cards, because the screen is read by comparing rows — who is
 * an admin, who is suspended, who has never signed in — and a table is the one structure a
 * screen reader can be driven through cell by cell while answering that kind of question.
 *
 * Three things here are heavier than they look.
 *
 * **Seats.** The count is a fact about billing, so it is stated in words next to the invite
 * button rather than left for the user to infer from the length of the list. When the plan is
 * full the button is disabled *with the reason on screen* rather than hidden: a hidden
 * feature is a support ticket, and a disabled one that names the plan is the only upgrade
 * prompt this product needs. See features/admin/entitlements.
 *
 * **The last administrator.** A workspace that loses its last active owner or admin has
 * nobody who can invite, change a role, manage billing or delete it, and there is no
 * self-service way back — the recovery is a support ticket against the database. The server
 * refuses inside the transaction that would do the archiving; this screen refuses first, so
 * the explanation arrives instead of the request rather than after it.
 *
 * **Removal.** It is an archive, not a delete, and the confirmation says so. Their issues and
 * comments keep their author because the foreign keys are ON DELETE SET NULL and a real
 * delete would silently unattribute years of work rather than remove it.
 *
 * **Invitations.** The one part of this screen that is not the replica, and the reason it
 * looks different from every other list in the product. An invitation is not a replicated
 * entity — it has no row in the store and never arrives on the sync stream, which is the same
 * fact the schema states as its reason for `InvitePayload` not being a `MutationResult` — so
 * this section is a plain query with a real loading state, a real failure and a retry, and
 * neither `useQuery` nor `useLiveQuery` can express it: both are subscriptions to the replica.
 * See `fetchInvites`. Everything odd about this section follows from that one sentence.
 */

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import { Avatar, Badge, Button, EmptyState, Select, Spinner, Tooltip } from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import { seatBlock, seatSummary, useEntitlements } from '~/features/admin/entitlements';
import { InviteDialog } from '~/features/admin/InviteDialog';
import {
  fetchInvites,
  hasExpired,
  lastAdministratorBlock,
  removalConsequence,
  removeUser,
  revocationFailure,
  revokeInvite,
  type InviteSummary,
} from '~/features/admin/mutations';
import { setRole, setSuspended } from '~/features/members/mutations';
import { exact, when } from '~/features/time';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewer, useViewerId } from '~/hooks/useViewer';
import type { UserRole, UUID } from '~/store';
import { ApiError } from '~/sync/api';
import styles from './MemberSettings.module.css';

/**
 * What the invitations query is doing.
 *
 * One value rather than a set of booleans, so that "empty because nobody is waiting" and
 * "empty because the request has not come back" are different things a reader cannot conflate
 * — which is the whole difference between an empty state that reassures and one that lies.
 *
 * `forbidden` is a phase of its own and not a kind of failure. Only admins may list pending
 * invitations, because the list is a set of email addresses of people who do not work here
 * yet; a member gets `FORBIDDEN` from the server and should see the section absent rather
 * than an error message about a permission they were never going to have.
 */
type InvitesLoad =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly invites: readonly InviteSummary[] }
  | { readonly phase: 'forbidden' }
  | { readonly phase: 'failed'; readonly message: string };

interface MemberView {
  readonly id: UUID;
  readonly name: string;
  readonly email: string | null;
  readonly avatarUrl: string | null;
  readonly role: UserRole;
  readonly suspended: boolean;
  readonly isApp: boolean;
  readonly lastSeenAt: string | null;
  /** Set when this person is the only administrator left. The reason, ready to be shown. */
  readonly protectedBy: string | null;
}

/** The roles a workspace has, most authority first, as the picker offers them. */
const ROLES: readonly UserRole[] = ['owner', 'admin', 'member', 'guest'];

const ROLE_LABELS: Readonly<Record<UserRole, string>> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  guest: 'Guest',
};

export function MemberSettings() {
  const engine = useEngine();
  const viewerId = useViewerId();
  const viewer = useViewer();
  const entitlements = useEntitlements();

  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<UUID | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invites, setInvites] = useState<InvitesLoad>({ phase: 'loading' });
  const [revoking, setRevoking] = useState<UUID | null>(null);
  const [revoked, setRevoked] = useState<string | null>(null);

  /**
   * Whether the person looking may invite, according to the replica.
   *
   * `null` while their own row has not arrived yet, which is not the same as `false` and must
   * not be read as it: an unknown answer hides nothing, because guessing "no" would take the
   * invite button away from an admin for the first frame of every visit.
   *
   * This restates the server's rule rather than replacing it — `authz.Can(p,
   * ActionMemberInvite)` is `role.IsAdmin()`, which is owner or admin and nothing else — and it
   * exists so the invite controls are already absent on the first frame instead of appearing
   * and then being taken away when the query answers 403. The server's own refusal is still
   * handled, in the `forbidden` phase below; the two are belt and braces for one question and
   * can only disagree for as long as a role change takes to reach this replica.
   */
  const canInvite = viewer === null ? null : viewer.role === 'owner' || viewer.role === 'admin';

  const members = useLiveQuery(
    (store) =>
      [...store.users.values()]
        .filter((user) => user.archivedAt === undefined)
        .map((user): MemberView => ({
          id: user.id,
          name: user.displayName,
          email: user.email ?? null,
          avatarUrl: user.avatarUrl ?? null,
          role: user.role,
          suspended: user.status !== 'active',
          isApp: user.kind === 'app',
          lastSeenAt: user.lastSeenAt ?? null,
          protectedBy: lastAdministratorBlock(store, user.id),
        }))
        // Suspended people sink to the bottom: the list is read to find somebody to give
        // work to, and the ones who cannot receive it should not be in the way.
        .sort((a, b) => Number(a.suspended) - Number(b.suspended) || a.name.localeCompare(b.name)),
    ['user', 'workspace'],
  );

  const reloadInvites = useRef<() => void>(() => {});
  const [invitesAttempt, setInvitesAttempt] = useState(0);
  reloadInvites.current = () => setInvitesAttempt((n) => n + 1);

  // Re-run on `attempt` and on nothing else. Invitations have no live source to subscribe to,
  // so "reload" is something a person or a write asks for; nothing on the sync stream can
  // trigger it, because nothing about an invitation is ever on the sync stream.
  useEffect(() => {
    const controller = new AbortController();
    setInvites({ phase: 'loading' });

    fetchInvites(controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) setInvites({ phase: 'ready', invites: rows });
      })
      .catch((failure: unknown) => {
        // An abort is this screen going away, not a failure anybody needs to hear about.
        if (controller.signal.aborted) return;
        if (failure instanceof ApiError && failure.code === 'FORBIDDEN') {
          setInvites({ phase: 'forbidden' });
          return;
        }
        setInvites({
          phase: 'failed',
          message:
            failure instanceof ApiError && failure.isOffline
              ? 'Pending invitations could not be fetched — this device looks offline. They are not kept on it, so there is nothing to show until the connection is back.'
              : 'Pending invitations could not be fetched.',
        });
      });

    // Aborted rather than merely ignored, so leaving the screen mid-request does not hold a
    // socket open.
    return () => controller.abort();
  }, [invitesAttempt]);

  const run = (work: Promise<unknown>) => {
    setError(null);
    work.catch((failure: unknown) => {
      setError(failure instanceof ApiError ? failure.message : 'That change could not be saved.');
    });
  };

  const seats = seatBlock(entitlements);

  /**
   * Read through a ref by the registered action below. An action's `run` closure is captured
   * once at registration, so calling `setInviting` through a fresh closure each render would
   * mean the shortcut toggling a boolean nobody is reading any more.
   */
  const openInvite = useRef<() => void>(() => {});
  openInvite.current = () => {
    if (seats !== null) {
      setError(seats);
      return;
    }
    setInviting(true);
  };

  useKeyContext('list');

  // Registered only for somebody who may actually do it. The command menu's whole claim is
  // that it "offers what is actually available rather than a fixed list that fails when
  // chosen", and an entry reading "Invite somebody to the workspace" that answers with the
  // server's 403 is precisely the fixed list that fails when chosen.
  useActions(
    canInvite === true
      ? [
          {
            id: 'members.invite',
            title: 'Invite somebody to the workspace',
            keys: ['i'],
            when: 'list',
            group: 'Members',
            run: () => openInvite.current(),
          },
        ]
      : [],
    [canInvite],
  );

  /**
   * Cancels an invitation, one at a time.
   *
   * Sequential for the reason the trash restores sequentially: each revoke is its own request
   * and concurrency would be safe, but a list where three rows are in flight is one where a
   * failure cannot be attributed to the row that caused it.
   *
   * The refetch afterwards is not bookkeeping. A revoke that failed with `NOT_FOUND` means the
   * row is gone for a reason this client does not know — somebody accepted it, or another
   * admin revoked it first — so the list on screen is wrong either way, and re-reading is the
   * only thing that makes the sentence beside it true.
   */
  const revoke = async (invite: InviteSummary) => {
    if (revoking !== null) return;
    setRevoking(invite.id);
    setError(null);
    try {
      await revokeInvite(invite.id);
      setRevoked(`The invitation to ${invite.email} has been revoked. Its link no longer works.`);
    } catch (failure) {
      setError(revocationFailure(failure));
    } finally {
      setRevoking(null);
      reloadInvites.current();
    }
  };

  const askRemove = (member: MemberView) => {
    if (member.protectedBy !== null) {
      // Refused before the request. The server applies the same rule; this is the half that
      // means the admin does not watch a row disappear and come back.
      setError(member.protectedBy);
      return;
    }
    setError(null);
    setRemoveError(null);
    setRemoving(member.id);
  };

  const confirmRemove = async () => {
    if (removing === null || busy) return;
    setBusy(true);
    setRemoveError(null);
    try {
      await removeUser(engine, removing);
      setRemoving(null);
      // A seat has just been freed, and the number above the table has to say so.
      entitlements.reload();
    } catch (failure) {
      setRemoveError(
        failure instanceof ApiError ? failure.message : 'That person could not be removed.',
      );
    } finally {
      setBusy(false);
    }
  };

  const target = removing === null ? null : (members.find((m) => m.id === removing) ?? null);
  const workspaceName = useLiveQuery(
    (store) => [...store.workspaces.values()][0]?.name ?? 'this workspace',
    ['workspace'],
  );

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Members</h1>
        <Badge>{members.length === 1 ? '1 person' : `${members.length} people`}</Badge>
        <div className={styles.spacer} />
        {/* Absent for a member rather than disabled with a reason. The plan gates on this
            screen are disabled-and-explained, because naming the plan is the upgrade prompt;
            a permission gate is not — telling somebody "only admins can invite people" beside
            a button they will never be allowed to press is an explanation of somebody else's
            feature. */}
        {canInvite === true ? (
          <Tooltip label="Invite somebody" keys="i">
            <Button variant="primary" disabled={seats !== null} onClick={() => setInviting(true)}>
              Invite people
            </Button>
          </Tooltip>
        ) : null}
      </header>

      <div className={styles.body}>
        {error === null ? null : (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <section className={styles.seats} aria-labelledby="seats-heading">
          <h2 className={styles.sectionTitle} id="seats-heading">
            Seats
          </h2>
          <p className={styles.sectionHint}>
            {seatSummary(entitlements.facts)} Suspending somebody frees their seat; removing them
            does too. App users are never counted — an integration is not a person.
          </p>
          {seats === null ? null : <p className={styles.blocked}>{seats}</p>}
        </section>

        {/* Two sources for one question, and either is enough to hide the section. The
            replica's answer is on hand in the first frame, so a member never watches
            "Pending invitations" appear and then be taken away when the 403 lands; the
            server's answer is the authoritative one, and covers the moment after somebody's
            role has been changed in another session but the delta has not reached here. */}
        {invites.phase === 'forbidden' || canInvite === false ? null : (
          <section className={styles.section} aria-labelledby="invites-heading">
            <h2 className={styles.sectionTitle} id="invites-heading">
              Pending invitations
            </h2>
            <p className={styles.sectionHint}>
              The link each of these carries was shown once, when it was created, and cannot be
              shown again — not by us and not by anybody. Revoke one and invite the person afresh if
              the link went astray. An invitation that is accepted, revoked, or left until it runs
              out stops being listed here; the ones below are the ones still live.
            </p>

            {/*
              A live region that is in the document from the first render.
              A successful revoke takes its own row off the screen, which is proof of nothing to
              somebody who was not watching that row — and a region inserted already populated is
              frequently never announced at all.
            */}
            <p className={styles.revoked} role="status" aria-live="polite">
              {revoked ?? ''}
            </p>

            {invites.phase === 'loading' ? (
              <div className={styles.loading}>
                <Spinner label="Loading pending invitations" />
              </div>
            ) : null}

            {invites.phase === 'failed' ? (
              // Wrapped rather than given role="alert" itself: the empty state renders a
              // paragraph and a button, and the whole block is the announcement.
              <div role="alert">
                <EmptyState
                  title="Pending invitations could not be loaded"
                  description={invites.message}
                  action={<Button onClick={() => reloadInvites.current()}>Try again</Button>}
                />
              </div>
            ) : null}

            {invites.phase === 'ready' && invites.invites.length === 0 ? (
              <p className={styles.sectionHint}>Nobody is waiting on an invitation.</p>
            ) : null}

            {invites.phase === 'ready' && invites.invites.length > 0 ? (
              <ul className={styles.invites}>
                {invites.invites.map((invite) => (
                  <InviteRow
                    key={invite.id}
                    invite={invite}
                    busy={revoking === invite.id}
                    onRevoke={() => void revoke(invite)}
                  />
                ))}
              </ul>
            ) : null}
          </section>
        )}

        {members.length === 0 ? (
          <EmptyState
            title="Nobody here yet"
            description="Members appear as soon as the workspace has finished replicating."
          />
        ) : (
          <table className={styles.table}>
            <caption className={styles.caption}>
              Everyone in this workspace, and the role each of them holds.
            </caption>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className={styles.hidden}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  isViewer={member.id === viewerId}
                  onRole={(role) => run(setRole(engine, member.id, role))}
                  onSuspend={(suspended) => {
                    if (suspended && member.protectedBy !== null) {
                      setError(member.protectedBy);
                      return;
                    }
                    run(setSuspended(engine, member.id, suspended));
                  }}
                  onRemove={() => askRemove(member)}
                />
              ))}
            </tbody>
          </table>
        )}

        <p className={styles.footnote}>
          Deleted issues are recoverable for thirty days — see{' '}
          <Link to="/settings/trash">Trash</Link>.
        </p>
      </div>

      <InviteDialog
        open={inviting}
        onClose={() => setInviting(false)}
        onInvited={() => reloadInvites.current()}
        entitlements={entitlements}
        pending={invites.phase === 'ready' ? invites.invites : []}
      />

      <ConfirmDialog
        open={target !== null}
        title={target === null ? '' : `Remove ${target.name} from ${workspaceName}?`}
        consequence={target === null ? '' : removalConsequence(engine.store, target.id)}
        confirmLabel={target === null ? 'Remove' : `Remove ${firstName(target.name)}`}
        destructive
        busy={busy}
        error={removeError ?? undefined}
        onConfirm={() => void confirmRemove()}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}

interface InviteRowProps {
  invite: InviteSummary;
  busy: boolean;
  onRevoke: () => void;
}

/**
 * One outstanding invitation.
 *
 * The expiry is the whole row, really. The server only ever lists invitations that have not
 * run out, so a row that says "expired" is one this screen has been holding since before the
 * fourteen-day window closed — the link in that person's inbox stopped working while somebody
 * was looking at this page, and the next reload will take the row away without explanation.
 * Saying so is cheap; a row that silently vanishes is a support question.
 *
 * The revoke button stays live on an expired row, because the server still accepts it: the
 * statement behind `revokeInvite` constrains `revoked_at IS NULL AND accepted_at IS NULL` and
 * says nothing about expiry. Disabling it would be this screen inventing a refusal.
 */
function InviteRow({ invite, busy, onRevoke }: InviteRowProps) {
  const expired = hasExpired(invite);
  return (
    <li className={expired ? [styles.invite, styles.inviteStale].join(' ') : styles.invite}>
      <span className={styles.inviteEmail}>{invite.email}</span>
      {/* `invite.role` is the store's spelling because `fetchInvites` converted it. Looking
          this up with the wire's `"ADMIN"` was a blank badge and no error anywhere. */}
      <Badge>{ROLE_LABELS[invite.role]}</Badge>
      {expired ? <Badge tone="warning">Expired</Badge> : null}
      <span className={styles.inviteExpiry} title={exact(invite.expiresAt)}>
        {expired ? `ran out ${when(invite.expiresAt)}` : `expires ${when(invite.expiresAt)}`}
      </span>
      <div className={styles.spacer} />
      <Button
        size="sm"
        variant="danger"
        // Named per row: a list of six buttons all called "Revoke" is a list a screen-reader
        // user cannot act on without counting.
        aria-label={`Revoke the invitation to ${invite.email}`}
        loading={busy}
        onClick={onRevoke}
      >
        Revoke
      </Button>
    </li>
  );
}

interface MemberRowProps {
  member: MemberView;
  /** The person doing the looking. They may not change their own authority. */
  isViewer: boolean;
  onRole: (role: UserRole) => void;
  onSuspend: (suspended: boolean) => void;
  onRemove: () => void;
}

function MemberRow({ member, isViewer, onRole, onSuspend, onRemove }: MemberRowProps) {
  return (
    <tr className={member.suspended ? styles.suspendedRow : undefined}>
      <th scope="row" className={styles.person}>
        <Avatar
          name={member.name}
          src={member.avatarUrl}
          size="sm"
          colorKey={member.id}
          decorative
        />
        <span className={styles.identity}>
          <span className={styles.name}>
            {member.name}
            {isViewer ? <Badge>You</Badge> : null}
            {member.isApp ? <Badge tone="accent">App</Badge> : null}
            {/* A standing fact about this row, so the refusal below is never a surprise. */}
            {member.protectedBy === null ? null : <Badge tone="warning">Last owner</Badge>}
          </span>
          <span className={styles.secondary}>
            {/* Absent for everyone but the viewer and the admins — the API does not hand a
                member the whole workspace's address book. */}
            {member.email ??
              (member.lastSeenAt === null
                ? 'Has not signed in yet'
                : `Last seen ${when(member.lastSeenAt)}`)}
          </span>
        </span>
      </th>

      <td>
        <Select
          label={`Role for ${member.name}`}
          hideLabel
          value={member.role}
          // Changing your own role is how an owner locks themselves out of their own
          // workspace. The server refuses it; the screen agrees rather than offering it.
          disabled={isViewer}
          onChange={(event) => onRole(event.target.value as UserRole)}
        >
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </Select>
      </td>

      <td>{member.suspended ? <Badge tone="warning">Suspended</Badge> : <Badge>Active</Badge>}</td>

      <td className={styles.actions}>
        {isViewer ? null : (
          <>
            {member.suspended ? (
              <Button size="sm" onClick={() => onSuspend(false)}>
                Restore
              </Button>
            ) : (
              <Button size="sm" variant="danger" onClick={() => onSuspend(true)}>
                Suspend
              </Button>
            )}
            <Button size="sm" variant="danger" onClick={onRemove}>
              Remove
            </Button>
          </>
        )}
      </td>
    </tr>
  );
}

/** The name a button can carry without wrapping. "Remove Ada" reads; "Remove Ada Lovelace" wraps. */
function firstName(name: string): string {
  return name.split(' ')[0] ?? name;
}
