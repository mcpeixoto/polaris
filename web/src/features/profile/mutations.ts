/**
 * The viewer's own name, display name, avatar, and timezone.
 *
 * There is no "edit somebody else's profile" path. An admin renaming a colleague is not a
 * capability this product needs, and not having it keeps the activity feed from attributing
 * work to a name the person never chose. The server refuses that write; this helper is only
 * ever called with the signed-in user.
 */

import { UPDATE_PROFILE } from '~/gql/operations';
import type { EntityPatch, User, UUID } from '~/store';
import type { SyncEngine } from '~/sync/engine';

export interface ProfileFields {
  readonly name?: string | undefined;
  readonly displayName?: string | undefined;
  readonly avatarUrl?: string | null | undefined;
  readonly timezone?: string | undefined;
}

export async function updateProfile(
  engine: SyncEngine,
  userId: UUID,
  fields: ProfileFields,
): Promise<void> {
  const before = engine.store.users.get(userId);
  if (before === undefined) return;

  const name = fields.name?.trim();
  const displayName = fields.displayName?.trim();
  const timezone = fields.timezone?.trim();
  const after: User = {
    ...before,
    ...(name === undefined || name === '' ? null : { name }),
    ...(displayName === undefined || displayName === '' ? null : { displayName }),
    ...(fields.avatarUrl === undefined
      ? null
      : fields.avatarUrl === null || fields.avatarUrl.trim() === ''
        ? { avatarUrl: undefined }
        : { avatarUrl: fields.avatarUrl.trim() }),
    ...(timezone === undefined || timezone === '' ? null : { timezone }),
    updatedAt: new Date().toISOString(),
  };
  if (sameProfile(before, after)) return;

  const optimistic: EntityPatch = { type: 'user', id: before.id, before, after };

  await engine.mutate({
    mutation: UPDATE_PROFILE,
    variables: {
      input: {
        ...(after.name === before.name ? null : { name: after.name }),
        ...(after.displayName === before.displayName ? null : { displayName: after.displayName }),
        ...(after.avatarUrl === before.avatarUrl ? null : { avatarUrl: after.avatarUrl ?? '' }),
        ...(after.timezone === before.timezone ? null : { timezone: after.timezone }),
      },
    },
    optimistic: [optimistic],
  });
}

function sameProfile(before: User, after: User): boolean {
  return (
    before.name === after.name &&
    before.displayName === after.displayName &&
    before.avatarUrl === after.avatarUrl &&
    before.timezone === after.timezone
  );
}
