/**
 * The gate exists to stop a screen calling a record deleted while it is still arriving,
 * so the two phases where more data is coming are the whole test.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EngineProvider } from '~/app/context';
import type { EngineStatus } from '~/sync/engine';
import type { SyncEngine } from '~/sync/engine';

import { EntityGate } from './EntityGate';

afterEach(cleanup);

function mount(entity: unknown, status: EngineStatus) {
  const engine = { store: {} } as unknown as SyncEngine;
  return render(
    <EngineProvider engine={engine} status={status}>
      <EntityGate
        entity={entity}
        label="Loading project…"
        missing={<p>No such project</p>}
        children={() => <p>The project</p>}
      />
    </EngineProvider>,
  );
}

describe('EntityGate', () => {
  it('shows a loading state rather than a not-found while the snapshot is still arriving', () => {
    mount(null, { phase: 'bootstrapping', received: 12 });

    expect(screen.getByRole('status').textContent).toBe('Loading project…');
    expect(screen.queryByText('No such project')).toBeNull();
  });

  it('waits through hydration too', () => {
    mount(null, { phase: 'hydrating' });

    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByText('No such project')).toBeNull();
  });

  it('says the record is missing once the store has settled', () => {
    mount(null, { phase: 'ready', connection: 'ready', pending: 0 });

    expect(screen.getByText('No such project')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('treats an engine that was never started as settled, so a skeleton cannot hang', () => {
    mount(null, { phase: 'idle' });

    expect(screen.getByText('No such project')).toBeTruthy();
  });

  it('renders the screen as soon as the record exists, whatever the sync is doing', () => {
    mount({ id: 'p1' }, { phase: 'bootstrapping', received: 0 });

    expect(screen.getByText('The project')).toBeTruthy();
  });
});
