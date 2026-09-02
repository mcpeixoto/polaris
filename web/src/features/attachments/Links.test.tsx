import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Issue, type Team } from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { Links } from './Links';

const AT = '2026-01-01T00:00:00Z';

function seeded(): Store {
  const store = new Store('w1');
  const team: Team = {
    id: 't1',
    workspaceId: 'w1',
    key: 'ENG',
    name: 'Engineering',
    timezone: 'UTC',
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
  const issue: Issue = {
    id: 'i1',
    workspaceId: 'w1',
    teamId: 't1',
    number: 1,
    identifier: 'ENG-1',
    title: 'Broken importer',
    description: '',
    stateId: 's1',
    priority: 0,
    sortOrder: 'a0',
    dueDateSource: 'manual',
    createdAt: AT,
    updatedAt: AT,
  };
  store.applyChanges([
    {
      v: 1,
      type: 'team',
      id: team.id,
      op: 'upsert',
      actor: { type: 'system' },
      payload: team,
    } as Change,
    {
      v: 2,
      type: 'issue',
      id: issue.id,
      op: 'upsert',
      actor: { type: 'system' },
      payload: issue,
    } as Change,
    {
      v: 3,
      type: 'attachment',
      id: 'a1',
      op: 'upsert',
      actor: { type: 'system' },
      payload: {
        id: 'a1',
        workspaceId: 'w1',
        issueId: 'i1',
        teamId: 't1',
        url: 'https://github.com/acme/app/pull/4',
        title: 'PR 4',
        createdAt: AT,
        updatedAt: AT,
      },
    } as Change,
  ]);
  return store;
}

describe('Links', () => {
  it('lists a link from the replica, not a spinner', () => {
    const store = seeded();
    const engine = { store, mutate: vi.fn().mockResolvedValue({}) } as unknown as SyncEngine;
    render(
      <MemoryRouter>
        <KeymapProvider>
          <EngineProvider engine={engine} status={{ phase: 'idle' }}>
            <Links issueId="i1" />
          </EngineProvider>
        </KeymapProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Links' })).toBeTruthy();
    const link = screen.getByRole('link', { name: /PR 4/ });
    expect(link.getAttribute('href')).toBe('https://github.com/acme/app/pull/4');
  });
});

/**
 * The server refuses a URL it cannot parse and one over 2048 characters, and the optimistic
 * card is rolled back either way — so before this the person who pasted it watched their link
 * appear and then vanish, with the reason in a console nobody had open.
 */
describe('Links, when the server will not take one', () => {
  it('says why, and puts the URL back in the box', async () => {
    const store = seeded();
    const mutate = vi.fn(async () => {
      throw new ApiError('VALIDATION', 'that is not a URL');
    });
    const engine = { store, mutate } as unknown as SyncEngine;
    render(
      <MemoryRouter>
        <KeymapProvider>
          <EngineProvider engine={engine} status={{ phase: 'idle' }}>
            <Links issueId="i1" />
          </EngineProvider>
        </KeymapProvider>
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Paste a URL'), 'not a url');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect((await screen.findByRole('alert')).textContent).toBe('that is not a URL');
    expect((screen.getByPlaceholderText('Paste a URL') as HTMLInputElement).value).toBe(
      'not a url',
    );
  });
});
