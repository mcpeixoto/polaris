import { act, render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { Store } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import type { DisplayOptions } from '~/filter';

import { useView, type DisplayPatch } from './useView';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => 'user-ada',
  useViewer: () => ({ id: 'user-ada', role: 'member' }),
}));

const WORKSPACE = '00000000-0000-4000-8000-000000000001';

/**
 * What the display writes are allowed to assume about when they run.
 *
 * The answer is: nothing. A write can be issued between two React commits — a chord fires
 * and the preference write it triggers re-renders the tree before the router's own state
 * update has landed — and it can be issued after the bar has moved for a reason this
 * component never rendered. Both happen in the product, and both used to produce a write
 * built on a stale copy of the options, which is not a wrong value in one field but the
 * pre-write value in *every* field the patch did not mention.
 *
 * `BrowserRouter`, because that is what `App` mounts and because the bar is the thing under
 * test. A `MemoryRouter` keeps its own location and would answer a question nobody asks.
 */
function Probe({
  onReady,
  preferenceKey,
}: {
  onReady: (setDisplay: (patch: DisplayPatch) => void) => void;
  preferenceKey?: string | undefined;
}) {
  const view = useView({
    issues: () => [],
    timezone: 'UTC',
    now: Date.parse('2026-01-01T00:00:00Z'),
    preferenceKey,
  });
  onReady(view.setDisplay);
  return (
    <>
      <output data-testid="layout">{view.display.layout}</output>
      <output data-testid="groupBy">{view.display.groupBy}</output>
    </>
  );
}

async function mounted(options: { preferenceKey?: string; remembered?: DisplayOptions } = {}) {
  window.history.replaceState({}, '', '/team/ENG');

  const store = new Store(WORKSPACE);
  await store.beginBootstrap();
  store.ingestBootstrapPage([]);
  await store.finishBootstrap(1);
  if (options.preferenceKey !== undefined && options.remembered !== undefined) {
    store.applyChanges([
      {
        v: 2,
        type: 'viewPreference',
        id: 'pref-1',
        op: 'upsert',
        actor: { userId: 'user-ada', kind: 'user' },
        payload: {
          id: 'pref-1',
          workspaceId: WORKSPACE,
          userId: 'user-ada',
          viewKey: options.preferenceKey,
          display: options.remembered,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      } as unknown as Parameters<Store['applyChanges']>[0][number],
    ]);
  }
  // `mutate` resolves without applying anything, which is the point rather than a shortcut:
  // it holds the store on the value the server last confirmed, exactly as it stands in the
  // window between a local write and its optimistic patch landing.
  const engine = { store, mutate: async () => ({}) } as unknown as SyncEngine;

  let setDisplay: ((patch: DisplayPatch) => void) | undefined;
  render(
    <BrowserRouter>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <Probe
          onReady={(fn) => {
            setDisplay = fn;
          }}
          preferenceKey={options.preferenceKey}
        />
      </EngineProvider>
    </BrowserRouter>,
  );

  // The chord as `IssueList` registers it: a question about the current layout, not a value.
  const toggle = () =>
    setDisplay!((current) => ({ layout: current.layout === 'board' ? 'list' : 'board' }));
  const write = (patch: DisplayPatch) => setDisplay!(patch);
  const layout = () => screen.getByTestId('layout').textContent;
  const grouping = () => screen.getByTestId('groupBy').textContent;
  const bar = () => window.location.search;
  return { toggle, write, layout, grouping, bar };
}

describe('useView display writes', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/team/ENG');
  });

  it('toggles the layout back when both presses land inside one frame', async () => {
    const { toggle, layout } = await mounted();
    expect(layout()).toBe('list');

    act(() => {
      toggle();
      toggle();
    });

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

    // Undoing a toggle is the visible symptom; the fault is broader. Each patch is merged
    // over the whole options object, so a second write built from a stale copy does not
    // merely contradict the first — it carries the pre-first value for every key it did not
    // mention and puts it back. Grouping is set first and never mentioned again.
    act(() => {
      write({ groupBy: 'priority' });
      write({ layout: 'board' });
    });

    expect(grouping()).toBe('priority');
    expect(layout()).toBe('board');
  });

  it('reads the layout from the bar when the bar moved without a re-render', async () => {
    const { toggle, bar } = await mounted();

    // The bar goes to the board without React being told. This is what the arrival effect
    // does — it calls `navigate` directly — and what any write issued between two commits
    // looks like from here: the location has moved and `useSearchParams` still reports the
    // last committed snapshot.
    //
    // This is the case a ref of "what I last wrote" cannot cover, because it is not what
    // this hook wrote. The toggle has to see `board` and produce a list.
    act(() => {
      window.history.replaceState({}, '', '/team/ENG?layout=board');
    });

    act(() => toggle());

    expect(bar()).not.toContain('layout=board');
  });

  /**
   * Turning a remembered option off has to stay off.
   *
   * The arrival effect seeds the address bar from the stored row whenever the bar says
   * nothing about display — and turning the last non-default option off is precisely how the
   * bar comes to say nothing. The row itself is written fire-and-forget, so for the moment
   * between the two the store still holds the old value, the effect reads it as an arrival,
   * and it puts back the board the reader has just left.
   *
   * `mutate` here never applies the optimistic patch, which makes that window permanent
   * instead of a race. In the product it is a race, which is worse: it is the e2e failure
   * that shows up once in five runs, and for a reader it is a ⌘B that sometimes does not
   * come back.
   */
  it('does not restore a remembered option the reader has just turned off', async () => {
    const { toggle, layout, bar } = await mounted({
      preferenceKey: 'team:ENG',
      remembered: { layout: 'board' } as DisplayOptions,
    });

    // Arrival: the remembered board is seeded into a bar that said nothing.
    expect(layout()).toBe('board');
    expect(bar()).toContain('layout=board');

    act(() => toggle());

    expect(layout()).toBe('list');
    expect(bar()).not.toContain('layout=board');
  });
});
