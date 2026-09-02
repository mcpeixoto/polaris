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

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import { Avatar, Badge, Button, EmptyState, Input, Select, Spinner, Tooltip } from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import { seatBlock, seatSummary, useEntitlements } from '~/features/admin/entitlements';
import { PlanBlock } from '~/features/admin/PlanBlock';
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
import { useViewerId, useViewerRole } from '~/hooks/useViewer';
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

/**
 * The roles this picker may assign, most authority first.
 *
 * `owner` is not among them, for the reason `InviteDialog` gives about its own list: the
 * server refuses it outright — `SetUserRole` answers `VALIDATION` on `role`, "the owner role
 * is not available on this plan", for every value of every plan — so offering it is exactly
 * the fixed list that fails when chosen that the command menu's entry above is registered
 * conditionally to avoid. Choosing it optimistically moved the row to Owner and then rolled
 * it back with a message about a plan, which reads as a billing problem rather than as a
 * control that was never going to work.
 */
const ASSIGNABLE_ROLES: readonly UserRole[] = ['admin', 'member', 'guest'];

/**
 * The options one row's picker shows.
 *
 * A role that cannot be assigned can still be *held* — nothing here is the authority on what
 * the server has already stored — and a `<select>` whose value matches no option renders as
 * its first option instead, which would show an owner as an admin and offer to save that on
 * the next change. So a role outside the assignable set is kept, at the front where its
 * authority puts it, for as long as somebody holds it.
 */
function rolesFor(current: UserRole): readonly UserRole[] {
  return ASSIGNABLE_ROLES.includes(current) ? ASSIGNABLE_ROLES : [current, ...ASSIGNABLE_ROLES];
}

const ROLE_LABELS: Readonly<Record<UserRole, string>> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  guest: 'Guest',
};

/** Every role, most privileged first — the order the filter offers them in. */
const ROLE_ORDER: readonly UserRole[] = ['owner', 'admin', 'member', 'guest'];

export function MemberSettings() {
  const engine = useEngine();
  const viewerId = useViewerId();

  const entitlements = useEntitlements();

  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<UUID | null>(null);
  const [suspending, setSuspending] = useState<UUID | null>(null);
  const [suspendBusy, setSuspendBusy] = useState(false);
  const [suspendError, setSuspendError] = useState<string | null>(null);
  // What the table is narrowed to. Client-side over the replica: everybody is already here,
  // and a hundred-person workspace should not be searched with the browser's own find.
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invites, setInvites] = useState<InvitesLoad>({ phase: 'loading' });
  const [revoking, setRevoking] = useState<UUID | null>(null);
  const [revoked, setRevoked] = useState<string | null>(null);

  /**
   * Whether the person looking may administer anybody here.
   *
   * One question, because the server asks one: `ActionMemberInvite`, `ActionMemberSetRole`,
   * `ActionMemberSuspend` and `ActionMemberRemove` are all `role.IsAdmin()`, which is owner or
   * admin and nothing else. This restates that rule rather than replacing it, so the controls
   * are already absent on the first frame instead of appearing and being taken away when a
   * request answers 403 — the server's own refusal is still handled, in the `forbidden` phase
   * below and in `run` beside every write.
   *
   * `null` while the session query is still out, which is not the same as `false` and must not
   * be read as it: guessing "no" would take the invite button away from an admin for the first
   * frame of every visit. Controls appear on `true` and on nothing else, so an unknown answer
   * shows no administrative control it might have to withdraw.
   *
   * Asked of the session and not of the replica. `useViewer()` reads the profile out of
   * `store.users`, and a guest's replica holds no users at all — the directory is
   * workspace-scoped and guests are not sent it — so for the one role this gate exists to
   * exclude, the replica's answer is permanently "not loaded yet". `useViewerRole` comes from
   * `VIEWER_QUERY`, which answers for everybody. See the note on it.
   */
  const viewerRole = useViewerRole();
  const canAdminister =
    viewerRole === null ? null : viewerRole === 'owner' || viewerRole === 'admin';

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

  /*
   * The table's rows after the filters.
   *
   * Client-side, over the replica, because every member is already on this machine and a
   * round trip to narrow a list the client is holding would be slower than not narrowing it.
   * Both the name and the address are searched: the two things somebody has when they are
   * looking for a person and the two that a hundred-row table makes unfindable.
   */
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return members.filter((member) => {
      if (roleFilter !== 'all' && member.role !== roleFilter) return false;
      if (statusFilter === 'active' && member.suspended) return false;
      if (statusFilter === 'suspended' && !member.suspended) return false;
      if (needle === '') return true;
      return (
        member.name.toLowerCase().includes(needle) ||
        (member.email ?? '').toLowerCase().includes(needle)
      );
    });
  }, [members, query, roleFilter, statusFilter]);

  const filtered = query.trim() !== '' || roleFilter !== 'all' || statusFilter !== 'all';

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
      // The reason only. This path is the `I` shortcut hitting a full workspace, and the
      // Seats section below is already on screen carrying the same sentence with the link —
      // a second copy of the destination in the error banner would be two ways to the same
      // page, six inches apart.
      setError(seats.reason);
      return;
    }
    setInviting(true);
  };

  /**
   * Opens the invite dialog for somebody who arrived asking for it.
   *
   * The workspace menu's "Invite people" hands off through this parameter rather than by
   * reaching into this screen's state from the shell, which keeps the seat check above on
   * the one path that opens the dialog — and makes the invite screen a link worth sending.
   *
   * It waits for the role, because `canAdminister` is null until the session answers and
   * opening for a member would draw a dialog whose submit the server refuses. The parameter
   * is stripped either way: left in the address bar it reopens the dialog on every back
   * button, and it has already been spent.
   */
  const [search, setSearch] = useSearchParams();
  const wantsInvite = search.get('invite') === '1';
  useEffect(() => {
    if (!wantsInvite || canAdminister === null) return;
    if (canAdminister) openInvite.current();
    const next = new URLSearchParams(search);
    next.delete('invite');
    setSearch(next, { replace: true });
    // `search` and `setSearch` are left out deliberately: this runs on the arrival, and
    // including the object it is about to rewrite would run it again on the rewrite.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsInvite, canAdminister]);

  useKeyContext('list');

  // Registered only for somebody who may actually do it. The command menu's whole claim is
  // that it "offers what is actually available rather than a fixed list that fails when
  // chosen", and an entry reading "Invite somebody to the workspace" that answers with the
  // server's 403 is precisely the fixed list that fails when chosen.
  useActions(
    canAdminister === true
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
    [canAdminister],
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

  const confirmSuspend = async () => {
    if (suspendTarget === null || suspendBusy) return;
    setSuspendBusy(true);
    setSuspendError(null);
    try {
      await setSuspended(engine, suspendTarget.id, true);
      setSuspending(null);
      // A seat has just been freed, same as a removal.
      entitlements.reload();
    } catch (failure: unknown) {
      setSuspendError(
        failure instanceof ApiError ? failure.message : 'That person could not be suspended.',
      );
    } finally {
      setSuspendBusy(false);
    }
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
  const suspendTarget =
    suspending === null ? null : (members.find((m) => m.id === suspending) ?? null);
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
        {canAdminister === true ? (
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
          <PlanBlock block={seats} className={styles.blocked} />
        </section>

        {/* Two sources for one question, and either is enough to hide the section. The
            replica's answer is on hand in the first frame, so a member never watches
            "Pending invitations" appear and then be taken away when the 403 lands; the
            server's answer is the authoritative one, and covers the moment after somebody's
            role has been changed in another session but the delta has not reached here. */}
        {invites.phase === 'forbidden' || canAdminister === false ? null : (
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

        {members.length === 0 ? null : (
          <div className={styles.filters} role="search">
            <Input
              label="Search people"
              hideLabel
              type="search"
              placeholder="Search by name or email"
              value={query}
              autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
            />
            <Select
              label="Role"
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value as 'all' | UserRole)}
            >
              <option value="all">Every role</option>
              {ROLE_ORDER.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
            <Select
              label="Status"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as 'all' | 'active' | 'suspended')
              }
            >
              <option value="all">Active and suspended</option>
              <option value="active">Active only</option>
              <option value="suspended">Suspended only</option>
            </Select>
          </div>
        )}

        {members.length === 0 ? (
          <EmptyState
            title="Nobody here yet"
            description="Members appear as soon as the workspace has finished replicating."
          />
        ) : shown.length === 0 ? (
          <EmptyState
            title="Nobody matches"
            description="No member of this workspace matches the search and filters above."
            action={
              <Button
                onClick={() => {
                  setQuery('');
                  setRoleFilter('all');
                  setStatusFilter('all');
                }}
              >
                Clear the filters
              </Button>
            }
          />
        ) : (
          <table className={styles.table}>
            <caption className={styles.caption}>
              {filtered
                ? `${String(shown.length)} of ${String(members.length)} people in this workspace, and the role each of them holds.`
                : 'Everyone in this workspace, and the role each of them holds.'}
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
              {shown.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  // `viewerId` is a second answer from the same query, and unknown here
                  // reads as "this might be you": `member.id === null` is false for every
                  // row, so an unknown viewer would put Suspend and Remove on the admin's
                  // own row, in a table where those buttons look identical everywhere
                  // else. The server refuses it, which is the wrong place to find out.
                  isViewer={viewerId === null || member.id === viewerId}
                  manageable={canAdminister === true}
                  onRole={(role) => run(setRole(engine, member.id, role))}
                  onSuspend={(suspended) => {
                    if (suspended && member.protectedBy !== null) {
                      setError(member.protectedBy);
                      return;
                    }
                    // Restoring gives access back and needs no ceremony. Suspending takes it
                    // away from somebody who is very likely using the product right now.
                    if (suspended) {
                      setSuspendError(null);
                      setSuspending(member.id);
                      return;
                    }
                    run(setSuspended(engine, member.id, false));
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
        open={suspendTarget !== null}
        title={suspendTarget === null ? '' : `Suspend ${suspendTarget.name}?`}
        consequence={
          suspendTarget === null
            ? ''
            : `${suspendTarget.name} is signed out of every device and cannot sign back in. Their issues, comments and assignments stay exactly as they are, and their seat is freed. Restoring them puts everything back.`
        }
        confirmLabel={
          suspendTarget === null ? 'Suspend' : `Suspend ${firstName(suspendTarget.name)}`
        }
        destructive
        busy={suspendBusy}
        error={suspendError ?? undefined}
        onConfirm={() => void confirmSuspend()}
        onClose={() => {
          setSuspending(null);
          setSuspendError(null);
        }}
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
  /**
   * Whether the person looking may act on anybody, which is `role.IsAdmin()` and nothing else.
   *
   * Without it the roster was the administration screen for everybody who could reach it: a
   * plain member got a live role picker and Suspend and Remove on every colleague's row, each
   * of which answered `only admins can change roles` / `only admins can suspend people` when
   * pressed. That is the fixed list that fails when chosen, which is the thing this screen
   * registers its command-menu entry conditionally to avoid.
   *
   * The roster itself stays readable, because a member knowing who is here and who is an admin
   * is something the product offers on purpose — "View workspace admins" is a command any
   * member may run. What goes is every control the server was only ever going to refuse.
   */
  manageable: boolean;
  onRole: (role: UserRole) => void;
  onSuspend: (suspended: boolean) => void;
  onRemove: () => void;
}

function MemberRow({ member, isViewer, manageable, onRole, onSuspend, onRemove }: MemberRowProps) {
  const nameId = useId();

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
          <span className={styles.name} id={nameId}>
            {member.name}
            {isViewer ? <Badge>You</Badge> : null}
            {member.isApp ? <Badge tone="accent">App</Badge> : null}
            {/* A standing fact about this row, so the refusal below is never a surprise. */}
            {member.protectedBy === null ? null : <Badge tone="warning">Last owner</Badge>}
          </span>
          <span className={styles.secondary}>
            {/*
              What is known about this person, and nothing that is merely absent.

              The address is absent for everyone but the viewer and the admins — the API does
              not hand a member the whole workspace's address book — and it is absent from the
              replicated `user` payload altogether today, along with `lastSeenAt`: see
              `toUser` in services/internal/domain/convert.go, which streams neither.

              So the missing rung mattered. This read `email ?? (lastSeenAt === null ? 'Has
              not signed in yet' : …)`, and with both fields unreplicated that second arm was
              the only one anything ever reached — every row in the table said "Has not signed
              in yet", including the viewer's own, badged "You", while they were reading it.
              A `null` here means this replica has not been told, which is not the same fact
              and is not one worth printing.
            */}
            {member.email ??
              (member.lastSeenAt === null ? null : `Last seen ${when(member.lastSeenAt)}`)}
          </span>
        </span>
      </th>

      <td>
        {/* Stated rather than offered to somebody who cannot change it. A disabled picker
            would say the same thing less clearly and invite the question of what it takes to
            enable it — the answer being "be an admin", which is not an upgrade prompt. */}
        {manageable ? (
          <Select
            label={`Role for ${member.name}`}
            hideLabel
            value={member.role}
            // Changing your own role is how an owner locks themselves out of their own
            // workspace. The server refuses it; the screen agrees rather than offering it.
            disabled={isViewer}
            onChange={(event) => onRole(event.target.value as UserRole)}
          >
            {rolesFor(member.role).map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
        ) : (
          <Badge>{ROLE_LABELS[member.role]}</Badge>
        )}
      </td>

      <td>{member.suspended ? <Badge tone="warning">Suspended</Badge> : <Badge>Active</Badge>}</td>

      {/*
       * Every row action says whose row it is on.
       *
       * The invitation list four hundred lines up already made this argument — "a list of six
       * buttons all called 'Revoke' is a list a screen-reader user cannot act on without
       * counting" — and the table below it did not follow its own rule.
       *
       * `aria-describedby` rather than `aria-label`, which is the weaker of the two answers
       * and is worth saying why. A label naming the person is what the element list needs;
       * this file's existing tests pin these buttons' accessible names to the bare verbs, and
       * a pre-existing test may not be edited to accommodate a change. So the announcement
       * carries the name — a screen reader reads "Suspend, Ada Lovelace" on focus — and the
       * element list does not yet. See the note in this change's report.
       */}
      <td className={styles.actions}>
        {isViewer || !manageable ? null : (
          <>
            {member.suspended ? (
              <Button size="sm" aria-describedby={nameId} onClick={() => onSuspend(false)}>
                Restore
              </Button>
            ) : (
              <Button
                size="sm"
                variant="danger"
                aria-describedby={nameId}
                onClick={() => onSuspend(true)}
              >
                Suspend
              </Button>
            )}
            <Button size="sm" variant="danger" aria-describedby={nameId} onClick={onRemove}>
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
