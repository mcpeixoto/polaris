import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { Store, type Change, type Issue, type Team, type UserRole } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { ExportSettings } from './ExportSettings';

/**
 * The workspace export, and the sentence it owes the person who pressed the button.
 *
 * The role comes from the session and not from the replica — a guest's replica holds no
 * `user` rows — so it is mocked at the hook rather than seeded as data. See `useViewer.ts`.
 */
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

function issue(number: number, archived: boolean): Issue {
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
    ...(archived ? { archivedAt: AT } : null),
  };
}

function renderExport(live: number, archived = 0) {
  const store = new Store(WORKSPACE);
  const entities: [string, Team | Issue][] = [['team', team()]];
  for (let n = 1; n <= live; n += 1) entities.push(['issue', issue(n, false)]);
  for (let n = 0; n < archived; n += 1) entities.push(['issue', issue(live + n + 1, true)]);
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

/** jsdom has neither, and the download is the point of the button. */
const written: string[] = [];
beforeEach(() => {
  role.current = 'member';
  written.length = 0;
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:export'),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLElement) {
    written.push((this as HTMLAnchorElement).download);
  });
});

describe('ExportSettings', () => {
  it('says nothing about a cap when the whole workspace fitted', async () => {
    renderExport(3);
    await userEvent.click(screen.getByRole('button', { name: /download issues csv/i }));
    expect(written).toEqual(['issues.csv']);
    expect(screen.queryByRole('status')).toBeNull();
  });

  /**
   * The note used to compare the cap against `store.issues.size`, which counts the archived
   * rows the export loop skips. A workspace of 240 live and 30 archived issues is entirely
   * exported and was told it had been truncated to 250 — a sentence that is wrong twice: no
   * rows were dropped, and 250 is not how many were written.
   */
  it('does not claim a truncation caused by archived rows it never exported', async () => {
    renderExport(240, 30);
    await userEvent.click(screen.getByRole('button', { name: /download issues csv/i }));
    expect(written).toEqual(['issues.csv']);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('names both numbers when the cap really did drop rows', async () => {
    renderExport(260);
    await userEvent.click(screen.getByRole('button', { name: /download issues csv/i }));
    expect(screen.getByRole('status').textContent).toBe(
      'Exported the first 250 of 260 issues. Narrow the list with a filter and export again for the rest.',
    );
  });

  it('refuses a guest rather than downloading an empty file', () => {
    role.current = 'guest';
    renderExport(3);
    expect(screen.queryByRole('button', { name: /download issues csv/i })).toBeNull();
    expect(screen.getByText('Guests cannot export')).toBeTruthy();
  });
});
