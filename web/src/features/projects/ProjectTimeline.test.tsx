/**
 * Milestone a11y, the empty-state pointer, and dragging a bar to reschedule.
 *
 * A tick was a hairline with a `title` and `aria-hidden="true"`: a name only a pointer
 * could read. And the empty state said "Add them, and it appears here" without saying where
 * a start and a target date are set. Dragging is the planning surface itself — without a
 * write on pointer-up the canvas is still a picture of dates set elsewhere.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { DEFAULT_PROJECT_DISPLAY, ZOOM_PX_PER_DAY } from './display';
import { ProjectTimeline } from './ProjectTimeline';
import { addDaysUtc } from './timelineDrag';

const WORKSPACE = 'w1';
const AT = '2026-01-01T00:00:00.000Z';
const DAY_MS = 86_400_000;

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

function day(offset: number): string {
  return new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);
}

/** A dated project with one milestone inside its span. */
function seeded(): Store {
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

function renderTimeline(store: Store, mutate = vi.fn().mockResolvedValue({})) {
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <ProjectTimeline teamId={undefined} depFilter="all" display={DEFAULT_PROJECT_DISPLAY} />
      </EngineProvider>
    </MemoryRouter>,
  );
  return { mutate, engine };
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

  it('writes shifted start and target dates when a bar is dragged', async () => {
    const store = seeded();
    const before = store.get('project', 'p1')!;
    const mutate = vi.fn().mockResolvedValue({});
    renderTimeline(store, mutate);

    const bar = document.querySelector('[data-project-id="p1"]') as HTMLElement;
    expect(bar).toBeTruthy();

    const pxPerDay = ZOOM_PX_PER_DAY.month;
    const deltaDays = 3;
    // jsdom has no PointerEvent, and Testing Library's pointer helpers leave button/clientX
    // undefined — which the drag guard treats as a non-primary press. A MouseEvent with the
    // pointer type still reaches React's listener and carries the coordinates.
    act(() => {
      bar.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 100, button: 0 }),
      );
      window.dispatchEvent(
        new MouseEvent('pointermove', {
          bubbles: true,
          clientX: 100 + deltaDays * pxPerDay,
          button: 0,
        }),
      );
      window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    });

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const input = mutate.mock.calls[0]![0].variables.input as Record<string, unknown>;
    expect(input['id']).toBe('p1');
    expect(input['startDate']).toBe(addDaysUtc(before.startDate!, deltaDays));
    expect(input['targetDate']).toBe(addDaysUtc(before.targetDate!, deltaDays));
  });

  it('does not write when the press never leaves the click threshold', async () => {
    const mutate = vi.fn().mockResolvedValue({});
    renderTimeline(seeded(), mutate);

    const bar = document.querySelector('[data-project-id="p1"]') as HTMLElement;
    act(() => {
      bar.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 100, button: 0 }),
      );
      window.dispatchEvent(
        new MouseEvent('pointermove', { bubbles: true, clientX: 102, button: 0 }),
      );
      window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mutate).not.toHaveBeenCalled();
  });
});
