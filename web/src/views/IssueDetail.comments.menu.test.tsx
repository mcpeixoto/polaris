/**
 * The comment row's menu, under both gestures.
 *
 * The three buttons beside a comment's timestamp are still the fast path; the menu is the
 * same three commands where somebody arriving from Linear reaches for them. So what is
 * asserted here is not that either menu holds a particular row — it is that the ⋯ menu and
 * the right-click are one list, that the list obeys the same `canEdit`/`canDelete` gates the
 * buttons do, and that the destructive row still goes through the confirmation rather than
 * straight to the wire.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Comment, type OptimisticPatch, type UUID } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { Comments } from './IssueDetail';

const WORKSPACE = 'w1';
const ISSUE = 'i1' as UUID;
const ADA = 'u-ada' as UUID;
const GREY = 'u-grey' as UUID;
const AT = '2026-01-01T00:00:00.000Z';

/** Who is reading, and with what powers. Rewritten per test before mounting. */
const viewer = { id: ADA as UUID | null, role: 'member' as string | null };

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => viewer.id,
  useViewer: () => ({ id: viewer.id, displayName: 'Ada', role: viewer.role }),
  useViewerRole: () => viewer.role,
}));

afterEach(() => {
  cleanup();
  viewer.id = ADA;
  viewer.role = 'member';
});

function comment(id: string, over: Partial<Comment> = {}): Comment {
  return {
    id,
    workspaceId: WORKSPACE,
    issueId: ISSUE,
    body: 'The first thing anybody said.',
    actor: { type: 'user', id: ADA },
    createdAt: AT,
    updatedAt: AT,
    ...over,
  } as Comment;
}

interface MutateInput {
  readonly mutation: string;
  readonly variables: Record<string, unknown>;
  readonly optimistic?: OptimisticPatch;
}

function mount(rows: readonly Comment[]) {
  const store = new Store(WORKSPACE);
  store.applyChanges(
    rows.map(
      (row, index) =>
        ({
          v: index + 1,
          type: 'comment',
          id: row.id,
          op: 'upsert',
          actor: { type: 'user', id: ADA },
          payload: row,
        }) as Change,
    ),
  );
  const mutate = vi.fn(async (input: MutateInput) => {
    if (input.optimistic !== undefined) store.applyOptimistic(input.optimistic);
    return {
      resolveComment: { comment: { ...rows[0], resolvedAt: AT, resolvedBy: ADA } },
      deleteComment: { id: rows[0]?.id },
    };
  });
  const engine = {
    store,
    mutate,
    succession: (id: string) => id,
    isProvisional: () => false,
  } as unknown as SyncEngine;

  render(
    <KeymapProvider>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <Comments
          issueId={ISSUE}
          identifier="ENG-1"
          fetched={[]}
          names={{ [ADA]: 'Ada', [GREY]: 'Grey' }}
          viewerId={viewer.id}
          commands={{ current: {} } as never}
          enterSubmits={false}
        />
      </EngineProvider>
    </KeymapProvider>,
  );
  return { user: userEvent.setup(), mutate };
}

const MENU_NAME = /^Options for the comment from /;

function commentArticle(): HTMLElement {
  return screen.getAllByRole('article')[0] as HTMLElement;
}

function itemNames(menu: HTMLElement): string[] {
  return within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent ?? '');
}

describe('the comment menu', () => {
  it('opens on a right-click of the comment', async () => {
    const { user } = mount([comment('c1')]);

    expect(screen.queryByRole('menu', { name: MENU_NAME })).toBeNull();

    await user.pointer({ target: commentArticle(), keys: '[MouseRight]' });

    const menu = await screen.findByRole('menu', { name: MENU_NAME });
    expect(itemNames(menu)).toEqual(['Resolve thread', 'Edit comment', 'Delete comment']);
  });

  it('offers exactly what the ⋯ menu offers, in the same order', async () => {
    const { user } = mount([comment('c1')]);

    await user.click(screen.getByRole('button', { name: MENU_NAME }));
    const kebab = itemNames(await screen.findByRole('menu', { name: MENU_NAME }));
    await user.keyboard('{Escape}');

    await user.pointer({ target: commentArticle(), keys: '[MouseRight]' });
    const context = itemNames(await screen.findByRole('menu', { name: MENU_NAME }));

    expect(context).toEqual(kebab);
  });

  it('leaves out what the viewer may not do', async () => {
    // Somebody else's comment, read by a plain member: neither editable nor deletable.
    viewer.id = GREY;
    const { user } = mount([comment('c1')]);

    await user.pointer({ target: commentArticle(), keys: '[MouseRight]' });

    const menu = await screen.findByRole('menu', { name: MENU_NAME });
    expect(itemNames(menu)).toEqual(['Resolve thread']);
  });

  it('lets an admin delete somebody else’s comment, but not edit it', async () => {
    viewer.id = GREY;
    viewer.role = 'admin';
    const { user } = mount([comment('c1')]);

    await user.pointer({ target: commentArticle(), keys: '[MouseRight]' });

    const menu = await screen.findByRole('menu', { name: MENU_NAME });
    expect(itemNames(menu)).toEqual(['Resolve thread', 'Delete comment']);
  });

  it('resolves the thread through the mutation the buttons use', async () => {
    const { user, mutate } = mount([comment('c1')]);

    await user.click(screen.getByRole('button', { name: MENU_NAME }));
    await user.click(
      within(await screen.findByRole('menu', { name: MENU_NAME })).getByRole('menuitem', {
        name: 'Resolve thread',
      }),
    );

    const call = mutate.mock.calls.at(-1)?.[0] as MutateInput | undefined;
    expect(call?.mutation).toContain('resolveComment');
    expect(call?.variables).toMatchObject({ id: 'c1', resolved: true });
  });

  it('asks before it deletes', async () => {
    const { user, mutate } = mount([comment('c1')]);

    await user.click(screen.getByRole('button', { name: MENU_NAME }));
    await user.click(
      within(await screen.findByRole('menu', { name: MENU_NAME })).getByRole('menuitem', {
        name: 'Delete comment',
      }),
    );

    const dialog = await screen.findByRole('dialog', { name: 'Delete this comment?' });
    expect(mutate).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Delete comment' }));

    const call = mutate.mock.calls.at(-1)?.[0] as MutateInput | undefined;
    expect(call?.mutation).toContain('deleteComment');
    expect(call?.variables).toMatchObject({ id: 'c1' });
  });
});
