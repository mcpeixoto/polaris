/**
 * A project's overview mounts this panel twice at once — the properties sidebar renders the
 * compact copy, the overview body renders the full one — and both of them used to register
 * `projectDetail.addBlockedBy`. The registry refuses a duplicate id by throwing, deliberately,
 * so the second mount threw during render and React unwound the whole tree: `/project/:id`
 * went blank, and every keystroke on it did nothing.
 *
 * The test is written as the composition rather than as the component, because the component
 * on its own was never wrong.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { ProjectDependencies } from './dependencies';

const PROJECT = '01900000-0000-7000-8000-000000000001';

function renderBoth() {
  const store = new Store('workspace-1');
  const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
  return render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <ProjectDependencies projectId={PROJECT} />
          <ProjectDependencies projectId={PROJECT} compact />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('ProjectDependencies', () => {
  it('can be mounted twice for one project, as the overview does', () => {
    expect(() => renderBoth()).not.toThrow();
    // Both copies are really there: the guard is that ids are claimed once, not that one of
    // the two panels stopped rendering.
    expect(screen.getAllByRole('heading', { name: 'Blocked by' })).toHaveLength(2);
    // And only the copy with visible add controls shows them.
    expect(screen.getAllByRole('button', { name: 'Add blocker…' })).toHaveLength(1);
  });
});
