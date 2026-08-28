import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { Store } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { useView, type DisplayPatch } from './useView';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => 'user-ada',
  useViewer: () => ({ id: 'user-ada', role: 'member' }),
}));

const WORKSPACE = '00000000-0000-4000-8000-000000000001';

/**
 * Two display changes inside one frame.
 *
 * `useSearchParams` hands back one snapshot per commit, so every handler that fires before
 * React commits again reads the same one. That is not a hypothetical window: a chord is a
 * keydown handler, and a person who presses ⌘B twice quickly fires both inside it. The
 * end-to-end suite has a case for exactly that sequence, and it failed roughly one run in
 * ten — which is the worst possible signal, because nine runs in ten call the bug fixed.
 *
 * This drives it from the same batch every time, so the answer does not depend on how fast
 * the machine committed a render.
 */
function Probe({ onReady }: { onReady: (setDisplay: (patch: DisplayPatch) => void) => void }) {
  const view = useView({
    issues: () => [],
    timezone: 'UTC',
    now: Date.parse('2026-01-01T00:00:00Z'),
  });
  onReady(view.setDisplay);
  return (
    <>
      <output data-testid="layout">{view.display.layout}</output>
      <output data-testid="groupBy">{view.display.groupBy}</output>
    </>
  );
}

async function mounted() {
  const store = new Store(WORKSPACE);
  await store.beginBootstrap();
  store.ingestBootstrapPage([]);
  await store.finishBootstrap(1);
  const engine = { store, mutate: async () => ({}) } as unknown as SyncEngine;

  let setDisplay: ((patch: DisplayPatch) => void) | undefined;
  render(
    <MemoryRouter>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <Probe
          onReady={(fn) => {
            setDisplay = fn;
          }}
        />
      </EngineProvider>
    </MemoryRouter>,
  );

  // The chord as `IssueList` registers it: a question about the current layout, not a value.
  const toggle = () =>
    setDisplay!((current) => ({ layout: current.layout === 'board' ? 'list' : 'board' }));
  const write = (patch: DisplayPatch) => setDisplay!(patch);
  const layout = () => screen.getByTestId('layout').textContent;
  const grouping = () => screen.getByTestId('groupBy').textContent;
  return { toggle, write, layout, grouping };
}

describe('useView display writes', () => {
  it('toggles the layout back when both presses land inside one frame', async () => {
    const { toggle, layout } = await mounted();
    expect(layout()).toBe('list');

    act(() => {
      toggle();
      toggle();
    });

    // Before the fix this was 'board': the second patch merged over the snapshot the first
    // one had already replaced, so it read `list`, wrote `board` again, and the layout
    // stayed where the first press put it.
    expect(layout()).toBe('list');
  });

  it('still toggles across separate frames', async () => {
    const { toggle, layout } = await mounted();

    act(() => toggle());
    expect(layout()).toBe('board');
    act(() => toggle());
    expect(layout()).toBe('list');
    act(() => toggle());
    expect(layout()).toBe('board');
  });

  it('keeps an option a later write in the same frame never mentioned', async () => {
    const { write, layout, grouping } = await mounted();

    // Two writes in one frame, of different things. Undoing a toggle is the visible symptom,
    // but the underlying fault is broader: each patch is merged over the whole options
    // object, so a second write built from a stale snapshot does not merely contradict the
    // first — it carries the pre-first values for every key it did not mention and puts
    // them back. Grouping is set first and never mentioned again; it has to survive.
    act(() => {
      write({ groupBy: 'priority' });
      write({ layout: 'board' });
    });

    expect(grouping()).toBe('priority');
    expect(layout()).toBe('board');
  });
});
