/**
 * The initiative fields that had no writer.
 *
 * `NewInitiative` accepted a name, a description, an owner and a parent, and nothing else —
 * so a status, a priority, a lead team and a target date, all of which
 * `CreateInitiativeInput` has always taken, were fields the create dialog could not set. A
 * field dropped on the way to the wire looks exactly like a field that saved, so these
 * assert the variables the mutation sends.
 *
 * They also assert the optimistic row, which is the half that is easy to forget: the create
 * is optimistic, and a provisional that says "planned" while the dialog said "active" is a
 * list row that changes status on its own a second later, once the server's answer arrives.
 */

import { describe, expect, it, vi } from 'vitest';

import { Store, type Initiative } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { createInitiative } from './mutations';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const OWNER = '01900000-0000-7000-8000-000000000002';
const TEAM = '01900000-0000-7000-8000-000000000003';
const PARENT = '01900000-0000-7000-8000-000000000004';
const CREATED = '01900000-0000-7000-8000-00000000000f';

function seeded() {
  const store = new Store(WORKSPACE);
  const mutate = vi.fn().mockResolvedValue({
    createInitiative: {
      initiative: {
        id: CREATED,
        workspaceId: WORKSPACE,
        name: 'Cut p95 latency',
        description: '',
        status: 'ACTIVE',
        priority: 1,
        sortOrder: 'z',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    },
  });
  return { store, mutate, engine: { store, mutate } as unknown as SyncEngine };
}

describe('createInitiative', () => {
  it('sends every field the input accepts, in the wire spelling', async () => {
    const { engine, mutate } = seeded();

    await createInitiative(engine, {
      name: 'Cut p95 latency',
      description: 'Two quarters of work.',
      status: 'active',
      priority: 1,
      ownerId: OWNER,
      leadTeamId: TEAM,
      targetDate: '2026-12-24',
      parentInitiativeId: PARENT,
    });

    const input = mutate.mock.calls[0]![0].variables.input as Record<string, unknown>;
    expect(input).toMatchObject({
      name: 'Cut p95 latency',
      description: 'Two quarters of work.',
      // Enums cross this boundary in the schema's spelling, not the store's.
      status: 'ACTIVE',
      priority: 1,
      ownerId: OWNER,
      leadTeamId: TEAM,
      targetDate: '2026-12-24',
      targetDateGranularity: 'DAY',
      parentInitiativeId: PARENT,
    });
  });

  it('carries the same values into the provisional row', async () => {
    const { engine, mutate } = seeded();

    await createInitiative(engine, {
      name: 'Cut p95 latency',
      description: 'Two quarters of work.',
      status: 'active',
      priority: 1,
      ownerId: OWNER,
      leadTeamId: TEAM,
      targetDate: '2026-12-24',
      targetDateGranularity: 'quarter',
      parentInitiativeId: PARENT,
    });

    const optimistic = mutate.mock.calls[0]![0].optimistic as { after: Initiative }[];
    expect(optimistic[0]!.after).toMatchObject({
      name: 'Cut p95 latency',
      description: 'Two quarters of work.',
      status: 'active',
      priority: 1,
      ownerId: OWNER,
      leadTeamId: TEAM,
      targetDate: '2026-12-24',
      targetDateGranularity: 'quarter',
    });
  });

  it('omits what was not set, and defaults the row the way the server does', async () => {
    const { engine, mutate } = seeded();

    await createInitiative(engine, { name: 'Bare' });

    const call = mutate.mock.calls[0]![0];
    const input = call.variables.input as Record<string, unknown>;
    expect(input.status).toBeUndefined();
    expect(input.priority).toBeUndefined();
    expect(input.leadTeamId).toBeUndefined();
    expect(input.targetDate).toBeUndefined();
    expect(input.parentInitiativeId).toBeUndefined();

    const after = (call.optimistic as { after: Initiative }[])[0]!.after;
    expect(after.status).toBe('planned');
    expect(after.priority).toBe(0);
    expect(after.targetDate).toBeUndefined();
    expect(after.leadTeamId).toBeUndefined();
  });

  /** A target date without a granularity is a day, on the wire and in the row. */
  it('defaults the granularity to a day beside a target date', async () => {
    const { engine, mutate } = seeded();

    await createInitiative(engine, { name: 'Dated', targetDate: '2026-03-31' });

    const call = mutate.mock.calls[0]![0];
    expect((call.variables.input as Record<string, unknown>).targetDateGranularity).toBe('DAY');
    expect((call.optimistic as { after: Initiative }[])[0]!.after.targetDateGranularity).toBe(
      'day',
    );
  });
});
