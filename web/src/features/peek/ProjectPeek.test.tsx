/**
 * The project peek: what it draws, and what it says when there is nothing to draw.
 *
 * It shares its stylesheet, its header and its rail rows with the issue peek, so what is
 * worth holding still here is the half that is this panel's own — which project it reads,
 * which facts it shows, and that a cursor on nothing is a sentence rather than a blank
 * drawer.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { ProjectPeek } from './ProjectPeek';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const STATUS = '01900000-0000-7000-8000-000000000002';
const LEAD = '01900000-0000-7000-8000-000000000003';
const PROJECT = '01900000-0000-7000-8000-000000000004';
const AT = '2026-01-01T00:00:00.000Z';

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const rows: [string, Entity][] = [
    [
      'projectStatus',
      {
        id: STATUS,
        workspaceId: WORKSPACE,
        name: 'In progress',
        color: '#5e6ad2',
        category: 'started',
        position: 'a',
        isDefault: true,
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
    [
      'user',
      {
        id: LEAD,
        workspaceId: WORKSPACE,
        email: 'ada@example.com',
        displayName: 'Ada Lovelace',
        role: 'member',
        status: 'active',
        kind: 'human',
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
    [
      'project',
      {
        id: PROJECT,
        workspaceId: WORKSPACE,
        name: 'Orbital launch',
        summary: 'Get the thing off the ground.',
        description: 'The long form nobody reads at a glance.',
        color: '#5e6ad2',
        statusId: STATUS,
        priority: 1,
        leadId: LEAD,
        sortOrder: 'a',
        targetDate: '2026-06-30',
        targetDateGranularity: 'quarter',
        updateSchedule: 'never',
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

function renderPeek(projectId: string | null, onClose?: () => void) {
  const engine = { store: seeded(), mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <EngineProvider engine={engine} status={{ phase: 'idle' }}>
      <ProjectPeek open projectId={projectId} onClose={onClose} />
    </EngineProvider>,
  );
  return userEvent.setup();
}

describe('ProjectPeek', () => {
  it('draws the project under the cursor, with the facts the page leads on', () => {
    renderPeek(PROJECT);

    const panel = screen.getByRole('complementary', { name: 'Peek Orbital launch' });
    expect(panel.textContent).toContain('In progress');
    // The summary, not the long description: a glance is one sentence.
    expect(panel.textContent).toContain('Get the thing off the ground.');
    expect(panel.textContent).not.toContain('The long form nobody reads');
    expect(panel.textContent).toContain('Ada Lovelace');
    expect(panel.textContent).toContain('Q2 2026');
    expect(panel.textContent).toContain('Urgent');
  });

  it('says what to do when the cursor is on nothing', () => {
    renderPeek(null);

    expect(screen.getByText('Nothing under the cursor')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close peek' })).toBeNull();
  });

  it('closes through the control when the list supplies one', async () => {
    const onClose = vi.fn();
    const user = renderPeek(PROJECT, onClose);

    await user.click(screen.getByRole('button', { name: 'Close peek' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
