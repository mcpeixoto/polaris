import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The replica that cannot be opened.
 *
 * A build that names an object store the database on disk does not have gets a
 * DOMException from IndexedDB before it reads a row, so the workspace does not degrade —
 * it does not open. That shipped, and the only thing the boot screen offered was "Try
 * again", which opens the same database and fails identically. These tests are about the
 * recovery: the button has to drop the replica, and it must not do that for a failure a
 * retry would actually fix.
 */

const restore = vi.fn();
const listWorkspaces = vi.fn();
const start = vi.fn(() => Promise.resolve());
const dropDatabase = vi.fn(() => Promise.resolve());
const dropStaleDatabases = vi.fn(() => Promise.resolve());

vi.mock('~/sync/api', () => ({
  auth: {
    restore: (...args: unknown[]) => restore(...args),
    listWorkspaces: (...args: unknown[]) => listWorkspaces(...args),
    devSession: () => Promise.resolve(null),
  },
  currentWorkspace: () => 'w1',
  isSignedIn: () => true,
  onAuthLost: () => () => undefined,
  sessionMayExist: () => true,
  setWorkspace: () => undefined,
}));

vi.mock('~/sync/endpoint', () => ({
  pageNeedsNoSession: () => false,
  shouldAttemptDevSession: () => false,
}));

vi.mock('~/sync/engine', () => ({
  SyncEngine: class {
    start = start;
    stop = () => undefined;
  },
}));

vi.mock('~/store', async () => {
  const actual = await vi.importActual<typeof import('~/store')>('~/store');
  return {
    ...actual,
    dropDatabase: (...args: unknown[]) => dropDatabase(...(args as [])),
    dropStaleDatabases: (...args: unknown[]) => dropStaleDatabases(...(args as [])),
  };
});

vi.mock('~/hooks/useViewer', () => ({ prefetchViewerId: () => undefined }));

vi.mock('./context', () => ({
  EngineProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const { Boot, rememberWorkspace } = await import('./Boot');

const WORKSPACE = {
  id: 'w1',
  name: 'Acme',
  urlKey: 'acme',
  plan: 'free',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const MISSING_STORE =
  "Failed to execute 'transaction' on 'IDBDatabase': One of the specified object stores was not found.";

function renderBoot() {
  return render(
    <Boot
      renderSignedOut={() => <p>Sign in</p>}
      renderNoWorkspace={() => <p>Create a workspace</p>}
    >
      <p>The workspace</p>
    </Boot>,
  );
}

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  restore.mockReset();
  listWorkspaces.mockReset();
  start.mockClear();
  dropDatabase.mockClear();
  dropStaleDatabases.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Boot when the replica cannot be opened', () => {
  it('offers to rebuild the offline data rather than retrying the same database', async () => {
    rememberWorkspace(WORKSPACE.id, WORKSPACE);
    restore.mockResolvedValue({ kind: 'session' });
    listWorkspaces.mockResolvedValue([WORKSPACE]);
    start.mockRejectedValueOnce(new Error(MISSING_STORE));

    const { container } = renderBoot();

    // `findBy*` flushes the microtask that rejects `start()`; `container.querySelector`
    // inside a bare waitFor sees the state change land outside act and warns about it.
    await screen.findByText('Polaris could not open your workspace');
    const button = await waitFor(() => {
      const found = container.querySelector('button');
      if (found === null) throw new Error('no action on the failure screen');
      return found;
    });
    expect(button.textContent).toBe('Rebuild offline data');
    // The exception's own sentence stays: it is the only clue in a bug report.
    expect(screen.getByText(new RegExp('object stores was not found'))).not.toBeNull();

    // The click starts a rebuild and then a fresh boot; both settle after the handler
    // returns, so the assertions belong inside act or React reports the state change as
    // unwrapped.
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(dropDatabase).toHaveBeenCalledWith('w1'));
    expect(dropStaleDatabases).toHaveBeenCalledWith('w1');
  });

  it('still just retries a network failure, which is the case retrying fixes', async () => {
    rememberWorkspace(WORKSPACE.id, WORKSPACE);
    restore.mockResolvedValue({ kind: 'session' });
    listWorkspaces.mockResolvedValue([WORKSPACE]);
    start.mockRejectedValueOnce(new Error('Failed to fetch'));

    const { container } = renderBoot();

    // `findBy*` flushes the microtask that rejects `start()`; `container.querySelector`
    // inside a bare waitFor sees the state change land outside act and warns about it.
    await screen.findByText('Polaris could not open your workspace');
    const button = await waitFor(() => {
      const found = container.querySelector('button');
      if (found === null) throw new Error('no action on the failure screen');
      return found;
    });
    expect(button.textContent).toBe('Try again');

    await act(async () => {
      fireEvent.click(button);
    });
    expect(dropDatabase).not.toHaveBeenCalled();
  });
});
