/**
 * A timeframe printed at the precision it was actually entered with.
 *
 * The granularity is the difference between a date and a promise: a quarter target is a
 * real day in the database and a three-month window on screen, and printing the day would
 * be the client asserting a precision nobody entered.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { ProjectProperties, formatTimeframe } from './properties';

describe('formatTimeframe', () => {
  it('prints a day as a day', () => {
    expect(formatTimeframe('2026-06-30', 'day')).toMatch(/2026/);
    expect(formatTimeframe('2026-06-30', 'day')).toMatch(/30/);
  });

  it('cuts a month back to its month', () => {
    expect(formatTimeframe('2026-06-30', 'month')).not.toMatch(/30/);
    expect(formatTimeframe('2026-06-30', 'month')).toMatch(/2026/);
  });

  it('names the quarter, the half and the year', () => {
    expect(formatTimeframe('2026-06-30', 'quarter')).toBe('Q2 2026');
    expect(formatTimeframe('2026-01-05', 'quarter')).toBe('Q1 2026');
    expect(formatTimeframe('2026-06-30', 'half')).toBe('H1 2026');
    expect(formatTimeframe('2026-07-01', 'half')).toBe('H2 2026');
    expect(formatTimeframe('2026-06-30', 'year')).toBe('2026');
  });

  it('hands back a date it cannot read rather than printing "Invalid Date"', () => {
    expect(formatTimeframe('not-a-date', 'day')).toBe('not-a-date');
  });
});

/**
 * Membership was read-only in the rail: the avatars were there, and the only way to put
 * somebody on a project was to give them an issue in it.
 */
describe('ProjectProperties members', () => {
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

  it('adds one through the picker, writing a member row', async () => {
    const user = userEvent.setup();
    const store = new Store(WORKSPACE);
    store.applyChanges([
      upsert(1, 'user', {
        id: USER,
        workspaceId: WORKSPACE,
        email: 'ada@example.com',
        displayName: 'Ada Lovelace',
        role: 'member',
        status: 'active',
        createdAt: AT,
        updatedAt: AT,
      } as Entity),
      upsert(2, 'project', {
        id: PROJECT,
        workspaceId: WORKSPACE,
        name: 'Launch',
        description: '',
        color: '',
        statusId: 'ps-backlog',
        priority: 0,
        sortOrder: 'a',
        updateSchedule: 'default',
        createdAt: AT,
        updatedAt: AT,
      } as Entity),
    ]);
    const mutate = vi.fn().mockResolvedValue({});
    const engine = { store, mutate } as unknown as SyncEngine;

    render(
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

    await user.click(screen.getByRole('button', { name: 'Set members' }));
    await user.click(screen.getByRole('menuitem', { name: 'Ada Lovelace' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0]![0].variables).toEqual({ projectId: PROJECT, userId: USER });
    expect(mutate.mock.calls[0]![0].optimistic[0].type).toBe('projectMember');
  });
});
