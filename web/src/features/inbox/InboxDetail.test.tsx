/**
 * Answering a mention without leaving the inbox.
 *
 * The pane was read-only, so the commonest thing anybody wants to do with a notification —
 * reply to the person who wrote it — meant opening the issue and finding the way back. The
 * composer posts through `postComment`, so what is asserted here is that a reply from this
 * pane is an ordinary comment on the issue and reaches the replica as one.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import {
  Store,
  type Change,
  type Entity,
  type Issue,
  type User,
  type WorkflowState,
} from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { InboxDetail } from './InboxDetail';

const WORKSPACE = 'w1';
const AT = '2026-08-16T11:00:00.000Z';

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return { v, type, id: entity.id, op: 'upsert', actor: { type: 'system' }, payload: entity };
}

const viewer: User = {
  id: 'u1',
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

const state: WorkflowState = {
  id: 's1',
  workspaceId: WORKSPACE,
  teamId: 't1',
  name: 'In Progress',
  color: '#3366ff',
  category: 'started',
  position: 'V',
  isDefault: false,
  isSystem: false,
  createdAt: AT,
  updatedAt: AT,
};

const issue: Issue = {
  id: 'i1',
  workspaceId: WORKSPACE,
  teamId: 't1',
  number: 4,
  identifier: 'ENG-4',
  title: 'Fix the flake',
  dueDateSource: 'manual',
  description: 'A paragraph about it.',
  stateId: 's1',
  priority: 2,
  sortOrder: 'V',
  createdAt: AT,
  updatedAt: AT,
};

function renderDetail() {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'user', viewer),
    upsert(2, 'workflowState', state),
    upsert(3, 'issue', issue),
  ]);
  const mutate = vi.fn(
    async (input: {
      variables?: Record<string, unknown>;
      optimistic?: Parameters<Store['applyOptimistic']>[0];
    }) => {
      if (input.optimistic !== undefined) store.applyOptimistic(input.optimistic);
      return {};
    },
  );
  const engine = {
    store,
    mutate,
    succession: (id: string) => id,
    isProvisional: () => false,
  } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <InboxDetail issueId="i1" unread={0} />
      </EngineProvider>
    </MemoryRouter>,
  );
  return { store, mutate, user: userEvent.setup() };
}

describe('the inbox detail pane', () => {
  it('posts a reply as a comment on the issue it is about', async () => {
    const { user, mutate, store } = renderDetail();

    const box = screen.getByRole('textbox', { name: 'Reply to ENG-4' });
    await user.type(box, 'On it, thanks.');
    await user.click(screen.getByRole('button', { name: 'Reply' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const input = mutate.mock.calls[0]?.[0].variables as { input: Record<string, unknown> };
    expect(input.input).toMatchObject({ issueId: 'i1', body: 'On it, thanks.' });
    // Optimistic like every other comment: it is in the replica before the request settles.
    expect([...store.comments.values()].map((comment) => comment.body)).toEqual(['On it, thanks.']);
  });

  it('will not post an empty reply', () => {
    renderDetail();
    const button = screen.getByRole('button', { name: 'Reply' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
