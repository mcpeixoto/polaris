/**
 * The boot sequence.
 *
 * Four states, in order: restoring a session, choosing a workspace, replicating it, then
 * running. They are separate on purpose — each one fails differently and each one needs a
 * different thing said to the user. A single "loading" spinner covering all four is why
 * so many apps of this kind are impossible to debug from a support ticket.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  auth,
  currentWorkspace,
  isSignedIn,
  onAuthLost,
  setWorkspace,
  type Workspace,
} from '~/sync/api';
import { shouldAttemptDevSession } from '~/sync/endpoint';
import { SyncEngine, type EngineStatus } from '~/sync/engine';
import { isOutdatedClientMessage } from '~/sync/outdated-client';
import { EngineProvider } from './context';
import styles from './Boot.module.css';

type Phase =
  | { kind: 'restoring' }
  | { kind: 'signed-out' }
  | { kind: 'choosing'; workspaces: Workspace[] }
  | { kind: 'running'; engine: SyncEngine }
  | { kind: 'failed'; error: string };

export interface BootProps {
  /** Rendered when nobody is signed in — the sign-in and sign-up screens. */
  renderSignedOut: (props: { onSignedIn: () => void }) => ReactNode;
  /** Rendered when an account has no workspace yet. */
  renderNoWorkspace: (props: { onCreated: () => void }) => ReactNode;
  children: ReactNode;
}

/** Where the last-used workspace is remembered, so a reload does not ask again. */
const LAST_WORKSPACE_KEY = 'polaris.workspace';

export interface WorkspaceSessionValue {
  readonly workspaces: readonly Workspace[];
  readonly currentId: string;
  switchTo(id: string): Promise<void>;
}

const WorkspaceSessionContext = createContext<WorkspaceSessionValue | null>(null);

export function useWorkspaceSession(): WorkspaceSessionValue {
  const value = useContext(WorkspaceSessionContext);
  if (value === null) {
    throw new Error('useWorkspaceSession must be used inside a running workspace');
  }
  return value;
}

export function Boot({ renderSignedOut, renderNoWorkspace, children }: BootProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'restoring' });
  const [status, setStatus] = useState<EngineStatus>({ phase: 'idle' });
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

  // Guards against a double-invoked effect in React's development strict mode starting
  // two engines against the same IndexedDB, which deadlocks on the first write.
  const startingRef = useRef(false);
  const engineRef = useRef<SyncEngine | null>(null);

  const open = useCallback(async (workspace: Workspace) => {
    if (startingRef.current) return;
    startingRef.current = true;

    rememberWorkspace(workspace.id);
    setWorkspace(workspace.id);

    const engine = new SyncEngine(workspace.id, { onStatus: setStatus });
    engineRef.current = engine;
    try {
      await engine.start();
      setPhase({ kind: 'running', engine });
    } catch (err) {
      setPhase({
        kind: 'failed',
        error: err instanceof Error ? err.message : 'could not open the workspace',
      });
    } finally {
      startingRef.current = false;
    }
  }, []);

  const enter = useCallback(async () => {
    let workspaces: Workspace[];
    try {
      workspaces = await auth.listWorkspaces();
    } catch (err) {
      setPhase({
        kind: 'failed',
        error: err instanceof Error ? err.message : 'could not load workspaces',
      });
      return;
    }

    setWorkspaces(workspaces);

    if (workspaces.length === 0) {
      setPhase({ kind: 'choosing', workspaces });
      return;
    }

    const remembered = readLastWorkspace();
    const chosen = workspaces.find((w) => w.id === remembered) ?? workspaces[0];
    if (!chosen) {
      setPhase({ kind: 'choosing', workspaces });
      return;
    }

    await open(chosen);
  }, [open]);

  // The access token lives in memory only, so every load starts by exchanging the
  // HttpOnly refresh cookie for a new one. That round trip is the price of not keeping a
  // long-lived credential anywhere script can read it.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = await auth.refresh();
      if (cancelled) return;
      if (!session) {
        // Loopback only: the API 404s this unless Host and the TCP peer are
        // localhost. A missing cookie on a laptop is the common case after a
        // reload, and minting one here is what skips the sign-in form.
        if (shouldAttemptDevSession()) {
          const minted = await auth.devSession();
          if (cancelled) return;
          if (minted) {
            await enter();
            return;
          }
        }
        setPhase({ kind: 'signed-out' });
        return;
      }
      await enter();
    })();
    return () => {
      cancelled = true;
    };
  }, [enter]);

  // A revoked or expired session must drop the user out of the app rather than leaving
  // them looking at a replica they can no longer refresh.
  useEffect(
    () =>
      onAuthLost(() => {
        setPhase((current) => (current.kind === 'running' ? { kind: 'signed-out' } : current));
      }),
    [],
  );

  const switchTo = useCallback(
    async (id: string) => {
      let list: Workspace[];
      try {
        list = await auth.listWorkspaces();
      } catch (err) {
        setPhase({
          kind: 'failed',
          error: err instanceof Error ? err.message : 'could not load workspaces',
        });
        return;
      }
      setWorkspaces(list);
      const chosen = list.find((workspace) => workspace.id === id);
      if (chosen === undefined) return;

      engineRef.current?.stop();
      engineRef.current = null;
      startingRef.current = false;
      setPhase({ kind: 'restoring' });
      await open(chosen);
    },
    [open],
  );

  useEffect(() => {
    if (phase.kind !== 'running') return;
    const engine = phase.engine;
    engineRef.current = engine;
    return () => engine.stop();
  }, [phase]);

  switch (phase.kind) {
    case 'restoring':
      return <Splash message="Signing you in" />;

    case 'signed-out':
      return <>{renderSignedOut({ onSignedIn: () => void enter() })}</>;

    case 'choosing':
      return <>{renderNoWorkspace({ onCreated: () => void enter() })}</>;

    case 'failed': {
      const outdated = isOutdatedClientMessage(phase.error);
      return (
        <Splash
          message={phase.error}
          action={
            <button
              className={styles.retry}
              onClick={() => {
                if (outdated) {
                  location.reload();
                  return;
                }
                void enter();
              }}
            >
              {outdated ? 'Reload' : 'Try again'}
            </button>
          }
        />
      );
    }

    case 'running':
      // The shell mounts before the snapshot finishes so the sidebar and the workspace
      // name appear immediately. The list underneath fills in as rows arrive, which is
      // the difference between "loading" and "already working".
      return (
        <EngineProvider engine={phase.engine} status={status}>
          <WorkspaceSessionContext.Provider
            value={{
              workspaces,
              currentId: currentWorkspace() ?? workspaces[0]?.id ?? '',
              switchTo,
            }}
          >
            {children}
          </WorkspaceSessionContext.Provider>
        </EngineProvider>
      );
  }
}

function Splash({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className={styles.splash} role="status" aria-live="polite">
      <span className={styles.message}>{message}</span>
      {action}
    </div>
  );
}

function readLastWorkspace(): string | null {
  try {
    return localStorage.getItem(LAST_WORKSPACE_KEY);
  } catch {
    // Safari private mode and sandboxed iframes throw. Forgetting which workspace was
    // open is a small annoyance; refusing to boot over it is not.
    return null;
  }
}

function rememberWorkspace(id: string): void {
  try {
    localStorage.setItem(LAST_WORKSPACE_KEY, id);
  } catch {
    /* see readLastWorkspace */
  }
}

export { isSignedIn };
