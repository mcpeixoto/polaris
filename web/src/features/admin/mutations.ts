/**
 * The administration writes.
 *
 * Creating an invitation does not go through `engine.mutate`, and that is the most important
 * thing in this file. It returns a token that exists in that one response and nowhere else —
 * the server stores only its SHA-256 — and the outbox replays a mutation by re-sending its
 * variables and *discarding* the result. A queued invite that succeeded an hour later would
 * therefore mint a credential nobody can ever read, which is not an offline inconvenience,
 * it is an invitation with no link. So it is a plain `gql` call: it succeeds now, in front of
 * the person who asked, or it fails now and can be asked for again. `features/apikeys` makes
 * the same trade for the same reason, and says so there.
 *
 * Revoking an invitation is a plain call for a quieter version of the same reason. The entity
 * is not replicated, so there is no optimistic patch for the outbox to protect, and a revoke
 * sitting silently in a queue is worse than a failure the admin can see and retry: the whole
 * point of pressing it is that the credential stops working.
 *
 * Removing a member is the opposite case and goes through the engine as usual: the user row
 * *is* replicated, the server answers with an upsert of the archived row, and the optimistic
 * patch is what takes the person out of the directory on the click rather than on the reply.
 */

import { fromWire, fromWireValue, toWire } from '~/gql/enums';
import { ApiError, gql } from '~/sync/api';
import type { Issue, Store, User, UserRole, UUID } from '~/store';
import type { SyncEngine } from '~/sync/engine';
import {
  INVITES_QUERY,
  INVITE_TO_WORKSPACE,
  REMOVE_USER,
  RESTORE_ISSUE,
  REVOKE_INVITE,
} from './operations';

export interface InviteSummary {
  readonly id: UUID;
  readonly email: string;
  readonly role: UserRole;
  readonly invitedBy: UUID | null;
  readonly teamIds: readonly UUID[];
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface NewInvite {
  readonly email: string;
  readonly role: UserRole;
  readonly teamIds: readonly UUID[];
}

/**
 * An invitation as it arrives: every enum still in GraphQL's spelling.
 *
 * Declared so that `fromWireValue` has a literal type to narrow rather than `string`, which
 * would make the conversion a cast that proves nothing. `Uppercase<UserRole>` is what the
 * schema's `UserRole` enum actually sends, and lower-casing it lands back on `UserRole`
 * without anybody writing the four values down a second time.
 */
interface InviteWire extends Omit<InviteSummary, 'role'> {
  readonly role: Uppercase<UserRole>;
}

/**
 * The workspace's pending invitations.
 *
 * A network read and not a store query, and this is the sharpest example of that distinction
 * in the product: an invitation is not a replicated entity, it has no row in the store, and it
 * never arrives over the sync stream. So neither `useQuery` nor `useLiveQuery` applies — both
 * are subscriptions to the replica, and their doc comments say so — and the screen has real
 * loading, real failure and a retry, the way Trash and API keys do.
 *
 * What the server means by "pending" is narrower than it looks, and the screen depends on it:
 * `ListPendingInvites` filters on `accepted_at IS NULL AND revoked_at IS NULL AND expires_at >
 * now()`. So an invitation that has been accepted, revoked, or has simply run out of time is
 * not in this answer at all — there is no status column to render, and a row that vanishes
 * between two fetches has done one of those three things.
 */
export async function fetchInvites(signal?: AbortSignal): Promise<readonly InviteSummary[]> {
  const data = await gql<{ invites: readonly InviteWire[] }>(INVITES_QUERY, undefined, { signal });
  return data.invites.map((invite) => ({ ...invite, role: fromWireValue(invite.role) }));
}

/**
 * Whether an invitation the client is holding has run out since it was fetched.
 *
 * The server never *lists* an expired invitation, so this is only ever true of a row on a
 * screen that has been open for a while — the fourteen-day window closes while somebody is
 * looking at it. Worth saying rather than leaving the row looking live: the link in that
 * person's inbox has stopped working, and the admin's next move is to invite them again, not
 * to wait.
 *
 * It stays revocable, because the server still allows that: `RevokeInvite`'s statement
 * constrains `revoked_at IS NULL AND accepted_at IS NULL` and says nothing about expiry.
 */
export function hasExpired(invite: InviteSummary, now: number = Date.now()): boolean {
  const at = Date.parse(invite.expiresAt);
  // An unparseable timestamp is not an expiry. Guessing "expired" would take a working
  // invitation off the screen because a date format changed.
  return !Number.isNaN(at) && at <= now;
}

/**
 * Why revoking failed, in words that match what actually happened.
 *
 * `NOT_FOUND` is the interesting one and the server's message for it is "invitation not
 * found", which is a lie by omission to an admin looking straight at the row. The statement
 * requires `revoked_at IS NULL AND accepted_at IS NULL`, so an invitation that another admin
 * revoked a second ago and one that the recipient accepted a second ago both answer this way,
 * and so does an id that was never an invitation. The server cannot tell them apart on purpose
 * — distinguishing them would confirm that an invitation exists in a workspace the caller
 * cannot see — so neither can this, and the sentence says the one thing that is true of all
 * three rather than picking the likeliest and being wrong sometimes.
 */
export function revocationFailure(error: unknown): string {
  if (error instanceof ApiError && error.code === 'NOT_FOUND') {
    return 'That invitation is no longer outstanding — somebody has accepted it, or another admin has already revoked it. The list below has been re-read.';
  }
  if (error instanceof ApiError) return error.message;
  return 'That invitation could not be revoked.';
}

/**
 * The member who already holds this address, if anybody does.
 *
 * A warning and never a refusal, because the server does not refuse it: `InviteToWorkspace`
 * checks the role, the teams and the address's shape and never once asks whether that person
 * is already here. The invitation is created, the link works, and `AcceptInvite` finds them
 * already a member and accepts idempotently — which does not change their role and does not
 * un-suspend them. So the honest thing to tell an admin is that the invitation will succeed
 * and accomplish nothing, and then let them send it anyway.
 *
 * Case-insensitive, because two people typing the same address in different cases have typed
 * the same address; the server agrees, comparing with `lower()` and `EqualFold` everywhere it
 * matters. Only an admin ever sees this screen, and only an admin is given other people's
 * addresses by the API, so the comparison has something to compare against.
 */
export function existingMember(store: Store, email: string): User | null {
  const address = email.trim().toLowerCase();
  if (address === '') return null;
  for (const user of store.users.values()) {
    if (user.archivedAt !== undefined) continue;
    if (user.email?.toLowerCase() === address) return user;
  }
  return null;
}

/**
 * The outstanding invitation to this address, if there is one.
 *
 * Creating a second one is not an error and not a duplicate: the server revokes the first
 * inside the same transaction — `RevokePendingInvitesForEmail`, backed by a partial unique
 * index — so what looks like "invite them again" is really "replace the link". The earlier
 * link stops working at that moment, silently, which is exactly the kind of thing somebody
 * should be told before they do it rather than after somebody complains the link is dead.
 */
export function pendingInviteFor(
  invites: readonly InviteSummary[],
  email: string,
): InviteSummary | null {
  const address = email.trim().toLowerCase();
  if (address === '') return null;
  return invites.find((invite) => invite.email.toLowerCase() === address) ?? null;
}

/**
 * An invitation and its one-time token, held only for as long as it is on screen.
 *
 * Deliberately not stored, not put in a URL and not written to the outbox. The link the
 * caller builds from it is assembled in memory and rendered into a field the user copies
 * from; navigating away is what destroys it, which is the intended lifetime.
 */
export interface CreatedInvite {
  readonly id: UUID;
  readonly email: string;
  readonly role: UserRole;
  readonly expiresAt: string;
  readonly token: string;
}

export async function inviteToWorkspace(input: NewInvite): Promise<CreatedInvite> {
  const data = await gql<{
    inviteToWorkspace: Omit<CreatedInvite, 'role'> & { role: Uppercase<UserRole> };
  }>(INVITE_TO_WORKSPACE, {
    input: {
      email: input.email,
      role: toWire(input.role),
      // Always sent, even empty: the field is a list of teams to join, and omitting it and
      // sending none are the same request.
      teamIds: [...input.teamIds],
    },
  });
  // Converted on the way in for the same reason `restoreIssue` converts something it does not
  // store: the next caller to render this role would otherwise be the one place in the app
  // reading `"MEMBER"`, and would reintroduce the bug rather than inherit the fix.
  return { ...data.inviteToWorkspace, role: fromWireValue(data.inviteToWorkspace.role) };
}

export async function revokeInvite(id: UUID): Promise<void> {
  await gql(REVOKE_INVITE, { id });
}

/**
 * Takes somebody out of the workspace, keeping everything they wrote.
 *
 * Optimistically an archive rather than a delete, which is exactly the change the server
 * emits: their name has to stay resolvable or every issue they created and every comment
 * they wrote renders with a blank author, and the replica has no other source for it.
 * `archivedAt` is what takes them out of the directory and the assignee picker.
 */
export async function removeUser(engine: SyncEngine, userId: UUID): Promise<void> {
  const before = engine.store.get('user', userId);
  if (before === undefined) return;

  const blocked = lastAdministratorBlock(engine.store, userId);
  if (blocked !== null) {
    // Refused here rather than by the server, so the explanation arrives before the request
    // instead of after it. The server applies the same rule inside the transaction that
    // would do the archiving — this is the courtesy copy, not the enforcement.
    throw new ApiError('CONFLICT', blocked);
  }

  const now = new Date().toISOString();
  const after: User = { ...before, status: 'suspended', archivedAt: now, updatedAt: now };

  await engine.mutate({
    mutation: REMOVE_USER,
    variables: { userId },
    optimistic: [{ type: 'user', id: userId, before, after }],
  });
}

/**
 * Brings a deleted issue back.
 *
 * No optimistic patch, and it is the one write in the product that cannot have one: a
 * deleted issue is precisely what the replica threw away when the delete arrived, so there
 * is no `before` to hold and nothing local to put back. The server's upsert is what returns
 * it to the list, one delta later.
 */
export async function restoreIssue(engine: SyncEngine, id: UUID): Promise<Issue> {
  const data = await engine.mutate<{ restoreIssue: { issue: Issue } }>({
    mutation: RESTORE_ISSUE,
    variables: { id },
  });
  // Converted even though nothing here writes it to the store, because a caller that renders
  // the returned issue would otherwise be the one place in the app reading `"MANUAL"` — and
  // the next caller to put it in the store would reintroduce the bug rather than inherit the
  // fix. See web/src/gql/enums.ts.
  return fromWire('issue', data.restoreIssue.issue);
}

/**
 * Why this person cannot be removed, or null when they can.
 *
 * The rule is the server's, restated so a screen can explain it before sending: a workspace
 * must never lose its last active administrator. With nobody left holding `owner` or `admin`
 * there is no one who can invite, change a role, manage billing or delete the workspace, and
 * there is no self-service way back in — the recovery is a support ticket against the
 * database.
 *
 * It counts owners *and* admins because that is what `CountActiveAdminsInWorkspace` counts.
 * A client that refused more than the server does would block a removal that would have been
 * allowed, which is the same support ticket from the other direction.
 */
export function lastAdministratorBlock(store: Store, userId: UUID): string | null {
  const target = store.get('user', userId);
  if (target === undefined) return null;
  if (target.role !== 'owner' && target.role !== 'admin') return null;
  if (target.status !== 'active' || target.archivedAt !== undefined) return null;

  for (const user of store.users.values()) {
    if (user.id === userId) continue;
    if (user.role !== 'owner' && user.role !== 'admin') continue;
    if (user.status !== 'active' || user.archivedAt !== undefined) continue;
    return null;
  }

  const workspace = [...store.workspaces.values()][0];
  const where = workspace === undefined ? 'this workspace' : workspace.name;
  return `${target.displayName} is the only owner ${where} has left. Make somebody else an owner or an admin first, or nobody will be able to invite people, change roles or manage billing.`;
}

/**
 * What removing somebody costs, in the words the confirmation uses.
 *
 * Named rather than counted vaguely because "Are you sure?" is a question nobody can answer:
 * the thing worth knowing before pressing a destructive button is what stops working and
 * what does not.
 */
export function removalConsequence(store: Store, userId: UUID): string {
  const target = store.get('user', userId);
  const name = target?.displayName ?? 'They';
  const teams = countTeams(store, userId);
  const access =
    teams === 0
      ? `${name} loses access to this workspace.`
      : `${name} loses access to this workspace and ${teams === 1 ? 'its 1 team' : `its ${teams} teams`}.`;
  return `${access} Any API keys they made stop working. Their issues and comments stay exactly as they are, still assigned to them and still signed with their name.`;
}

function countTeams(store: Store, userId: UUID): number {
  let teams = 0;
  for (const id of store.membershipIdsForUser(userId)) {
    if (store.get('teamMembership', id) !== undefined) teams++;
  }
  return teams;
}
