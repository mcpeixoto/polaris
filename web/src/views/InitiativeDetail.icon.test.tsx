/**
 * The Icon row in the initiative rail.
 *
 * The icon used to be settable in the create dialog and nowhere afterwards, which made the
 * one property somebody picks before they know anything about the objective the one property
 * they could never revise. This row is the revision, and it sits first because it is the only
 * property that changes how the initiative is recognised on every other screen.
 *
 * Two things are checked: the row opens the picker, and a glyph chosen there reaches
 * `updateInitiative` as the stored `icon:<name>` token rather than the words the button is
 * called by. The row also reads a stored token back in words, which is what stops a rail
 * saying "icon:git-branch" at somebody.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { InitiativeDetail } from './InitiativeDetail';
import { InitiativeShell } from './InitiativeShell';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
const INITIATIVE = 'i1';
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

function renderDetail({ icon, color }: { icon?: string; color?: string } = {}) {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'user', {
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
    upsert(2, 'initiative', {
      id: INITIATIVE,
      workspaceId: WORKSPACE,
      name: 'Platform reliability',
      description: '',
      status: 'planned',
      priority: 0,
      ownerId: VIEWER,
      sortOrder: 'a',
      createdAt: AT,
      updatedAt: AT,
      ...(icon === undefined ? null : { icon }),
      ...(color === undefined ? null : { color }),
    } as Entity),
  ]);
  const mutate = vi.fn(async (_request: unknown) => ({}));
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[`/initiative/${INITIATIVE}`]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/initiative/:initiativeId" element={<InitiativeShell />}>
              <Route index element={<InitiativeDetail />} />
            </Route>
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, user: userEvent.setup() };
}

/** The rail's row, told apart from the breadcrumb's mark by the verb it is named with. */
function iconRow(): HTMLElement {
  return screen.getByRole('button', { name: 'Set icon' });
}

describe('Initiative rail icon', () => {
  it('offers the verb when nothing is set', () => {
    renderDetail();
    expect(within(iconRow()).getByText('Set icon')).toBeTruthy();
  });

  it('reads a stored token back in words', () => {
    renderDetail({ icon: 'icon:git-branch', color: '#16a34a' });
    expect(within(iconRow()).getByText('Git branch')).toBeTruthy();
  });

  it('shows an emoji back as it was typed', () => {
    renderDetail({ icon: '🚀' });
    // Twice, and both are meant: the row draws the glyph and then says what it is, and for
    // an emoji the only name anybody agrees on is the emoji.
    expect(within(iconRow()).getAllByText('🚀')).toHaveLength(2);
  });

  it('puts a named control in the breadcrumb too, not a hidden one', async () => {
    const { mutate, user } = renderDetail();
    // The crumb's mark goes in the Breadcrumb's `control` slot rather than its `icon` slot,
    // which is aria-hidden — a focusable button in there is a tab stop nothing announces.
    await user.click(screen.getByRole('button', { name: 'Change initiative icon' }));
    const panel = screen.getByRole('dialog', { name: 'Initiative icon' });
    await user.click(within(panel).getByRole('button', { name: 'Green' }));

    const call = mutate.mock.calls.at(-1)![0] as {
      variables: { input: Record<string, unknown> };
    };
    expect(call.variables.input.color).toBe('#16a34a');
  });

  it('opens the picker and writes the chosen glyph as a token', async () => {
    // Seeded with a token, so the panel opens on the tab that token lives on. Which tab an
    // empty icon opens is the picker's business and it has changed its mind about it; this
    // test is about what the rail writes, not about where the grid starts.
    const { mutate, user } = renderDetail({ icon: 'icon:cube' });
    await user.click(iconRow());

    const panel = screen.getByRole('dialog', { name: 'Initiative icon' });
    await user.click(within(panel).getByRole('button', { name: 'Rocket' }));

    expect(mutate).toHaveBeenCalled();
    const call = mutate.mock.calls.at(-1)![0] as {
      variables: { input: Record<string, unknown> };
    };
    expect(call.variables.input.id).toBe(INITIATIVE);
    expect(call.variables.input.icon).toBe('icon:rocket');
    // The glyph moved, not the colour, so only the glyph is on the wire.
    expect(call.variables.input.color).toBeUndefined();
  });
});
