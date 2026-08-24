import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider, useKeyContext } from '~/app/keymap';
import {
  Store,
  type Change,
  type Comment,
  type Entity,
  type EntityType,
  type OptimisticPatch,
} from '~/store';
import { detectPlatform } from '~/keys';
import type { SyncEngine } from '~/sync/engine';

import { DescriptionEditor } from './DescriptionEditor';

afterEach(cleanup);

const WORKSPACE = 'workspace-1';
const ISSUE = 'issue-1';
const ADA = 'user-ada';
const AT = '2026-01-01T00:00:00.000Z';
const MINTED = 'comment-from-server';

function comment(id: string, over: Partial<Comment> = {}): Comment {
  return {
    id,
    workspaceId: WORKSPACE,
    issueId: ISSUE,
    body: 'It is the session cookie.',
    actor: { type: 'user', id: ADA },
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

function storeWith(rows: readonly [EntityType, Entity][]): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges(
    rows.map(([type, entity], index) => ({
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

function engineFor(store: Store) {
  const mutate = vi.fn(
    async (input: {
      mutation: string;
      variables: Record<string, unknown>;
      optimistic?: OptimisticPatch;
    }) => {
      if (input.optimistic !== undefined) store.applyOptimistic(input.optimistic);
      if (input.mutation.includes('mutation CreateComment')) {
        const payload = input.variables.input as Record<string, unknown>;
        return {
          createComment: {
            comment: comment(MINTED, {
              body: String(payload.body),
              parentId: payload.parentId === undefined ? undefined : String(payload.parentId),
              anchorStart:
                payload.anchorStart === undefined ? undefined : Number(payload.anchorStart),
              anchorEnd: payload.anchorEnd === undefined ? undefined : Number(payload.anchorEnd),
              quote: payload.quote === undefined ? undefined : String(payload.quote),
            }),
          },
        };
      }
      if (input.mutation.includes('mutation ResolveComment')) {
        const id = String(input.variables.id);
        const existing = store.get('comment', id);
        const resolved = Boolean(input.variables.resolved);
        return {
          resolveComment: {
            comment: comment(id, {
              ...(existing ?? {}),
              resolvedAt: resolved ? AT : undefined,
              resolvedBy: resolved ? ADA : undefined,
            }),
          },
        };
      }
      return {};
    },
  );
  // `succession` and `isProvisional` are part of the engine a composer talks to: a reply
  // asks what its parent is called now before it names it. The identity answer is the one a
  // real engine gives for a row that was never provisional.
  return {
    mutate,
    engine: {
      store,
      mutate,
      succession: (id: string) => id,
      isProvisional: () => false,
    } as unknown as SyncEngine,
  };
}

function Host(props: ComponentProps<typeof DescriptionEditor>) {
  useKeyContext('detail');
  return <DescriptionEditor {...props} />;
}

function mount(
  store: Store,
  description = 'The auth path is wrong.',
  onSave: (next: string) => void = () => {},
) {
  const { mutate, engine } = engineFor(store);
  const view = render(
    <KeymapProvider>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <Host
          issueId={ISSUE}
          description={description}
          names={{ [ADA]: 'Ada' }}
          viewerId={ADA}
          enterSubmits={false}
          onSave={onSave}
        />
      </EngineProvider>
    </KeymapProvider>,
  );
  return { store, mutate, view, user: userEvent.setup() };
}

describe('DescriptionEditor', () => {
  it('paints an existing span and opens its thread on click', async () => {
    const { user } = mount(
      storeWith([
        [
          'comment',
          comment('c1', {
            body: 'It is the session cookie.',
            anchorStart: 4,
            anchorEnd: 13,
            quote: 'auth path',
          }),
        ],
      ]),
    );

    expect(screen.getByText('auth path').tagName).toBe('MARK');

    const area = screen.getByLabelText('Description') as HTMLTextAreaElement;
    await user.click(area);
    area.setSelectionRange(6, 6);
    fireEvent.mouseUp(area);

    expect(screen.getByRole('dialog', { name: 'Comment thread' })).toBeTruthy();
    expect(screen.getByText('It is the session cookie.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeTruthy();
  });

  it('posts an inline comment from a selection', async () => {
    const { user, mutate } = mount(storeWith([]));
    const area = screen.getByLabelText('Description') as HTMLTextAreaElement;
    await user.click(area);
    area.setSelectionRange(4, 13);
    fireEvent.mouseUp(area);

    await user.click(screen.getByRole('button', { name: 'Comment' }));
    await user.type(screen.getByLabelText('Inline comment'), 'Fix the cookie.');
    await user.click(screen.getByRole('button', { name: 'Comment' }));

    expect(mutate).toHaveBeenCalled();
    const call = mutate.mock.calls[0]![0] as unknown as {
      variables: { input: { quote: string; anchorStart: number; anchorEnd: number; body: string } };
    };
    expect(call.variables.input.quote).toBe('auth path');
    expect(call.variables.input.anchorStart).toBe(4);
    expect(call.variables.input.anchorEnd).toBe(13);
    expect(call.variables.input.body).toBe('Fix the cookie.');
  });

  it('starts a comment from ⌘⌥M on a selection', async () => {
    const { user } = mount(storeWith([]));
    const area = screen.getByLabelText('Description') as HTMLTextAreaElement;
    await user.click(area);
    area.setSelectionRange(4, 13);
    const mac = detectPlatform() === 'mac';
    fireEvent.keyDown(area, {
      key: 'm',
      code: 'KeyM',
      metaKey: mac,
      ctrlKey: !mac,
      altKey: true,
    });
    expect(screen.getByLabelText('Inline comment')).toBeTruthy();
  });

  it('resolves an open thread', async () => {
    const { user, mutate } = mount(
      storeWith([
        [
          'comment',
          comment('c1', {
            anchorStart: 4,
            anchorEnd: 13,
            quote: 'auth path',
          }),
        ],
      ]),
    );

    const area = screen.getByLabelText('Description') as HTMLTextAreaElement;
    await user.click(area);
    area.setSelectionRange(6, 6);
    fireEvent.mouseUp(area);

    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(
      mutate.mock.calls.some((call) =>
        String((call[0] as { mutation: string }).mutation).includes('ResolveComment'),
      ),
    ).toBe(true);
  });

  it('saves an edit when the screen goes away without a blur', async () => {
    const onSave = vi.fn();
    const { user, view } = mount(storeWith([]), 'The auth path is wrong.', onSave);
    const area = screen.getByLabelText('Description') as HTMLTextAreaElement;
    await user.click(area);
    await user.type(area, ' Probably.');

    // The back button, a closed tab, a route change: the field is taken away mid-edit and
    // never blurs. Dropping the text would lose the only copy of it.
    view.unmount();

    expect(onSave).toHaveBeenCalledWith('The auth path is wrong. Probably.');
  });

  it('saves an edit when the tab is hidden', async () => {
    const onSave = vi.fn();
    const { user } = mount(storeWith([]), 'The auth path is wrong.', onSave);
    const area = screen.getByLabelText('Description') as HTMLTextAreaElement;
    await user.click(area);
    await user.type(area, ' Probably.');

    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    hidden.mockRestore();

    expect(onSave).toHaveBeenCalledWith('The auth path is wrong. Probably.');
  });

  it('does not save when nothing was typed', async () => {
    const onSave = vi.fn();
    const { user, view } = mount(storeWith([]), 'The auth path is wrong.', onSave);
    await user.click(screen.getByLabelText('Description'));
    view.unmount();
    expect(onSave).not.toHaveBeenCalled();
  });
});
