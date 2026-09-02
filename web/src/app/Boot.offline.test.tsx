import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The one that mattered: a signed-in user, a complete replica on disk, and no network.
 *
 * `auth.refresh()` answered `null` for that and for a spent cookie alike, and `Boot` read
 * `null` as "signed out" — so the product's whole reason for keeping the data locally was
 * cancelled by the first tunnel. These tests are about which of the three screens the boot
 * lands on, so everything below the decision is mocked away: the engine, the replica, the
 * viewer prefetch. What is being tested is the branch, not the sync layer.
 */

const restore = vi.fn();
const listWorkspaces = vi.fn();
const devSession = vi.fn();
const start = vi.fn(() => Promise.resolve());

vi.mock('~/sync/api', () => ({
  auth: {
    restore: (...args: unknown[]) => restore(...args),
    listWorkspaces: (...args: unknown[]) => listWorkspaces(...args),
    devSession: (...args: unknown[]) => devSession(...args),
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
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Boot with an unreachable API', () => {
  it('opens the remembered workspace against the local replica', async () => {
    rememberWorkspace(WORKSPACE.id, WORKSPACE);
    restore.mockResolvedValue({ kind: 'unreachable' });

    renderBoot();

    await waitFor(() => expect(screen.getByText('The workspace')).not.toBeNull());
    // The two questions that need a server are never asked.
    expect(listWorkspaces).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('still asks for a sign-in when this browser has no workspace to open', async () => {
    restore.mockResolvedValue({ kind: 'unreachable' });

    renderBoot();

    await waitFor(() => expect(screen.getByText('Sign in')).not.toBeNull());
  });

  it('asks for a sign-in when the server actually refused the credential', async () => {
    rememberWorkspace(WORKSPACE.id, WORKSPACE);
    restore.mockResolvedValue({ kind: 'signed-out' });

    renderBoot();

    await waitFor(() => expect(screen.getByText('Sign in')).not.toBeNull());
    expect(start).not.toHaveBeenCalled();
  });

  it('boots normally when the session restores', async () => {
    restore.mockResolvedValue({ kind: 'session' });
    listWorkspaces.mockResolvedValue([WORKSPACE]);

    renderBoot();

    await waitFor(() => expect(screen.getByText('The workspace')).not.toBeNull());
    expect(listWorkspaces).toHaveBeenCalled();
  });
});
