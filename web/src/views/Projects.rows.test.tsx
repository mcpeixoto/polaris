/**
 * The projects list as a scan: one flat run of rows, each 39px, each stating the same seven
 * things in the same places.
 *
 * Grouping used to default to priority bands, which put a heading over every projects list
 * in the product and, in most workspaces, one heading reading "No priority" over all of
 * them. Grouping is still a choice — it is in Display and in the URL — but the list opens on
 * the projects rather than on a band.
 *
 * The lead is a face *and* a name. Initials in a coloured disc identify somebody you already
 * knew was in the list; the column exists for the times you did not.
 *
 * The row height is read out of the stylesheet as text, for the reason
 * `Projects.width.test.ts` gives: vitest runs with `css: false` and jsdom does no layout, so
 * the shape of the rule is what can be pinned.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { DEFAULT_PROJECT_DISPLAY } from '~/features/projects/display';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { Projects } from './Projects';

const WORKSPACE = 'w1';
const AT = '2026-01-01T00:00:00.000Z';
const WEEK = 7 * 24 * 60 * 60 * 1000;

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => 'u1',
  useViewer: () => ({ id: 'u1', workspaceId: WORKSPACE, role: 'admin', displayName: 'Ada' }),
  useViewerRole: () => 'admin',
}));

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

function project(id: string, name: string, extra: Record<string, unknown> = {}): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    description: '',
    color: '#5e6ad2',
    statusId: 'ps-started',
    priority: 0,
    sortOrder: id,
    updateSchedule: 'never',
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  } as Entity;
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'projectStatus', {
      id: 'ps-started',
      workspaceId: WORKSPACE,
      name: 'In progress',
      color: '#5e6ad2',
      category: 'started',
      position: 'a',
      isDefault: false,
      createdAt: AT,
      updatedAt: AT,
    } as Entity),
    upsert(2, 'user', {
      id: 'u2',
      workspaceId: WORKSPACE,
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
      role: 'member',
      status: 'active',
      createdAt: AT,
      updatedAt: AT,
    } as Entity),
    upsert(3, 'project', project('p1', 'Launch', { leadId: 'u2', priority: 1 })),
    upsert(4, 'project', project('p2', 'Migrate')),
    upsert(5, 'projectUpdate', {
      id: 'pu1',
      workspaceId: WORKSPACE,
      projectId: 'p1',
      health: 'at_risk',
      body: 'Slipping',
      authorId: 'u1',
      createdAt: new Date(Date.now() - 3 * WEEK).toISOString(),
      updatedAt: AT,
    } as Entity),
  ]);
  return store;
}

function mount(url = '/projects') {
  const engine = { store: seeded(), mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[url]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Projects />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('the projects list', () => {
  it('opens on one flat run of rows, with grouping still on offer', () => {
    expect(DEFAULT_PROJECT_DISPLAY.grouping).toBe('none');

    mount();

    // A band heading is a disclosure button; with no grouping there are none of them, and
    // the two projects — one with a priority, one without — are in the same run.
    expect(screen.queryAllByRole('button', { expanded: true })).toEqual([]);
    const list = screen.getByRole('listbox', { name: 'Projects' });
    expect(within(list).getAllByRole('option')).toHaveLength(2);
  });

  it('quotes the health as a word and an age, in the row', () => {
    mount();

    const row = screen.getByRole('link', { name: /Launch/ });
    expect(within(row).getByText('At risk')).toBeTruthy();
    expect(within(row).getByText('· 3w')).toBeTruthy();
  });

  it('names the lead beside their face', () => {
    mount();

    const row = screen.getByRole('link', { name: /Launch/ });
    expect(within(row).getByText('Ada Lovelace')).toBeTruthy();
  });

  it('keeps the rarer filters behind a control instead of two standing dropdowns', async () => {
    mount();

    expect(screen.queryByLabelText('Customers')).toBeNull();
    expect(screen.queryByLabelText('Dependencies')).toBeNull();

    await userEvent.setup().click(screen.getByRole('button', { name: /^Filter/ }));

    const menu = await screen.findByRole('menu', { name: 'Filter' });
    expect(within(menu).getByRole('menuitem', { name: 'Has violated dependencies' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'Has customer requests' })).toBeTruthy();
  });

  it('draws a row at the list density', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const sheet = readFileSync(join(here, 'Projects.module.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    const at = sheet.indexOf('.row {');
    expect(at).toBeGreaterThan(-1);
    const rule = sheet.slice(sheet.indexOf('{', at) + 1, sheet.indexOf('}', at));
    expect(rule).toContain('height: 39px');
  });
});
