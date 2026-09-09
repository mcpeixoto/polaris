/**
 * The rail as three folding sections rather than one column of rows.
 *
 * Properties, Milestones and Progress. The counts in the last one are the fact the graph
 * cannot state — a project with two issues and no history draws no burn-up at all, and
 * "scope 2, started 1, completed 0" is exactly what its reader wanted from the graph.
 *
 * The fold is remembered, because there is one project rail and a reader who never opens
 * the graph should not have to fold it away on every project they visit.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { ProjectProperties } from './properties';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const PROJECT = '01900000-0000-7000-8000-000000000002';
const USER = '01900000-0000-7000-8000-000000000003';
const AT = '2026-01-01T00:00:00.000Z';

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return {
    v,
    type,
    id: entity.id,
    op: 'upsert',
    actor: { type: 'user', id: USER },
    payload: entity,
  };
}

function state(id: string, name: string, category: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: 't1',
    name,
    color: '#5e6ad2',
    category,
    position: 'a',
    createdAt: AT,
    updatedAt: AT,
  } as Entity;
}

function issue(id: string, stateId: string, extra: Record<string, unknown> = {}): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: 't1',
    number: 1,
    identifier: `ENG-${id}`,
    title: id,
    description: '',
    stateId,
    priority: 0,
    sortOrder: id,
    dueDateSource: 'manual',
    projectId: PROJECT,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  } as Entity;
}

function mount() {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'workflowState', state('s-todo', 'Todo', 'unstarted')),
    upsert(2, 'workflowState', state('s-doing', 'In progress', 'started')),
    upsert(3, 'workflowState', state('s-done', 'Done', 'completed')),
    upsert(4, 'project', {
      id: PROJECT,
      workspaceId: WORKSPACE,
      name: 'Launch',
      description: '',
      color: '',
      statusId: 'ps-backlog',
      priority: 0,
      sortOrder: 'a',
      startDate: '2026-02-02',
      startDateGranularity: 'day',
      targetDate: '2026-06-30',
      targetDateGranularity: 'quarter',
      updateSchedule: 'default',
      createdAt: AT,
      updatedAt: AT,
    } as Entity),
    upsert(5, 'issue', issue('i1', 's-todo')),
    upsert(6, 'issue', issue('i2', 's-doing')),
    upsert(7, 'issue', issue('i3', 's-done', { completedAt: '2026-03-01T00:00:00.000Z' })),
    // Archived work is not scope: it is work that left the project.
    upsert(8, 'issue', issue('i4', 's-todo', { archivedAt: '2026-03-02T00:00:00.000Z' })),
  ]);
  const engine = { store, mutate: vi.fn().mockResolvedValue({}) } as unknown as SyncEngine;
  const view = render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider
          engine={engine}
          status={{ phase: 'ready', connection: 'ready', pending: 0 }}
        >
          <ProjectProperties projectId={PROJECT} />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), view };
}

/** The section with that heading, so a count is read against its own section. */
function section(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('the project rail', () => {
  it('counts the scope, what has started and what is done', () => {
    mount();

    const progress = section('Progress');
    expect(within(progress).getByText('Scope').nextElementSibling?.textContent).toBe('3');
    expect(within(progress).getByText('Started').nextElementSibling?.textContent).toBe('1');
    expect(within(progress).getByText('Completed').nextElementSibling?.textContent).toBe('1');
  });

  it('states both ends of the timeframe on one row', () => {
    mount();

    const dates = screen.getByText('Dates').parentElement as HTMLElement;
    expect(within(dates).getByRole('button', { name: 'Set start date' }).textContent).toContain(
      'Feb',
    );
    expect(within(dates).getByRole('button', { name: 'Set target date' }).textContent).toContain(
      'Q2 2026',
    );
  });

  it('folds a section from its heading, and remembers it folded', async () => {
    const { user, view } = mount();

    const heading = within(section('Progress')).getByRole('button', { name: 'Progress' });
    expect(heading.getAttribute('aria-expanded')).toBe('true');

    await user.click(heading);
    expect(
      within(section('Progress'))
        .getByRole('button', { name: 'Progress' })
        .getAttribute('aria-expanded'),
    ).toBe('false');
    // Properties is a separate fold and is not carried along with it.
    expect(
      within(section('Properties'))
        .getByRole('button', { name: 'Properties' })
        .getAttribute('aria-expanded'),
    ).toBe('true');

    view.unmount();
    mount();
    expect(
      within(section('Progress'))
        .getByRole('button', { name: 'Progress' })
        .getAttribute('aria-expanded'),
    ).toBe('false');
  });
});
