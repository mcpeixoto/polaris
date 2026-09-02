/**
 * `<input type="color">` fires on every pixel of a drag through the picker. Recolouring a
 * status wrote one mutation per event, each with an optimistic patch broadcast to every
 * client, so one colour choice was dozens of writes. The swatch now follows the drag from a
 * local draft and only leaving the control writes.
 *
 * A separate file from ProjectStatusSettings.test.tsx so that suite stays as it was.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { ProjectStatusSettings } from './ProjectStatusSettings';

const WORKSPACE = 'w1';
const AT = '2026-01-01T00:00:00.000Z';

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return {
    v,
    type,
    id: entity.id,
    op: 'upsert',
    actor: { type: 'user', id: 'u1' },
    payload: entity,
  };
}

function renderPage() {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'projectStatus', {
      id: 'ps-backlog',
      workspaceId: WORKSPACE,
      name: 'Backlog',
      color: '#6b7280',
      category: 'backlog',
      position: 'a',
      isDefault: true,
      createdAt: AT,
      updatedAt: AT,
    }),
  ]);
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <ProjectStatusSettings />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate };
}

describe('Project status colour', () => {
  it('writes once when the picker is left, not once per event', () => {
    const { mutate } = renderPage();
    const swatch = within(screen.getByRole('group', { name: 'Backlog status' })).getByLabelText(
      'Colour',
    );

    // What a drag through the picker looks like from React's side.
    fireEvent.input(swatch, { target: { value: '#ff0000' } });
    fireEvent.input(swatch, { target: { value: '#ee0000' } });
    fireEvent.input(swatch, { target: { value: '#dd0000' } });
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.blur(swatch);
    expect(mutate).toHaveBeenCalledTimes(1);
    const input = mutate.mock.calls[0]![0] as { variables: { input: { color?: string } } };
    expect(input.variables.input.color).toBe('#dd0000');
  });

  it('writes nothing when the picker is left on the colour it opened with', () => {
    const { mutate } = renderPage();
    const swatch = within(screen.getByRole('group', { name: 'Backlog status' })).getByLabelText(
      'Colour',
    );

    fireEvent.input(swatch, { target: { value: '#ff0000' } });
    fireEvent.input(swatch, { target: { value: '#6b7280' } });
    fireEvent.blur(swatch);
    expect(mutate).not.toHaveBeenCalled();
  });
});
