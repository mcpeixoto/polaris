/**
 * The overview as a document: the title with its emoji, and every update as a card rather
 * than only the latest one.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { ProjectOverview } from './ProjectOverview';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const PROJECT = '01900000-0000-7000-8000-000000000002';
const VIEWER = '01900000-0000-7000-8000-000000000003';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => null,
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

function renderOverview() {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'project', {
      id: PROJECT,
      workspaceId: WORKSPACE,
      name: 'Launch',
      icon: '🚀',
      summary: 'Ship it',
      description: '',
      color: '',
      statusId: 'ps-backlog',
      priority: 0,
      sortOrder: 'a',
      updateSchedule: 'default',
      createdAt: AT,
      updatedAt: AT,
    } as Entity),
    upsert(2, 'projectUpdate', {
      id: 'pu1',
      workspaceId: WORKSPACE,
      projectId: PROJECT,
      health: 'on_track',
      body: 'Started well',
      authorId: VIEWER,
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: AT,
    } as Entity),
    upsert(3, 'projectUpdate', {
      id: 'pu2',
      workspaceId: WORKSPACE,
      projectId: PROJECT,
      health: 'off_track',
      body: 'Then it slipped',
      authorId: VIEWER,
      createdAt: '2026-01-09T00:00:00.000Z',
      updatedAt: AT,
    } as Entity),
  ]);
  const engine = { store, mutate: vi.fn().mockResolvedValue({}) } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[`/project/${PROJECT}`]}>
      <KeymapProvider>
        <EngineProvider
          engine={engine}
          status={{ phase: 'ready', connection: 'ready', pending: 0 }}
        >
          <Routes>
            <Route path="/project/:projectId" element={<ProjectOverview />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('ProjectOverview as a document', () => {
  it('leads with the emoji and the name, then the summary as editable prose', () => {
    renderOverview();
    expect(screen.getByText('Launch')).toBeTruthy();
    expect(screen.getByText('🚀')).toBeTruthy();
    expect((screen.getByLabelText('Summary') as HTMLInputElement).value).toBe('Ship it');
    expect(screen.getByLabelText('Description')).toBeTruthy();
  });

  it('lists every update as a card, newest first, each with its health', () => {
    renderOverview();
    const updates = screen.getByRole('heading', { name: 'Updates' });
    expect(updates).toBeTruthy();
    const bodies = screen
      .getAllByText(/Started well|Then it slipped/)
      .map((node) => node.textContent);
    expect(bodies).toEqual(['Then it slipped', 'Started well']);
    // The composer's health <select> lists the same words, so look for them on a card.
    const onCard = (text: string) =>
      screen.getAllByText(text).some((node) => node.closest('li') !== null);
    expect(onCard('Off track')).toBe(true);
    expect(onCard('On track')).toBe(true);
  });

  it('keeps the composer beneath the cards', () => {
    renderOverview();
    expect(screen.getByLabelText('Update')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Post update' })).toBeTruthy();
  });
});
