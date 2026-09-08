/**
 * The editing half of the triage pane.
 *
 * `TriagePane.test` covers the four decisions and the cursor they hand on. This covers the
 * five property rows that were text until now, and the one thing about them that is easy to
 * get wrong twice: there are **two** priority pickers on this screen. The guard's one exists
 * to finish a decision a team's "require a priority" rule interrupted, and it advances the
 * queue; the row's one just sets a value and leaves the reviewer where they were. A single
 * picker would either accept issues nobody accepted or make people press Accept twice.
 *
 * The pane registers no shortcuts of its own — `views/Triage` mounts `IssueList` beside it
 * and that list already owns `S`, `A`, `P`, `⇧P` and `L` unguarded in the `list` context —
 * so what is asserted about the keyboard here is only that the caps are drawn. The chords
 * themselves are the list's, and its own tests own them.
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
  type Label,
  type Project,
  type Team,
  type User,
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
const ADA = '01900000-0000-7000-8000-000000000009';
const APOLLO = '01900000-0000-7000-8000-00000000000a';
const BUG = '01900000-0000-7000-8000-00000000000b';
const AT = '2026-01-01T00:00:00.000Z';

let engine: SyncEngine;
let store: Store;
let mutate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  store = seeded();
  mutate = vi.fn(async (input: { optimistic?: Parameters<Store['applyOptimistic']>[0] }) => {
    if (input.optimistic !== undefined) store.applyOptimistic(input.optimistic);
    return {};
  });
  engine = { store, mutate } as unknown as SyncEngine;
});

describe('the triage pane property rows', () => {
  it('draws every value as the control that changes it', () => {
    renderPane();

    for (const name of ['Triage', 'No priority', 'Unassigned', 'No project', 'No labels']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it("teaches the list's chord on the trigger it belongs to", async () => {
    const user = userEvent.setup();
    renderPane();

    await user.hover(screen.getByRole('button', { name: 'Triage' }));

    // The verb in the tooltip and the value in the name, so neither is said twice — and the
    // cap is `S`, which is `IssueList`'s binding acting on the cursor this pane is showing.
    expect(await screen.findByText('Change status')).toBeTruthy();
    expect(screen.getByText('S')).toBeTruthy();
  });

  it('writes the status the picker chose to the issue on screen', async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(screen.getByRole('button', { name: 'Triage' }));
    await user.click(screen.getByRole('menuitem', { name: 'Todo' }));

    expect(store.get('issue', FIRST)?.stateId).toBe(TODO);
  });

  it('writes the assignee the picker chose', async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(screen.getByRole('button', { name: 'Unassigned' }));
    await user.click(screen.getByRole('menuitem', { name: 'Ada' }));

    expect(store.get('issue', FIRST)?.assigneeId).toBe(ADA);
  });

  it('writes the project the picker chose', async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(screen.getByRole('button', { name: 'No project' }));
    await user.click(screen.getByRole('menuitem', { name: 'Apollo' }));

    expect(store.get('issue', FIRST)?.projectId).toBe(APOLLO);
  });

  it('applies the label the picker chose', async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(screen.getByRole('button', { name: 'No labels' }));
    await user.click(screen.getByRole('menuitem', { name: 'Bug' }));

    expect([...store.labelIdsFor(FIRST)]).toEqual([BUG]);
  });

  it('keeps the label chips as links to their views beside the picker', () => {
    store.applyChanges([
      change(10, 'issueLabel', 'il1', {
        id: 'il1',
        workspaceId: WORKSPACE,
        issueId: FIRST,
        labelId: BUG,
        teamId: TEAM,
        createdAt: AT,
      }),
    ]);
    renderPane();

    // The chip navigates and the trigger edits; neither took the other's job.
    expect(screen.getByRole('link', { name: 'Bug' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bug' })).toBeTruthy();
  });

  it('names the assignee row for what it is when nobody holds it', () => {
    renderPane();
    expect(screen.getByRole('button', { name: 'Unassigned' })).toBeTruthy();
    // Not a link, because there is no user to navigate to.
    expect(screen.queryByRole('link', { name: 'Unassigned' })).toBeNull();
  });
});

describe('the two priority pickers', () => {
  it('sets the priority from the row without advancing the queue', async () => {
    const onAdvance = vi.fn();
    const user = userEvent.setup();
    renderPane({ onAdvance });

    await user.click(screen.getByRole('button', { name: 'No priority' }));
    await user.click(screen.getByRole('menuitem', { name: 'Urgent' }));

    expect(store.get('issue', FIRST)?.priority).toBe(1);
    // The whole reason there are two: pricing an issue is not deciding it.
    expect(onAdvance).not.toHaveBeenCalled();
    expect(store.get('issue', FIRST)?.stateId).toBe(TRIAGE);
  });

  it("finishes the decision the guard's picker interrupted, and advances", async () => {
    requirePriority();
    const onAdvance = vi.fn();
    const user = userEvent.setup();
    renderPane({ onAdvance });

    await user.click(screen.getByRole('button', { name: 'Accept' }));
    await user.click(screen.getByRole('menuitem', { name: 'Urgent' }));

    expect(store.get('issue', FIRST)?.priority).toBe(1);
    expect(store.get('issue', FIRST)?.stateId).toBe(TODO);
    expect(onAdvance).toHaveBeenCalledWith(SECOND);
  });
});

describe('the pane context menu', () => {
  it('offers the five properties and the four decisions', async () => {
    const user = userEvent.setup();
    renderPane();

    await user.pointer({ keys: '[MouseRight]', target: screen.getByLabelText('Triage ENG-1') });

    for (const name of ['Status…', 'Assignee…', 'Priority…', 'Project…', 'Labels…']) {
      expect(screen.getByRole('menuitem', { name: new RegExp(`^${name}`) })).toBeTruthy();
    }
    for (const name of ['Accept', 'Mark as duplicate', 'Decline', 'Snooze']) {
      expect(screen.getByRole('menuitem', { name: new RegExp(`^${name}`) })).toBeTruthy();
    }
  });

  it('runs its decisions through the priority guard the buttons use', async () => {
    requirePriority();
    const onAdvance = vi.fn();
    const user = userEvent.setup();
    renderPane({ onAdvance });

    await user.pointer({ keys: '[MouseRight]', target: screen.getByLabelText('Triage ENG-1') });
    await user.click(screen.getByRole('menuitem', { name: /^Accept/ }));

    // The menu is not a way around the rule the Accept button enforces.
    expect(store.get('issue', FIRST)?.stateId).toBe(TRIAGE);
    expect(onAdvance).not.toHaveBeenCalled();
    expect(screen.getByRole('menu', { name: 'Priority' })).toBeTruthy();
  });
});

function requirePriority() {
  store.applyOptimistic([
    {
      type: 'team',
      id: TEAM,
      before: store.get('team', TEAM) ?? null,
      after: { ...team(), triageRequirePriority: true },
    },
  ]);
}

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
    change(7, 'user', ADA, person()),
    change(8, 'project', APOLLO, project()),
    change(9, 'label', BUG, label()),
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

function person(): User {
  return {
    id: ADA,
    workspaceId: WORKSPACE,
    name: 'ada',
    displayName: 'Ada',
    timezone: 'UTC',
    role: 'member',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
  };
}

function project(): Project {
  return {
    id: APOLLO,
    workspaceId: WORKSPACE,
    name: 'Apollo',
    description: '',
    color: '#5e6ad2',
    statusId: 'ps1',
    priority: 0,
    sortOrder: 'V',
    updateSchedule: 'default',
    createdAt: AT,
    updatedAt: AT,
  };
}

/** Workspace-scoped, so it is offered whatever team the issue is in. */
function label(): Label {
  return {
    id: BUG,
    workspaceId: WORKSPACE,
    isGroup: false,
    name: 'Bug',
    color: '#eb5757',
    position: 'V',
    createdAt: AT,
    updatedAt: AT,
  };
}
