/**
 * Membership writes: a person's role, and whether they can still get in.
 *
 * Both are optimistic like everything else, and both are also *administrative*, which is why
 * the screen that calls them keeps the returned promise and shows what came back. The server
 * has the final say on who may do this — an admin cannot promote themselves past their own
 * role, and nobody may suspend the last owner — and a refusal here is information the user
 * needs rather than a network hiccup to swallow.
 */

import { toWire } from '~/gql/enums';
import { SET_USER_ROLE, SUSPEND_USER } from '~/gql/operations';
import type { User, UserRole, UUID } from '~/store';
import type { SyncEngine } from '~/sync/engine';

export async function setRole(engine: SyncEngine, userId: UUID, role: UserRole): Promise<void> {
  const before = engine.store.get('user', userId);
  if (before === undefined || before.role === role) return;
  const after: User = { ...before, role, updatedAt: new Date().toISOString() };

  await engine.mutate({
    mutation: SET_USER_ROLE,
    // The store's spelling is the database's — `'admin'` — and the argument is declared
    // `UserRole!`, whose values are `OWNER`, `ADMIN`, `MEMBER`, `GUEST`. GraphQL enum values
    // are case-sensitive, so this sent a value the server could only reject: changing a
    // member's role did not work at all, and the optimistic patch made it look as though it
    // had until the rollback landed. See web/src/gql/enums.ts.
    variables: { userId, role: toWire(role) },
    optimistic: [{ type: 'user', id: userId, before, after }],
  });
}

/**
 * Suspends or restores a member.
 *
 * Suspension is not removal, and the difference matters to everything that points at a user:
 * their issues keep their assignee, their comments keep their author, and the row stays in
 * the list greyed rather than turning into an id nobody can resolve. Removing a person from a
 * workspace outright is a different operation and is not in this milestone.
 */
export async function setSuspended(
  engine: SyncEngine,
  userId: UUID,
  suspended: boolean,
): Promise<void> {
  const before = engine.store.get('user', userId);
  if (before === undefined) return;
  const status = suspended ? 'suspended' : 'active';
  if (before.status === status) return;
  const after: User = { ...before, status, updatedAt: new Date().toISOString() };

  await engine.mutate({
    mutation: SUSPEND_USER,
    variables: { userId, suspended },
    optimistic: [{ type: 'user', id: userId, before, after }],
  });
}
