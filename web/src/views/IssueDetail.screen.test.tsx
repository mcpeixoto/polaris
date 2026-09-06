/**
 * The issue screen's chrome, as Linear draws it: a breadcrumb header carrying the issue's
 * actions, a properties rail that reads glyph-and-value with an invitation where nothing is
 * set, and an activity heading that owns the subscribe control.
 *
 * Rendered whole rather than a component at a time, because what is asserted here is that
 * every action the old header offered as a labelled button is still reachable — as an icon
 * button, a menu item, or both — after the header stopped having room for words.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity, type OptimisticPatch, type UUID } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { IssueDetail } from './IssueDetail';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const TEAM = '01900000-0000-7000-8000-000000000002';
const TODO = '01900000-0000-7000-8000-000000000003';
const ISSUE = '01900000-0000-7000-8000-000000000004' as UUID;
const VIEWER = '01900000-0000-7000-8000-000000000005' as UUID;
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => ({ id: VIEWER, displayName: 'Ada', role: 'member' }),
  useViewerRole: () => 'member',
}));

// The feed is fetched, not replicated; an empty answer is enough for the chrome.
vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn(async () => ({ comments: [], issueHistory: [] })) };
});

const copyText = vi.fn(async (_value: string) => true);
vi.mock('~/features/github/copy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/features/github/copy')>();
  return { ...actual, copyText: (value: string) => copyText(value) };
});

afterEach(() => {
  cleanup();
  copyText.mockClear();
});

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const rows: [string, Entity][] = [
    [
      'team',
      {
        id: TEAM,
        workspaceId: WORKSPACE,
        key: 'ENG',
        name: 'Engineering',
        timezone: 'UTC',
        private: false,
        estimateScale: 'fibonacci',
        estimateAllowZero: false,
        estimateExtended: false,
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
    [
      'workflowState',
      {
        id: TODO,
        workspaceId: WORKSPACE,
        teamId: TEAM,
        name: 'Todo',
        category: 'unstarted',
        position: 'a',
        isSystem: false,
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
    [
      'user',
      {
        id: VIEWER,
        workspaceId: WORKSPACE,
        displayName: 'Ada',
        email: 'ada@example.com',
        role: 'member',
        kind: 'human',
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
    [
      'issue',
      {
        id: ISSUE,
        workspaceId: WORKSPACE,
        teamId: TEAM,
        number: 7,
        title: 'Ship the importer',
        description: '',
        priority: 0,
        stateId: TODO,
        creatorId: VIEWER,
        dueDateSource: 'manual',
        sortOrder: 'a',
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
  ];
  store.applyChanges(
    rows.map(([type, payload], index) => ({
      v: index + 1,
      type,
      id: (payload as { id: string }).id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload,
    })) as Change[],
  );
  return store;
}

function mount() {
  const store = seeded();
  const mutate = vi.fn(async (input: { optimistic?: OptimisticPatch }) => {
    if (input.optimistic !== undefined) store.applyOptimistic(input.optimistic);
    return {};
  });
  const engine = {
    store,
    mutate,
    succession: (id: string) => id,
    isProvisional: () => false,
  } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/issue/ENG-7']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/issue/:identifier" element={<IssueDetail />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), mutate };
}

describe('the issue header', () => {
  it('names the issue in a breadcrumb and copies its link and identifier', async () => {
    const { user } = mount();

    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Engineering' })).toBeTruthy();
    expect(within(crumbs).getByText('ENG-7')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(copyText).toHaveBeenLastCalledWith(`${window.location.origin}/issue/ENG-7`);

    await user.click(screen.getByRole('button', { name: 'Copy issue identifier' }));
    expect(copyText).toHaveBeenLastCalledWith('ENG-7');
  });

  it('keeps delete as a button and moves the rest behind the menu', async () => {
    const { user } = mount();

    // The confirmation dialog, and nothing quieter, is what the trash button opens.
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    const menu = screen.getByRole('menu', { name: 'More actions' });
    // Subscribe carries its chord in its name, so it is matched on its opening word.
    for (const name of [
      /^Subscribe/,
      'Make recurring',
      'Add customer request',
      'Copy model UUID',
      'Delete',
    ]) {
      expect(within(menu).getByRole('menuitem', { name }), String(name)).toBeTruthy();
    }
  });

  it('stars the issue into the favourites', async () => {
    const { user, mutate } = mount();

    await user.click(screen.getByRole('button', { name: 'Add to favourites' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Remove from favourites' })).toBeTruthy();
  });
});

describe('the properties rail', () => {
  it('reads each unset property as the thing to do about it, and keeps its label', () => {
    mount();

    const rail = screen.getByRole('complementary', { name: 'Properties' });
    expect(within(rail).getByRole('heading', { name: 'Properties' })).toBeTruthy();
    expect(within(rail).getByRole('heading', { name: 'Labels' })).toBeTruthy();
    expect(within(rail).getByRole('heading', { name: 'Project' })).toBeTruthy();

    const rows: [string, string][] = [
      ['Todo', 'Status'],
      ['No priority', 'Priority'],
      ['Unassigned', 'Assignee'],
      ['Set estimate', 'Estimate'],
      ['No due date', 'Due date'],
      ['Add to cycle', 'Cycle'],
      ['Add label', 'Labels'],
      ['Add to project', 'Project'],
    ];
    for (const [value, label] of rows) {
      const trigger = within(rail).getByRole('button', { name: value });
      expect(trigger.getAttribute('aria-describedby'), label).not.toBeNull();
      expect(trigger.getAttribute('aria-haspopup'), label).toBeTruthy();
    }
  });
});

describe('the activity heading', () => {
  it('carries the subscribe control and the comment box follows it', () => {
    mount();

    const activity = screen.getByRole('region', { name: 'Activity' });
    expect(within(activity).getByRole('heading', { name: 'Activity' })).toBeTruthy();
    const subscribe = within(activity).getByRole('button', { name: 'Subscribe' });
    expect(subscribe.getAttribute('aria-pressed')).toBe('false');

    expect(screen.getByPlaceholderText('Leave a comment')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Comment' })).toBeTruthy();
  });
});
