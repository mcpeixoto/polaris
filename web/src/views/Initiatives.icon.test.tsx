/**
 * The icon in an initiative row is a control, and it is inside the link that opens the
 * initiative.
 *
 * That nesting is the whole reason this file exists. The glyph has to sit where the eye
 * already looks for it — at the head of the name — and the only thing there is the row's
 * link. So the button stops the click before the link ever sees it, and the two assertions
 * below are the two halves of that bargain: the picker opens, and the screen does not move.
 *
 * The picker's own internals are not tested here. This file knows two things about it, both
 * of them public: the dialog carries the `label` it was given, and its colour dots are named
 * — picking one writes through `updateInitiative` for the row that was clicked, not for
 * whichever row happened to be first.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { Initiatives } from './Initiatives';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => ({ id: VIEWER, role: 'member', displayName: 'Ada' }),
}));

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

function initiative(id: string, name: string, sortOrder: string, icon?: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    description: '',
    status: 'planned',
    priority: 0,
    sortOrder,
    createdAt: AT,
    updatedAt: AT,
    ...(icon === undefined ? null : { icon, color: '#6b7280' }),
  } as Entity;
}

function renderList() {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'initiative', initiative('i1', 'Platform reliability', 'a')),
    upsert(2, 'initiative', initiative('i2', 'Mobile launch', 'b', 'icon:rocket')),
  ]);
  const mutate = vi.fn(async () => ({}));
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/initiatives']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/initiatives" element={<Initiatives />} />
            <Route path="/initiative/:initiativeId" element={<Opened />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, user: userEvent.setup() };
}

/** Where a navigation would land, so a test can say that none happened. */
function Opened() {
  const { initiativeId } = useParams<{ initiativeId: string }>();
  return <p>opened {initiativeId}</p>;
}

/** The `input` of the last mutation the engine was handed. */
function lastInput(mutate: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const calls = mutate.mock.calls;
  const call = calls[calls.length - 1]![0] as { variables: { input: Record<string, unknown> } };
  return call.variables.input;
}

describe('Initiative row icon', () => {
  it('opens the icon picker without opening the initiative', async () => {
    const { user } = renderList();
    await user.click(screen.getByRole('button', { name: 'Change icon for Platform reliability' }));
    expect(screen.getByRole('dialog', { name: 'Initiative icon' })).toBeTruthy();
    expect(screen.queryByText('opened i1')).toBeNull();
    expect(screen.getByText('Platform reliability')).toBeTruthy();
  });

  it('writes the colour against the initiative whose icon was clicked', async () => {
    const { mutate, user } = renderList();
    await user.click(screen.getByRole('button', { name: 'Change icon for Mobile launch' }));
    const panel = screen.getByRole('dialog', { name: 'Initiative icon' });
    await user.click(within(panel).getByRole('button', { name: 'Green' }));

    expect(mutate).toHaveBeenCalled();
    const input = lastInput(mutate);
    expect(input.id).toBe('i2');
    expect(input.color).toBe('#16a34a');
    // One half per act: the glyph did not move, so it is not on the wire.
    expect(input.icon).toBeUndefined();
  });
});
