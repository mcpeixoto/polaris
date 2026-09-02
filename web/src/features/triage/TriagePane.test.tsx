/**
 * The decision half of triage.
 *
 * What is worth pinning here is not that the buttons call the mutations — it is that they
 * hand the cursor on to the row that follows, and that they read that row from the queue
 * *before* the write empties it. That ordering is the whole reason the screen is usable at
 * forty rows, and it is invisible in the source unless somebody asserts it.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import {
  Store,
  type Change,
  type Entity,
  type EntityType,
  type Issue,
  type Team,
  type WorkflowState,
} from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { TriagePane } from './TriagePane';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const TEAM = '01900000-0000-7000-8000-000000000002';
const TODO = '01900000-0000-7000-8000-000000000003';
const CANCELED = '01900000-0000-7000-8000-000000000004';
const TRIAGE = '01900000-0000-7000-8000-000000000005';
const FIRST = '01900000-0000-7000-8000-000000000007';
const SECOND = '01900000-0000-7000-8000-000000000008';
const AT = '2026-01-01T00:00:00.000Z';

let engine: SyncEngine;
let store: Store;

beforeEach(() => {
  store = seeded();
  const mutate = vi.fn(async (input: { optimistic?: Parameters<Store['applyOptimistic']>[0] }) => {
    if (input.optimistic !== undefined) store.applyOptimistic(input.optimistic);
    return {};
  });
  engine = { store, mutate } as unknown as SyncEngine;
});

describe('TriagePane', () => {
  it('shows the issue under the cursor and its four decisions', () => {
    renderPane();
    expect(screen.getByLabelText('Issue title')).toHaveProperty('value', 'Crash on import');
    expect(screen.getByText('The file has a BOM.')).toBeTruthy();
    for (const name of ['Accept', 'Mark duplicate', 'Decline', 'Snooze']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('accepts into the team default and moves on to the next row', async () => {
    const onAdvance = vi.fn();
    const user = userEvent.setup();
    renderPane({ onAdvance });

    await user.click(screen.getByRole('button', { name: 'Accept' }));

    expect(store.get('issue', FIRST)?.stateId).toBe(TODO);
    // The next id, not the head of the queue the write has just reshaped.
    expect(onAdvance).toHaveBeenCalledWith(SECOND);
  });

  it('declines into canceled and moves on', async () => {
    const onAdvance = vi.fn();
    const user = userEvent.setup();
    renderPane({ onAdvance });

    await user.click(screen.getByRole('button', { name: 'Decline' }));

    expect(store.get('issue', FIRST)?.stateId).toBe(CANCELED);
    expect(onAdvance).toHaveBeenCalledWith(SECOND);
  });

  it('asks for a priority before letting work leave a team that requires one', async () => {
    store.applyOptimistic([
      {
        type: 'team',
        id: TEAM,
        before: store.get('team', TEAM) ?? null,
        after: { ...team(), triageRequirePriority: true },
      },
    ]);
    const onAdvance = vi.fn();
    const user = userEvent.setup();
    renderPane({ onAdvance });

    await user.click(screen.getByRole('button', { name: 'Accept' }));

    // Still in triage, and nobody has been moved on: the picker is the answer to the
    // question the server would have refused.
    expect(store.get('issue', FIRST)?.stateId).toBe(TRIAGE);
    expect(onAdvance).not.toHaveBeenCalled();
    expect(screen.getByRole('menu', { name: 'Priority' })).toBeTruthy();
  });

  it('says the queue is empty rather than drawing a blank pane', () => {
    renderPane({ issueId: null, queueIds: [] });
    expect(screen.getByText('Nothing to review')).toBeTruthy();
  });
});

function renderPane(
  props: {
    issueId?: string | null;
    queueIds?: readonly string[];
    onAdvance?: (next: string | null) => void;
  } = {},
) {
  const { issueId = FIRST, queueIds = [FIRST, SECOND], onAdvance = () => {} } = props;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <TriagePane issueId={issueId} queueIds={queueIds} onAdvance={onAdvance} />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    change(1, 'team', TEAM, team()),
    change(2, 'workflowState', TODO, state(TODO, 'Todo', 'unstarted')),
    change(3, 'workflowState', CANCELED, state(CANCELED, 'Canceled', 'canceled')),
    change(4, 'workflowState', TRIAGE, state(TRIAGE, 'Triage', 'triage')),
    change(5, 'issue', FIRST, issue(FIRST, 1, 'Crash on import', 'The file has a BOM.')),
    change(6, 'issue', SECOND, issue(SECOND, 2, 'Slow search', '')),
  ]);
  return store;
}

function change(v: number, type: EntityType, id: string, payload: Entity): Change {
  return { v, type, id, op: 'upsert', actor: { type: 'system' }, payload };
}

function team(): Team {
  return {
    id: TEAM,
    workspaceId: WORKSPACE,
    key: 'ENG',
    name: 'Engineering',
    timezone: 'Europe/Lisbon',
    private: false,
    estimateScale: 'none',
    estimateAllowZero: false,
    estimateExtended: false,
    cyclesEnabled: false,
    cycleDurationWeeks: 1,
    cycleCooldownWeeks: 0,
    cycleStartDay: 'monday',
    cycleUpcomingCount: 2,
    cycleAutoAddStarted: false,
    cycleAutoAddCompleted: false,
    triageEnabled: true,
    triageRequirePriority: false,
    autoCloseDays: 0,
    autoArchiveDays: 0,
    autoCloseParent: false,
    autoCloseChildren: false,
    createdAt: AT,
    updatedAt: AT,
  };
}

function state(id: string, name: string, category: WorkflowState['category']): WorkflowState {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    name,
    color: '#5e6ad2',
    category,
    position: 'V',
    isDefault: category === 'unstarted',
    isSystem: false,
    createdAt: AT,
    updatedAt: AT,
  };
}

function issue(id: string, number: number, title: string, description: string): Issue {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number,
    identifier: `ENG-${number}`,
    title,
    description,
    stateId: TRIAGE,
    priority: 0,
    sortOrder: `a${number}`,
    dueDateSource: 'manual',
    createdAt: AT,
    updatedAt: AT,
  };
}
