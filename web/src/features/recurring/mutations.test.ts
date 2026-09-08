/**
 * Editing a schedule in place.
 *
 * `UPDATE_RECURRING_ISSUE` sat in `operations.ts` with no caller from the day it was written,
 * so a cadence chosen once could not be changed: the only way off a weekly standup was to
 * stop the schedule and write a new one, which loses its identity and every issue's link
 * back to it. What is pinned here is the wire spelling — the store holds a cadence lowercase
 * and the API takes it shouted — and that a dialog confirmed unchanged costs nothing.
 */

import { describe, expect, it, vi } from 'vitest';

import { Store, type Change, type Entity, type RecurringIssue } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { updateRecurringIssue } from './mutations';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const TEAM = '01900000-0000-7000-8000-000000000002';
const SCHEDULE = '01900000-0000-7000-8000-000000000003';
const AT = '2026-01-01T00:00:00.000Z';

const existing: RecurringIssue = {
  id: SCHEDULE,
  workspaceId: WORKSPACE,
  teamId: TEAM,
  title: 'Team standup',
  body: '',
  properties: {},
  cadence: 'weekly',
  nextDueDate: '2026-02-02',
  createdAt: AT,
  updatedAt: AT,
};

function seeded() {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    {
      v: 1,
      type: 'recurringIssue',
      id: SCHEDULE,
      op: 'upsert',
      actor: { type: 'user', id: 'u1' },
      payload: existing as Entity,
    } as Change,
  ]);
  const mutate = vi.fn().mockResolvedValue({});
  return { store, mutate, engine: { store, mutate } as unknown as SyncEngine };
}

describe('updateRecurringIssue', () => {
  it('sends the cadence in the enum spelling and patches the row in the same frame', async () => {
    const { engine, mutate } = seeded();

    await updateRecurringIssue(engine, SCHEDULE, {
      cadence: 'monthly',
      nextDueDate: '2026-03-01',
    });

    const call = mutate.mock.calls[0]![0];
    expect(call.variables.input).toEqual({
      id: SCHEDULE,
      cadence: 'MONTHLY',
      nextDueDate: '2026-03-01',
    });
    // The optimistic row keeps the store's own spelling; only the wire is shouted.
    expect(call.optimistic[0]).toMatchObject({ type: 'recurringIssue', id: SCHEDULE });
    expect(call.optimistic[0].before.cadence).toBe('weekly');
    expect(call.optimistic[0].after.cadence).toBe('monthly');
    expect(call.optimistic[0].after.nextDueDate).toBe('2026-03-01');
  });

  it('changes the cadence without re-dating the next occurrence', async () => {
    const { engine, mutate } = seeded();

    await updateRecurringIssue(engine, SCHEDULE, { cadence: 'daily' });

    expect(mutate.mock.calls[0]![0].variables.input).toEqual({ id: SCHEDULE, cadence: 'DAILY' });
    expect(mutate.mock.calls[0]![0].optimistic[0].after.nextDueDate).toBe('2026-02-02');
  });

  it('costs nothing when the dialog was confirmed unchanged', async () => {
    const { engine, mutate } = seeded();

    await updateRecurringIssue(engine, SCHEDULE, {
      cadence: 'weekly',
      nextDueDate: '2026-02-02',
    });

    expect(mutate).not.toHaveBeenCalled();
  });

  it('does nothing for a schedule this replica does not hold', async () => {
    const { engine, mutate } = seeded();

    await updateRecurringIssue(engine, '01900000-0000-7000-8000-0000000000ff', {
      cadence: 'yearly',
    });

    expect(mutate).not.toHaveBeenCalled();
  });
});
