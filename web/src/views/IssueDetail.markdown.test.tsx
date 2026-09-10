/**
 * Comment bodies are markdown on the issue thread.
 *
 * Until this landed they were shown as the source somebody typed — asterisks and all — which
 * told every reader that formatting did nothing. The composer is still a textarea; only the
 * displayed body goes through Markdown.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Comment, type OptimisticPatch, type UUID } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { Comments } from './IssueDetail';

afterEach(cleanup);

const WORKSPACE = 'w1';
const ISSUE = 'i1' as UUID;
const ADA = 'u-ada' as UUID;
const BOB = '11111111-1111-4111-8111-111111111111';
const AT = '2026-01-01T00:00:00.000Z';

function comment(id: string, body: string): Comment {
  return {
    id,
    workspaceId: WORKSPACE,
    issueId: ISSUE,
    body,
    actor: { type: 'user', id: ADA },
    createdAt: AT,
    updatedAt: AT,
  } as Comment;
}

function storeWith(rows: readonly Comment[]): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges(
    rows.map(
      (entity, index) =>
        ({
          v: index + 1,
          type: 'comment',
          id: entity.id,
          op: 'upsert',
          actor: { type: 'user', id: ADA },
          payload: entity,
        }) as Change,
    ),
  );
  return store;
}

function mount(body: string) {
  const row = comment('c1', body);
  const store = storeWith([row]);
  const engine = {
    store,
    mutate: vi.fn(async (input: { optimistic?: OptimisticPatch }) => {
      if (input.optimistic !== undefined) store.applyOptimistic(input.optimistic);
      return {};
    }),
    succession: (id: UUID) => id,
    isProvisional: () => false,
  } as unknown as SyncEngine;

  render(
    <KeymapProvider>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <Comments
          issueId={ISSUE}
          identifier="ENG-1"
          fetched={[]}
          names={{ [ADA]: 'Ada' }}
          viewerId={ADA}
          commands={{ current: {} } as never}
          enterSubmits={false}
        />
      </EngineProvider>
    </KeymapProvider>,
  );
}

describe('comment markdown', () => {
  it('renders emphasis rather than the asterisks somebody typed', () => {
    mount('Please review **this** change');
    expect(screen.getByText('this').tagName).toBe('STRONG');
    expect(screen.queryByText('**this**')).toBeNull();
  });

  it('renders an @mention as @Name rather than the wire token', () => {
    mount(`Can you look @[Bob](user:${BOB})?`);
    const mention = screen.getByText('@Bob');
    expect(mention.tagName).toBe('SPAN');
    expect(mention.getAttribute('data-user-id')).toBe(BOB);
    expect(screen.queryByText(`@[Bob](user:${BOB})`)).toBeNull();
  });
});
