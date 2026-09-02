/**
 * Two things a milestone tick and an empty timeline owe the reader.
 *
 * A tick was a hairline with a `title` and `aria-hidden="true"`: a name only a pointer
 * could read. And the empty state said "Add them, and it appears here" without saying where
 * a start and a target date are set.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { DEFAULT_PROJECT_DISPLAY } from './display';
import { ProjectTimeline } from './ProjectTimeline';

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

/** A dated project with one milestone inside its span, plus an undated one. */
function seeded(): Store {
  const today = new Date();
  const day = (offset: number) =>
    new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10);

  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'projectStatus', {
      id: 'ps',
      workspaceId: WORKSPACE,
      name: 'In progress',
      color: '#5e6ad2',
      category: 'started',
      position: 'a',
      isDefault: false,
      createdAt: AT,
      updatedAt: AT,
    }),
    upsert(2, 'project', {
      id: 'p1',
      workspaceId: WORKSPACE,
      name: 'Polaris',
      description: '',
      color: '#5e6ad2',
      statusId: 'ps',
      priority: 0,
      sortOrder: 'a',
      updateSchedule: 'default',
      startDate: day(-5),
      targetDate: day(20),
      createdAt: AT,
      updatedAt: AT,
    }),
    upsert(3, 'projectMilestone', {
      id: 'm1',
      workspaceId: WORKSPACE,
      projectId: 'p1',
      name: 'Beta',
      targetDate: day(10),
      sortOrder: 'a',
      createdAt: AT,
      updatedAt: AT,
    }),
  ]);
  return store;
}

function renderTimeline(store: Store) {
  const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <ProjectTimeline teamId={undefined} depFilter="all" display={DEFAULT_PROJECT_DISPLAY} />
      </EngineProvider>
    </MemoryRouter>,
  );
}

describe('ProjectTimeline', () => {
  it('gives every milestone tick an accessible name', () => {
    renderTimeline(seeded());
    const tick = screen.getByRole('img', { name: /Milestone Beta/ });
    expect(tick.getAttribute('aria-hidden')).toBeNull();
  });

  it('points an empty timeline at where dates are set', () => {
    renderTimeline(new Store(WORKSPACE));
    expect(screen.getByText(/properties rail/)).toBeTruthy();
  });
});
