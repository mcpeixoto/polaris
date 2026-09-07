/**
 * A document being written while somebody else changes it, and how the screen says so.
 *
 * The screen mirrors the store into the body field, so every delta that touches this
 * document re-runs the effect that fills it — including one that changes the title nobody
 * here is typing in. Adopting the store's answer wholesale threw away whatever was in the
 * textarea, which is the one thing on the screen that exists nowhere else yet.
 *
 * The Save button these tests used to click is gone: it stood beside an autosave that
 * already fired on blur, on unmount and on the tab being hidden, and nothing on the screen
 * said which of the two had just happened. Every assertion it carried is still here, made
 * against what replaced it — `mod+s` for "send it now", and the save indicator for what
 * just happened.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity, type OptimisticPatch } from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { DocumentDetail } from './DocumentDetail';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
const TEAM = 't1';
const DOC = 'd1';
const AT = '2026-01-01T00:00:00.000Z';

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return {
    v,
    type,
    id: entity.id,
    op: 'upsert',
    actor: { type: 'user', id: VIEWER },
    payload: entity,
  };
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'team', {
      id: TEAM,
      workspaceId: WORKSPACE,
      key: 'ENG',
      name: 'Engineering',
      private: false,
      createdAt: AT,
      updatedAt: AT,
    } as unknown as Entity),
    upsert(2, 'document', {
      id: DOC,
      workspaceId: WORKSPACE,
      teamId: TEAM,
      title: 'Runbook',
      body: '',
      sortOrder: 'a',
      createdAt: AT,
      updatedAt: AT,
    }),
  ]);
  return store;
}

interface MutateInput {
  readonly mutation: string;
  readonly variables: Record<string, unknown>;
  readonly optimistic?: OptimisticPatch;
}

/**
 * A server that answers when it is told to, so a test can act during the gap.
 *
 * The gap is the point: a save is not instant, the person's hands do not stop while it is
 * open, and what the screen does when the reply finally lands is the behaviour under test.
 */
function gatedEngine(store: Store) {
  let release = () => {};
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  const mutate = vi.fn(async (input: MutateInput) => {
    await opened;
    if (input.optimistic !== undefined) store.applyOptimistic(input.optimistic);
    return { updateDocument: { document: input.optimistic?.[0]?.after } };
  });
  return { mutate, release: () => release(), engine: { store, mutate } as unknown as SyncEngine };
}

/** The body of every document update that reached the engine. */
function bodiesSent(mutate: ReturnType<typeof vi.fn>): unknown[] {
  return mutate.mock.calls.map(
    (call) => ((call[0] as MutateInput).variables.input as { body?: unknown }).body,
  );
}

/** What the save indicator is currently saying: "Saving…", "Saved", or nothing. */
function indicator(): string {
  return screen.getByRole('status').textContent ?? '';
}

/** The rendered screen, so a test can take it away the way the back button does. */
let view: ReturnType<typeof render> | null = null;

afterEach(() => {
  view = null;
  cleanup();
});

function mount(store: Store, engine: SyncEngine) {
  view = render(
    <MemoryRouter initialEntries={[`/document/${DOC}`]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/document/:documentId" element={<DocumentDetail />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { store, user: userEvent.setup() };
}

function renderDetail() {
  const store = seeded();
  const mutate = vi.fn().mockResolvedValue({});
  return { mutate, ...mount(store, { store, mutate } as unknown as SyncEngine) };
}

function renderDetailWithRefusal(message: string) {
  const store = seeded();
  const mutate = vi.fn().mockRejectedValue(new ApiError('VALIDATION', message));
  return { mutate, ...mount(store, { store, mutate } as unknown as SyncEngine) };
}

function renderDetailWithSlowSave() {
  const store = seeded();
  const { engine, mutate, release } = gatedEngine(store);
  return { mutate, release, ...mount(store, engine) };
}

describe('DocumentDetail', () => {
  it('keeps an unsaved body when the document changes underneath it', async () => {
    const { store, user } = renderDetail();

    const body = screen.getByLabelText('Body') as HTMLTextAreaElement;
    await user.click(body);
    await user.type(body, 'half a sentence');

    // Somebody else renames the document while this one is mid-word.
    act(() =>
      store.applyChanges([
        upsert(3, 'document', {
          id: DOC,
          workspaceId: WORKSPACE,
          teamId: TEAM,
          title: 'Renamed by somebody else',
          body: '',
          sortOrder: 'a',
          createdAt: AT,
          updatedAt: '2026-01-02T00:00:00.000Z',
        }),
      ]),
    );

    expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toBe('half a sentence');
    // The field nobody was editing still follows the store.
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(
      'Renamed by somebody else',
    );
  });

  it('keeps what was typed while the save was in flight', async () => {
    const { user, release, mutate } = renderDetailWithSlowSave();

    const body = () => screen.getByLabelText('Body') as HTMLTextAreaElement;
    await user.click(body());
    await user.type(body(), 'first half');
    await user.keyboard('{Control>}s{/Control}');

    // The connection is slow and the writing continues; the request that is open carries
    // "first half" and knows nothing about the rest.
    await user.click(body());
    await user.type(body(), ' and second half');
    expect(body().value).toBe('first half and second half');

    await act(async () => {
      release();
    });

    // The reply is about a body that is already out of date. Adopting it would delete a
    // sentence the person watched themselves type.
    await waitFor(() => expect(body().value).toBe('first half and second half'));
    // And there is still something to save, so the text has a way of reaching the server:
    // the field is still dirty, so a second ⌘S sends the newer body rather than nothing.
    await user.keyboard('{Control>}s{/Control}');
    await waitFor(() => expect(bodiesSent(mutate)).toContain('first half and second half'));
  });

  it('settles once the save covers what is on the screen', async () => {
    const { user, release } = renderDetailWithSlowSave();

    const body = screen.getByLabelText('Body') as HTMLTextAreaElement;
    await user.click(body);
    await user.type(body, 'all of it');
    await user.keyboard('{Control>}s{/Control}');

    // While the request is open the screen says so, rather than looking like nothing
    // happened — which is what a fire-and-forget autosave looked like.
    await waitFor(() => expect(indicator()).toBe('Saving…'));

    await act(async () => {
      release();
    });

    await waitFor(() => expect(indicator()).toBe('Saved'));
    expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toBe('all of it');
  });

  it('says so when the server refuses the edit', async () => {
    const { mutate, user } = renderDetailWithRefusal('that body is too long');

    const body = screen.getByLabelText('Body') as HTMLTextAreaElement;
    await user.click(body);
    await user.type(body, 'Something the server will not have');
    await user.keyboard('{Control>}s{/Control}');

    // The server's own words, rather than an uncaught rejection in the console and a screen
    // that looks as though the keystroke did nothing.
    expect((await screen.findByRole('alert')).textContent).toBe('that body is too long');
    // The edit is still on the screen and still sendable: the field stayed dirty, so
    // pressing again sends it again rather than deciding it is already safe.
    expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toBe(
      'Something the server will not have',
    );
    const sent = mutate.mock.calls.length;
    await user.keyboard('{Control>}s{/Control}');
    await waitFor(() => expect(mutate.mock.calls.length).toBe(sent + 1));
  });

  it('renames the document when the title field is left', async () => {
    const { mutate, user } = renderDetail();

    const title = screen.getByLabelText('Title');
    await user.click(title);
    await user.clear(title);
    await user.type(title, 'The runbook');
    await user.tab();

    await waitFor(() =>
      expect(
        mutate.mock.calls.some(
          (call) =>
            ((call[0] as MutateInput).variables.input as { title?: unknown }).title ===
            'The runbook',
        ),
      ).toBe(true),
    );
  });

  it('keeps an edit when the screen goes away without a blur', async () => {
    const { mutate, user } = renderDetail();

    const body = screen.getByLabelText('Body') as HTMLTextAreaElement;
    await user.click(body);
    await user.type(body, 'the only copy of this sentence');

    // Browser Back. The Documents link at the top of this same screen saved, because
    // clicking it blurs the textarea first; Back did not, and the difference was invisible.
    view!.unmount();

    expect(bodiesSent(mutate)).toContain('the only copy of this sentence');
  });

  it('keeps an edit when the tab is hidden', async () => {
    const { mutate, user } = renderDetail();

    const body = screen.getByLabelText('Body') as HTMLTextAreaElement;
    await user.click(body);
    await user.type(body, 'written just before the reload');

    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    hidden.mockRestore();

    expect(bodiesSent(mutate)).toContain('written just before the reload');
  });

  it('sends nothing when nothing was typed', async () => {
    const { mutate, user } = renderDetail();
    await user.click(screen.getByLabelText('Body'));
    view!.unmount();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('adopts a remote body while nothing is being typed', () => {
    const { store } = renderDetail();

    act(() =>
      store.applyChanges([
        upsert(3, 'document', {
          id: DOC,
          workspaceId: WORKSPACE,
          teamId: TEAM,
          title: 'Runbook',
          body: 'written elsewhere',
          sortOrder: 'a',
          createdAt: AT,
          updatedAt: '2026-01-02T00:00:00.000Z',
        }),
      ]),
    );

    expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toBe('written elsewhere');
  });
});
