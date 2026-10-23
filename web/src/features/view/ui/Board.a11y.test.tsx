import { render } from '@testing-library/react';
import axe, { type Result } from 'axe-core';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider, useKeyContext } from '~/app/keymap';
import { DEFAULT_DISPLAY } from '~/filter';
import { Store, type Change, type Issue, type Team, type WorkflowState } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { Board } from './Board';
import type { ViewGroup } from './useView';

/**
 * axe over the board's three column shapes, in jsdom, because `web/e2e/a11y.spec.ts` can
 * only reach one of them.
 *
 * The e2e walk visits `/team/ENG?layout=board` on a fresh workspace, which draws exactly one
 * column with exactly one card in it. The shapes that actually carried the bugs are the other
 * two: an empty column, which is a column with no grid at all because "Nothing here" is a
 * sentence rather than a row, and a folded one, which keeps its header and loses its cards.
 * Both are display state the fixture has no URL for, and both are one `role` away from the
 * `aria-required-children` failure a grid gets for owning content that is not a row.
 *
 * Same two narrowings as the gallery's companion, for the same reasons: `color-contrast`
 * because jsdom computes no layout and loads no stylesheet, so axe has nothing to sample, and
 * `region` because this renders a fragment with no shell around it.
 */

const RULES_OFF = ['color-contrast', 'region'];
const BLOCKING: ReadonlySet<string> = new Set(['serious', 'critical']);
const WORKSPACE = 'workspace-1';
const TEAM = 'team-1';
const AT = '2026-01-01T00:00:00Z';

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
    triageEnabled: false,
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

function issue(number: number, title: string, stateId: string): Issue {
  return {
    id: `issue-${number}`,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number,
    identifier: `ENG-${number}`,
    title,
    dueDateSource: 'manual',
    description: '',
    stateId,
    priority: 0,
    sortOrder: 'V',
    createdAt: AT,
    updatedAt: AT,
  };
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const entities: [string, Team | WorkflowState | Issue][] = [
    ['team', team()],
    ['workflowState', state('s-todo', 'Todo', 'unstarted')],
    ['workflowState', state('s-doing', 'In Progress', 'started')],
    ['workflowState', state('s-review', 'In Review', 'started')],
    ['issue', issue(1, 'Fix the flake', 's-todo')],
    ['issue', issue(2, 'Rewrite the seeder', 's-doing')],
  ];
  store.applyChanges(
    entities.map(([type, entity], index) => ({
      v: index + 1,
      type,
      id: entity.id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload: entity,
    })) as Change[],
  );
  return store;
}

/** Cards, nothing, and folded — the three states a column is ever in. */
const GROUPS: readonly ViewGroup[] = [
  { key: 's-todo', label: 'Todo', stateId: 's-todo', ids: ['issue-1'] },
  { key: 's-review', label: 'In Review', stateId: 's-review', ids: [] },
  { key: 's-doing', label: 'In Progress', stateId: 's-doing', ids: ['issue-2'] },
];

/** The board's registered moves live in the `list` context, which its screen pushes. */
function ListSurface() {
  useKeyContext('list');
  return null;
}

function describeViolations(violations: readonly Result[]): string {
  return violations
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help}\n` +
        v.nodes.map((n) => `    ${n.target.join(' ')}\n      ${n.html.slice(0, 160)}`).join('\n'),
    )
    .join('\n');
}

async function blockingViolations(container: HTMLElement): Promise<Result[]> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    rules: Object.fromEntries(RULES_OFF.map((id) => [id, { enabled: false }])),
  });
  return results.violations.filter((v) => BLOCKING.has(v.impact ?? ''));
}

function renderBoard(collapsed: ReadonlySet<string>) {
  const engine = {
    store: seeded(),
    mutate: vi.fn().mockResolvedValue({ bulkUpdateIssues: { skipped: [] } }),
  } as unknown as SyncEngine;

  return render(
    <KeymapProvider>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <ListSurface />
        <Board
          groups={GROUPS}
          display={{ ...DEFAULT_DISPLAY, layout: 'board' }}
          selected={new Set(['issue-1'])}
          cursorId="issue-1"
          label="Engineering"
          collapsed={collapsed}
          onOpen={vi.fn()}
          onFocus={vi.fn()}
          onToggle={vi.fn()}
          onExtend={vi.fn()}
        />
      </EngineProvider>
    </KeymapProvider>,
  );
}

describe('the board', () => {
  it('has no serious or critical violations with a full column, an empty one, and a selection', async () => {
    const { container } = renderBoard(new Set());

    const blocking = await blockingViolations(container);

    expect(
      blocking.map((v) => v.id),
      describeViolations(blocking),
    ).toEqual([]);
  }, 60_000);

  it('has none with a column folded away', async () => {
    const { container } = renderBoard(new Set(['s-doing']));

    const blocking = await blockingViolations(container);

    expect(
      blocking.map((v) => v.id),
      describeViolations(blocking),
    ).toEqual([]);
  }, 60_000);
});
