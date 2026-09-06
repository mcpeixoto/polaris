/**
 * The export card: the cap and the warning about the tab freezing are on the card before
 * the button, and the note about what the file held lands in the button's own row.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { Store, type Change, type Issue, type Team, type UserRole } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { ExportSettings } from './ExportSettings';

const role: { current: UserRole | null } = { current: 'member' };
vi.mock('~/hooks/useViewer', () => ({
  useViewerRole: () => role.current,
}));

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

function issue(number: number): Issue {
  return {
    id: `issue-${number}`,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number,
    identifier: `ENG-${number}`,
    title: `Issue ${number}`,
    description: '',
    stateId: 's-todo',
    priority: 0,
    sortOrder: 'V',
    dueDateSource: 'manual',
    createdAt: AT,
    updatedAt: AT,
  };
}

function renderExport(live: number) {
  const store = new Store(WORKSPACE);
  const entities: [string, Team | Issue][] = [['team', team()]];
  for (let n = 1; n <= live; n += 1) entities.push(['issue', issue(n)]);
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
  const engine = { store, mutate: vi.fn().mockResolvedValue({}) } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/settings/export']}>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <ExportSettings />
      </EngineProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  role.current = 'member';
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:export'),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

describe('ExportSettings rows', () => {
  it('states the cap and the freeze before the button, on the same card', async () => {
    renderExport(3);

    expect(await screen.findByRole('heading', { level: 1, name: 'Export' })).toBeTruthy();
    const heading = screen.getByRole('heading', { level: 2, name: 'Workspace issues' });
    const section = heading.closest('section') as HTMLElement;
    expect(section.textContent).toContain('This file holds at most 250 issues');
    expect(section.textContent).toContain('makes this tab unresponsive');
    expect(screen.getByRole('button', { name: 'Download issues CSV' })).toBeTruthy();
  });

  it('puts the note about a truncated file beside the button that made it', async () => {
    renderExport(260);
    const button = screen.getByRole('button', { name: 'Download issues CSV' });
    await userEvent.click(button);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('first 250 of 260');
    expect(status.parentElement).toBe(button.parentElement);
  });

  it('keeps the guest refusal as an empty state on the card', () => {
    role.current = 'guest';
    renderExport(3);
    expect(screen.getByText('Guests cannot export')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Download issues CSV' })).toBeNull();
  });
});
