/**
 * SLA rules, where the order is the behaviour.
 *
 * First match wins, so a rule that cannot be moved is a rule whose effect cannot be changed
 * without deleting the whole set and retyping it. These cases guard the two controls that
 * fixed that — the move buttons — and the confirmation that now stands in front of a delete
 * which used to fire on the first click of a ghost button with no accessible name.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { SlaSettings } from './SlaSettings';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => ({
    id: VIEWER,
    workspaceId: WORKSPACE,
    name: 'ada',
    displayName: 'Ada Lovelace',
    timezone: 'UTC',
    role: 'admin',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
  }),
}));

/** The screen is gated on the plan; these cases are about the controls, not the gate. */
vi.mock('~/features/admin/entitlements', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/features/admin/entitlements')>();
  return { ...actual, useEntitlements: () => null, featureBlock: () => null };
});

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return {
    v,
    type,
    id: entity.id,
    op: 'upsert',
    actor: { type: 'user', id: VIEWER },
    payload: entity,
  };
}

const URGENT = 'Priority is Urgent → due in 24 hours';
const HIGH = 'Priority is High → due in 1 week';

function renderSettings(mutate = vi.fn().mockResolvedValue({})) {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'slaRule', {
      id: 'r1',
      workspaceId: WORKSPACE,
      position: 'a',
      filter: { field: 'priority', op: 'eq', values: ['1'] },
      action: 'apply',
      durationMinutes: 1440,
      createdAt: AT,
      updatedAt: AT,
    }),
    upsert(2, 'slaRule', {
      id: 'r2',
      workspaceId: WORKSPACE,
      position: 'b',
      filter: { field: 'priority', op: 'eq', values: ['2'] },
      action: 'apply',
      durationMinutes: 10080,
      createdAt: AT,
      updatedAt: AT,
    }),
  ]);
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <SlaSettings />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { store, mutate, user: userEvent.setup() };
}

/** The rules as the screen has them ordered, read back off the list. */
function ruleOrder(): string[] {
  return screen
    .getAllByRole('listitem')
    .map((row) => row.textContent ?? '')
    .map((text) => (text.includes('Urgent') ? URGENT : HIGH));
}

describe('SlaSettings', () => {
  it('gives every rule a keyboard-operable move, named after the rule', () => {
    renderSettings();
    // Not "Up" four times: a column of identical arrows names nothing, and this list is
    // read one rule at a time.
    expect(screen.getByRole('button', { name: `Move ${HIGH} earlier` })).toBeTruthy();
    expect(screen.getByRole('button', { name: `Move ${URGENT} later` })).toBeTruthy();
    // The first rule cannot go earlier and the last cannot go later.
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: `Move ${URGENT} earlier` }).disabled,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: `Move ${HIGH} later` }).disabled,
    ).toBe(true);
  });

  /**
   * "Earlier" is sent as "put the rule above this one after it", because that is the only
   * move `UpdateSlaRuleInput` can express — it takes an `afterId` and has no "move to top".
   */
  it('raises a rule by lowering the one above it, and reorders on the keystroke', async () => {
    const { mutate, user } = renderSettings();
    expect(ruleOrder()).toEqual([URGENT, HIGH]);

    await user.click(screen.getByRole('button', { name: `Move ${HIGH} earlier` }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const call = mutate.mock.calls[0]![0] as {
      variables: { input: { id: string; afterId: string } };
    };
    expect(call.variables.input).toEqual({ id: 'r1', afterId: 'r2' });
    // The optimistic patch travels on the same call, so the list moves on the keystroke
    // rather than a round trip later. It is asserted here rather than through the rendered
    // order because this harness's `mutate` is a stub that never applies it.
    const optimistic = (
      mutate.mock.calls[0]![0] as {
        optimistic: ReadonlyArray<{ id: string; after: { position: string } }>;
      }
    ).optimistic;
    expect(optimistic).toHaveLength(1);
    expect(optimistic[0]!.id).toBe('r1');
    expect(optimistic[0]!.after.position > 'b').toBe(true);
  });

  it('asks before deleting a rule, and names the rule in the button', async () => {
    const { mutate, user } = renderSettings();

    await user.click(screen.getByRole('button', { name: `Delete ${URGENT}` }));
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Delete this rule' }));
    await waitFor(() => expect(mutate).toHaveBeenCalled());
  });

  it('shows a refused delete inside the dialog rather than behind it', async () => {
    const mutate = vi.fn().mockRejectedValue(new Error('nope'));
    const { user } = renderSettings(mutate);

    await user.click(screen.getByRole('button', { name: `Delete ${URGENT}` }));
    await user.click(screen.getByRole('button', { name: 'Delete this rule' }));

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.textContent).toContain('That rule could not be deleted.'));
  });
});
