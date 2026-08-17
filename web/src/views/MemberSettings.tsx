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
 */

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import { Avatar, Badge, Button, EmptyState, Select, Tooltip } from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import { seatBlock, seatSummary, useEntitlements } from '~/features/admin/entitlements';
import { InviteDialog } from '~/features/admin/InviteDialog';
import {
  lastAdministratorBlock,
  removalConsequence,
  removeUser,
  revokeInvite,
  type InviteSummary,
} from '~/features/admin/mutations';
import { INVITES_QUERY } from '~/features/admin/operations';
import { setRole, setSuspended } from '~/features/members/mutations';
import { when } from '~/features/time';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewerId } from '~/hooks/useViewer';
import type { UserRole, UUID } from '~/store';
import { ApiError, gql } from '~/sync/api';
import styles from './MemberSettings.module.css';

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
  const entitlements = useEntitlements();

  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<UUID | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Null until the invitations query answers. It is admin-only, and a member may not read it. */
  const [invites, setInvites] = useState<readonly InviteSummary[] | null>(null);

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

  useEffect(() => {
    let live = true;
    gql<{ invites: readonly InviteSummary[] }>(INVITES_QUERY)
      .then((data) => {
        if (live) setInvites(data.invites);
      })
      .catch(() => {
        // Only admins may list pending invitations — the addresses of people who do not work
        // here yet are exactly what a workspace should not hand to everybody. A member sees
        // the section absent rather than an error about a permission they do not have.
        if (live) setInvites(null);
      });
    return () => {
      live = false;
    };
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

  useActions(
    [
      {
        id: 'members.invite',
        title: 'Invite somebody to the workspace',
        keys: ['i'],
        when: 'list',
        group: 'Members',
        run: () => openInvite.current(),
      },
    ],
    [],
  );

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
        <Tooltip label="Invite somebody" keys="i">
          <Button variant="primary" disabled={seats !== null} onClick={() => setInviting(true)}>
            Invite people
          </Button>
        </Tooltip>
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

        {invites === null || invites.length === 0 ? null : (
          <section className={styles.section} aria-labelledby="invites-heading">
            <h2 className={styles.sectionTitle} id="invites-heading">
              Pending invitations
            </h2>
            <p className={styles.sectionHint}>
              The link each of these carries was shown once, when it was created, and cannot be
              shown again. Revoke one and invite the person afresh if the link went astray.
            </p>
            <ul className={styles.invites}>
              {invites.map((invite) => (
                <li key={invite.id} className={styles.invite}>
                  <span className={styles.inviteEmail}>{invite.email}</span>
                  <Badge>{ROLE_LABELS[invite.role.toLowerCase() as UserRole] ?? invite.role}</Badge>
                  <span className={styles.inviteExpiry}>expires {when(invite.expiresAt)}</span>
                  <div className={styles.spacer} />
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() =>
                      run(
                        revokeInvite(invite.id).then(() => {
                          reloadInvites.current();
                        }),
                      )
                    }
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
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
