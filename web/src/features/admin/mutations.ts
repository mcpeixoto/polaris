/**
 * The administration writes.
 *
 * Two of them do not go through `engine.mutate`, and that is the most important thing in
 * this file. Creating an invitation and creating an API key each return a token that exists
 * in that one response and nowhere else — the server stores only its SHA-256 — and the
 * outbox replays a mutation by re-sending its variables and *discarding* the result. A
 * queued create-key that succeeds an hour later would therefore mint a credential nobody can
 * ever read, which is not an offline nicety, it is a key with no token and a revoke button.
 * So both are plain `gql` calls: they succeed now, in front of the person who asked, or they
 * fail now and can be asked for again.
 *
 * Revoking a key or an invitation is a plain call for a quieter version of the same reason.
 * Neither entity is replicated — see the note on `apiKey` in store/types — so there is no
 * optimistic patch for the outbox to protect, and a revoke sitting silently in a queue is
 * worse than a failure the admin can see and retry: the whole point of pressing it is that
 * the credential stops working.
 *
 * Removing a member is the opposite case and goes through the engine as usual: the user row
 * *is* replicated, the server answers with an upsert of the archived row, and the optimistic
 * patch is what takes the person out of the directory on the click rather than on the reply.
 */

import { ApiError, gql } from '~/sync/api';
import type { Issue, Store, User, UUID } from '~/store';
import type { SyncEngine } from '~/sync/engine';
import {
  CREATE_API_KEY,
  INVITE_TO_WORKSPACE,
  REMOVE_USER,
  RESTORE_ISSUE,
  REVOKE_API_KEY,
  REVOKE_INVITE,
} from './operations';

/** A key as a listing may hold it: metadata, and never the token. */
export interface ApiKeySummary {
  readonly id: UUID;
  readonly userId: UUID;
  readonly name: string;
  readonly prefix: string;
  readonly scopes: readonly string[];
  readonly lastUsedAt: string | null;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
}

export interface InviteSummary {
  readonly id: UUID;
  readonly email: string;
  readonly role: string;
  readonly invitedBy: UUID | null;
  readonly teamIds: readonly UUID[];
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface NewInvite {
  readonly email: string;
  readonly role: string;
  readonly teamIds: readonly UUID[];
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
  readonly role: string;
  readonly expiresAt: string;
  readonly token: string;
}

export interface CreatedApiKey {
  readonly key: ApiKeySummary;
  readonly token: string;
}

export interface NewApiKey {
  readonly name: string;
  readonly scopes: readonly string[];
  /** RFC 3339, or absent for a key that does not expire. */
  readonly expiresAt?: string | undefined;
}

export async function inviteToWorkspace(input: NewInvite): Promise<CreatedInvite> {
  const data = await gql<{ inviteToWorkspace: CreatedInvite }>(INVITE_TO_WORKSPACE, {
    input: {
      email: input.email,
      role: input.role.toUpperCase(),
      // Always sent, even empty: the field is a list of teams to join, and omitting it and
      // sending none are the same request.
      teamIds: [...input.teamIds],
    },
  });
  return data.inviteToWorkspace;
}

export async function revokeInvite(id: UUID): Promise<void> {
  await gql(REVOKE_INVITE, { id });
}

export async function createApiKey(input: NewApiKey): Promise<CreatedApiKey> {
  const data = await gql<{ createApiKey: { created: { token: string; apiKey: ApiKeySummary } } }>(
    CREATE_API_KEY,
    {
      input: {
        name: input.name,
        scopes: [...input.scopes],
        ...(input.expiresAt === undefined ? null : { expiresAt: input.expiresAt }),
      },
    },
  );
  const created = data.createApiKey.created;
  return { key: created.apiKey, token: created.token };
}

export async function revokeApiKey(id: UUID): Promise<void> {
  await gql(REVOKE_API_KEY, { id });
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
  return data.restoreIssue.issue;
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
