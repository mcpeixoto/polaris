import type { Team, UUID } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { MOVE_TEAM } from './operations';

export async function moveTeam(
  engine: SyncEngine,
  teamId: UUID,
  parentTeamId: UUID | null,
): Promise<void> {
  const before = engine.store.get('team', teamId);
  if (before === undefined) return;

  const updatedAt = new Date().toISOString();
  let after: Team;
  if (parentTeamId === null) {
    const { parentTeamId: _removed, ...rest } = before;
    after = { ...rest, updatedAt };
  } else {
    after = { ...before, parentTeamId, updatedAt };
  }

  await engine.mutate({
    mutation: MOVE_TEAM,
    variables: { teamId, parentTeamId },
    optimistic: [{ type: 'team', id: teamId, before, after }],
  });
}
