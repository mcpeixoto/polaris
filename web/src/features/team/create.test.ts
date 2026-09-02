/**
 * The team key rules, and the two membership writes that were dead code.
 *
 * `suggestTeamKey` is tested against the case that used to post an empty key: a name whose
 * words all start with a digit produces no suggestion at all, and the form has to treat that
 * as "no suggestion" rather than as a value — otherwise the server refuses a field the user
 * was never shown a problem on.
 */

import { describe, expect, it, vi } from 'vitest';

import { Store, type Change, type TeamMembership } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { addTeamMember, removeTeamMember, suggestTeamKey, teamKeyProblem } from './create';

const WORKSPACE = 'workspace-1';
const TEAM = 'team-eng';
const AT = '2026-01-01T00:00:00Z';

describe('suggestTeamKey', () => {
  it('takes the initials of a multi-word name', () => {
    expect(suggestTeamKey('Design Systems')).toBe('DS');
    expect(suggestTeamKey('Core Platform Engineering')).toBe('CPE');
  });

  it('takes the first letters of a single word', () => {
    expect(suggestTeamKey('Platform')).toBe('PLAT');
  });

  // The case that posted an empty key: `cleanTeamKey` strips a leading digit run, so every
  // word of "123 Corp" that starts with a digit is dropped before initials are taken.
  it('suggests nothing for a name with no word starting in a letter', () => {
    expect(suggestTeamKey('123')).toBe('');
    expect(suggestTeamKey('42 - 7')).toBe('');
  });
});

describe('teamKeyProblem', () => {
  it('refuses an empty key rather than letting the form post one', () => {
    expect(teamKeyProblem('', [])).not.toBeNull();
    expect(teamKeyProblem('   ', [])).not.toBeNull();
  });

  it('refuses a key that does not start with a letter', () => {
    expect(teamKeyProblem('1ENG', [])).not.toBeNull();
    expect(teamKeyProblem('EN-G', [])).not.toBeNull();
  });

  it('names the team that already holds the key', () => {
    expect(teamKeyProblem('eng', ['ENG'])).toContain('ENG');
  });

  it('accepts a plain key nobody holds', () => {
    expect(teamKeyProblem('PLAT', ['ENG'])).toBeNull();
  });
});

function membership(id: string, userId: string): TeamMembership {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    userId,
    role: 'member',
    createdAt: AT,
    updatedAt: AT,
  };
}

function engineWith(rows: readonly TeamMembership[]): {
  engine: SyncEngine;
  mutate: ReturnType<typeof vi.fn>;
} {
  const store = new Store(WORKSPACE);
  store.applyChanges(
    rows.map((row, index): Change => ({
      v: index + 1,
      type: 'teamMembership',
      id: row.id,
      op: 'upsert',
      actor: { type: 'system' },
      payload: row,
    })),
  );
  const mutate = vi.fn().mockResolvedValue({});
  return { engine: { store, mutate } as unknown as SyncEngine, mutate };
}

describe('addTeamMember', () => {
  it('sends the role in the spelling a GraphQL enum takes', async () => {
    const { engine, mutate } = engineWith([]);
    await addTeamMember(engine, TEAM, 'user-ada', 'owner');
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]?.variables).toMatchObject({
      teamId: TEAM,
      userId: 'user-ada',
      role: 'OWNER',
    });
  });

  // A picker that offers somebody already on the team would otherwise mint a second
  // membership for a row that is already here.
  it('says nothing when the person is already on the team', async () => {
    const { engine, mutate } = engineWith([membership('m1', 'user-ada')]);
    await addTeamMember(engine, TEAM, 'user-ada');
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe('removeTeamMember', () => {
  // Not optimistic: the server refuses to remove a team's last owner, and that refusal has
  // to reach the caller rather than being papered over by a row that vanished.
  it('lets the server refusal through to the caller', async () => {
    const { engine, mutate } = engineWith([membership('m1', 'user-ada')]);
    mutate.mockRejectedValueOnce(new Error('a team keeps at least one owner'));
    await expect(removeTeamMember(engine, TEAM, 'user-ada')).rejects.toThrow(
      'a team keeps at least one owner',
    );
  });
});
