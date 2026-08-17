/**
 * The boot sequence.
 *
 * Four states, in order: restoring a session, choosing a workspace, replicating it, then
 * running. They are separate on purpose — each one fails differently and each one needs a
 * different thing said to the user. A single "loading" spinner covering all four is why
 * so many apps of this kind are impossible to debug from a support ticket.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { auth, isSignedIn, onAuthLost, setWorkspace, type Workspace } from '~/sync/api';
import { SyncEngine, type EngineStatus } from '~/sync/engine';
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

export function Boot({ renderSignedOut, renderNoWorkspace, children }: BootProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'restoring' });
  const [status, setStatus] = useState<EngineStatus>({ phase: 'idle' });

  // Guards against a double-invoked effect in React's development strict mode starting
  // two engines against the same IndexedDB, which deadlocks on the first write.
  const startingRef = useRef(false);

  const open = useCallback(async (workspace: Workspace) => {
    if (startingRef.current) return;
    startingRef.current = true;

    rememberWorkspace(workspace.id);
    setWorkspace(workspace.id);

    const engine = new SyncEngine(workspace.id, { onStatus: setStatus });
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

  useEffect(() => {
    if (phase.kind !== 'running') return;
    const engine = phase.engine;
    return () => engine.stop();
  }, [phase]);

  switch (phase.kind) {
    case 'restoring':
      return <Splash message="Signing you in" />;

    case 'signed-out':
      return <>{renderSignedOut({ onSignedIn: () => void enter() })}</>;

    case 'choosing':
      return <>{renderNoWorkspace({ onCreated: () => void enter() })}</>;

    case 'failed':
      return (
        <Splash
          message={phase.error}
          action={
            <button className={styles.retry} onClick={() => void enter()}>
              Try again
            </button>
          }
        />
      );

    case 'running':
      // The shell mounts before the snapshot finishes so the sidebar and the workspace
      // name appear immediately. The list underneath fills in as rows arrive, which is
      // the difference between "loading" and "already working".
      return (
        <EngineProvider engine={phase.engine} status={status}>
          {children}
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
