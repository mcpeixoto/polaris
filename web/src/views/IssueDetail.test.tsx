/**
 * The two places on the issue screen where a person's own words can go missing.
 *
 * Both are about the same thing and neither is about a save call being made: what is asserted
 * here is that the sentence somebody typed is still on the screen, or has reached the server,
 * after the gesture that used to destroy it.
 *
 * The comment composer clears itself the moment Comment is pressed, which is right — the
 * comment is drawn under the issue the same frame, and leaving it in the box as well would
 * show it twice. It is only right as long as a refusal puts it back, and it did not: the
 * rejection ended at `console.error` with the only copy of the text in a closure that was
 * finished with. The commonest way to reach that needs no server fault at all — reply to a
 * comment posted seconds ago and its id is still one this client invented.
 *
 * The title field committed on blur alone, so every exit that takes the screen away without
 * moving focus — Back, reload, a closed tab — dropped the rename.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Comment, type OptimisticPatch, type UUID } from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { Comments, TitleField } from './IssueDetail';

afterEach(cleanup);

const WORKSPACE = 'w1';
const ISSUE = 'i1' as UUID;
const ADA = 'u-ada' as UUID;
const STAND_IN = 'c-standin' as UUID;
const REAL = 'c-real' as UUID;
const AT = '2026-01-01T00:00:00.000Z';

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

function upsert(v: number, entity: Comment): Change {
  return {
    v,
    type: 'comment',
    id: entity.id,
    op: 'upsert',
    actor: { type: 'user', id: ADA },
    payload: entity,
  } as Change;
}

function storeWith(rows: readonly Comment[]): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges(rows.map((row, index) => upsert(index + 1, row)));
  return store;
}

interface MutateInput {
  readonly mutation: string;
  readonly variables: Record<string, unknown>;
  readonly optimistic?: OptimisticPatch;
}

/**
 * An engine that answers about stand-ins the way the real one does.
 *
 * `unsettled` is the set of ids that are still this client's invention: the server has never
 * heard of them, and naming one as a parent is a write it will refuse. `renamed` is what a
 * retired stand-in became.
 */
function engineFor(
  store: Store,
  options: {
    unsettled?: ReadonlySet<string>;
    renamed?: ReadonlyMap<string, string>;
    refuse?: ApiError;
  } = {},
) {
  const unsettled = options.unsettled ?? new Set<string>();
  const renamed = options.renamed ?? new Map<string, string>();
  const mutate = vi.fn(async (input: MutateInput) => {
    if (options.refuse !== undefined) throw options.refuse;
    if (input.optimistic !== undefined) store.applyOptimistic(input.optimistic);
    return {};
  });
  const engine = {
    store,
    mutate,
    succession: (id: string) => renamed.get(id) ?? id,
    isProvisional: (id: string) => unsettled.has(id),
  } as unknown as SyncEngine;
  return { mutate, engine };
}

function mountComments(store: Store, engine: SyncEngine) {
  const view = render(
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
  return { view, user: userEvent.setup() };
}

function postButton(): HTMLButtonElement {
  return screen.getAllByRole('button', { name: /^comment$/i })[0] as HTMLButtonElement;
}

function replyBox(): HTMLTextAreaElement {
  return screen.getByPlaceholderText('Write a reply') as HTMLTextAreaElement;
}

function createComments(mutate: ReturnType<typeof vi.fn>): MutateInput[] {
  return mutate.mock.calls
    .map((call) => call[0] as MutateInput)
    .filter((input) => input.mutation.includes('CreateComment'));
}

describe('Comments', () => {
  it('keeps a reply whose parent the server has not been told about yet', async () => {
    const store = storeWith([comment(STAND_IN)]);
    const { engine, mutate } = engineFor(store, {
      unsettled: new Set([STAND_IN]),
      // What the API answers when a reply names a parent it has never seen. Reaching this at
      // all is the bug: the reply is rolled straight back out again.
      refuse: new ApiError('NOT_FOUND', 'no such comment'),
    });
    const { user } = mountComments(store, engine);

    await user.click(screen.getByRole('button', { name: /^reply to Ada$/i }));
    await user.type(replyBox(), 'The one thing I wanted to say.');
    await user.click(postButton());

    // The sentence is still where it was typed. That is the whole assertion — not that a
    // mutation was skipped, but that the text did not evaporate.
    await waitFor(() => expect(replyBox().value).toBe('The one thing I wanted to say.'));
    // And the reason is on the screen rather than in the console.
    expect((await screen.findByRole('alert')).textContent).not.toBe('');
    // Nothing was sent naming an id the server cannot resolve.
    expect(createComments(mutate)).toEqual([]);
  });

  it('puts a refused comment back in the box it was typed in', async () => {
    const store = storeWith([]);
    const { engine } = engineFor(store, {
      refuse: new ApiError('VALIDATION', 'that comment is too long'),
    });
    const { user } = mountComments(store, engine);

    const box = screen.getByPlaceholderText('Leave a comment') as HTMLTextAreaElement;
    await user.type(box, 'Everything I know about this bug.');
    await user.click(postButton());

    await waitFor(() =>
      expect((screen.getByPlaceholderText('Leave a comment') as HTMLTextAreaElement).value).toBe(
        'Everything I know about this bug.',
      ),
    );
    expect((await screen.findByRole('alert')).textContent).toBe('that comment is too long');
  });

  it('keeps an open reply while its parent is replaced by the server row', async () => {
    const store = storeWith([comment(STAND_IN)]);
    const renamed = new Map<string, string>();
    const { engine } = engineFor(store, { renamed });
    const { user } = mountComments(store, engine);

    await user.click(screen.getByRole('button', { name: /^reply to Ada$/i }));
    await user.type(replyBox(), 'Half a thought');

    // The server's own row arrives and the stand-in is retired — which is exactly what the
    // three routes in sync/reconcile.ts do, and it happens while somebody is mid-sentence.
    renamed.set(STAND_IN, REAL);
    act(() => {
      store.applyChanges([upsert(2, comment(REAL))]);
      store.applyOptimistic([{ type: 'comment', id: STAND_IN, before: null, after: null }]);
    });

    await waitFor(() => expect(replyBox().value).toBe('Half a thought'));
  });
});

describe('TitleField', () => {
  it('saves a rename when the screen goes away without a blur', async () => {
    const onSave = vi.fn();
    const view = render(<TitleField issueId={ISSUE} title="Old name" onSave={onSave} />);
    const user = userEvent.setup();

    const field = screen.getByLabelText('Issue title');
    await user.click(field);
    await user.clear(field);
    await user.type(field, 'New name');

    // Back, a closed tab, a route change: the field is taken away mid-edit and never blurs.
    view.unmount();

    expect(onSave).toHaveBeenCalledWith('New name');
  });

  it('saves a rename when the tab is hidden', async () => {
    const onSave = vi.fn();
    render(<TitleField issueId={ISSUE} title="Old name" onSave={onSave} />);
    const user = userEvent.setup();

    const field = screen.getByLabelText('Issue title');
    await user.click(field);
    await user.clear(field);
    await user.type(field, 'New name');

    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    hidden.mockRestore();

    expect(onSave).toHaveBeenCalledWith('New name');
  });

  it('writes the rename to the issue it was typed on', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = render(<TitleField issueId={ISSUE} title="Old name" onSave={first} />);
    const user = userEvent.setup();

    const field = screen.getByLabelText('Issue title');
    await user.click(field);
    await user.clear(field);
    await user.type(field, 'New name');

    // The route moves on. A flush that read the callback it happens to hold now would write
    // one issue's title onto another's.
    view.rerender(<TitleField issueId={'i2' as UUID} title="Something else" onSave={second} />);

    expect(first).toHaveBeenCalledWith('New name');
    expect(second).not.toHaveBeenCalled();
  });

  it('does not save when nothing was typed', async () => {
    const onSave = vi.fn();
    const view = render(<TitleField issueId={ISSUE} title="Old name" onSave={onSave} />);
    await userEvent.setup().click(screen.getByLabelText('Issue title'));
    view.unmount();
    expect(onSave).not.toHaveBeenCalled();
  });
});
