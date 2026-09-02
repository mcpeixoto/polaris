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
  sessionMayExist,
  setWorkspace,
  type RestoreResult,
  type Workspace,
} from '~/sync/api';
import { Button, Logo } from '~/components';
import { prefetchViewerId } from '~/hooks/useViewer';
import { pageNeedsNoSession, shouldAttemptDevSession } from '~/sync/endpoint';
import { SyncEngine, type EngineStatus } from '~/sync/engine';
import { isOutdatedClientMessage } from '~/sync/outdated-client';
import { dropDatabase, dropStaleDatabases, isReplicaFailureMessage } from '~/store';
import { EngineProvider } from './context';
import styles from './Boot.module.css';

/**
 * Throws away this workspace's replica, every schema version of it.
 *
 * Both calls, because the database that cannot be opened is not necessarily the one this
 * build names: a browser holding a replica from an older schema is exactly the case that
 * produced the failure this recovers from. Best-effort — a delete that fails must still
 * let the retry happen, since the bootstrap may well succeed anyway.
 */
async function rebuildReplica(): Promise<void> {
  const workspaceId = currentWorkspace();
  if (workspaceId === null || workspaceId === undefined) return;
  try {
    await dropDatabase(workspaceId);
    await dropStaleDatabases(workspaceId);
  } catch {
    // Nothing to say to the user here: the retry below is the message.
  }
}

type Phase =
  /**
   * Getting in. `reason` is what the splash is allowed to say about it: `session` is a page
   * load exchanging a cookie, `switch` is somebody already inside moving to another
   * workspace — where "Signing you in" described an authentication that was not happening.
   */
  | { kind: 'restoring'; reason: 'session' | 'switch'; workspaceName?: string }
  | { kind: 'signed-out' }
  | { kind: 'choosing'; workspaces: Workspace[] }
  | { kind: 'running'; engine: SyncEngine }
  | { kind: 'failed'; error: string };

export interface BootProps {
  /**
   * Rendered when nobody is signed in — the sign-in and sign-up screens.
   *
   * `onSignedIn` takes the workspace to open, because one of these screens knows which one
   * it should be: somebody arriving on an invitation link has just joined a specific
   * workspace, and sending them to whichever one this browser last had open would land them
   * anywhere but the place the link was for.
   */
  renderSignedOut: (props: { onSignedIn: (workspaceId?: string) => void }) => ReactNode;
  /** Rendered when an account has no workspace yet. */
  renderNoWorkspace: (props: { onCreated: (workspaceId?: string) => void }) => ReactNode;
  children: ReactNode;
}

/** Where the last-used workspace is remembered, so a reload does not ask again. */
const LAST_WORKSPACE_KEY = 'polaris.workspace';

/**
 * And the workspace record itself, which exists for one situation: an offline boot has no
 * workspace list to look anything up in, and a sidebar whose workspace has no name is worse
 * than one that is a reload out of date. Kept beside the id rather than replacing it, because
 * the id is the thing every other reader wants and must not start depending on a JSON parse.
 */
const LAST_WORKSPACE_RECORD_KEY = 'polaris.workspace.record';

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
  const [phase, setPhase] = useState<Phase>({ kind: 'restoring', reason: 'session' });
  const [status, setStatus] = useState<EngineStatus>({ phase: 'idle' });
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

  // Guards against a double-invoked effect in React's development strict mode starting
  // two engines against the same IndexedDB, which deadlocks on the first write.
  const startingRef = useRef(false);
  const engineRef = useRef<SyncEngine | null>(null);

  const open = useCallback(async (workspace: Workspace) => {
    if (startingRef.current) return;
    startingRef.current = true;

    rememberWorkspace(workspace.id, workspace);
    setWorkspace(workspace.id);
    // Ask who the viewer is now rather than when a screen first needs it. It is one
    // request per workspace per session, and the screens that need it register their
    // actions disabled until it answers — so asking late is a keystroke that silently
    // does nothing on a page that looks ready.
    prefetchViewerId(workspace.id);

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

  const enter = useCallback(
    async (preferred?: string) => {
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

      // A caller that knows where the user is going wins over what this browser last had
      // open, and falls back to it when the workspace is not one they are in.
      const wanted = preferred ?? readLastWorkspace();
      const chosen = workspaces.find((w) => w.id === wanted) ?? workspaces[0];
      if (!chosen) {
        setPhase({ kind: 'choosing', workspaces });
        return;
      }

      await open(chosen);
    },
    [open],
  );

  // The access token lives in memory only, so a load that is restoring a session starts by
  // exchanging the HttpOnly refresh cookie for a new one. That round trip is the price of
  // not keeping a long-lived credential anywhere script can read it.
  //
  // It is skipped when there is no session to restore, which used to be unaskable and is
  // now two cheap facts: this page may not use sessions at all (`/ask/:token`), and this
  // browser may never have held one (`sessionMayExist`). Asking anyway is not free —
  // `/auth/refresh` answers 401, the browser draws that in red, and the sign-in page shipped
  // a guaranteed console error on every cold boot. A red line that is always there is a red
  // line nobody reads, and this suite had already grown a blanket "ignore anything with 401
  // in it" filter around it. The 401 that means a session actually expired still gets
  // asked, still fails, and is still loud — that one is a fault and not an answer.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const restored: RestoreResult =
        pageNeedsNoSession() || !sessionMayExist() ? { kind: 'signed-out' } : await auth.restore();
      if (cancelled) return;

      /*
        The offline cold boot, which used to be a password field.

        `refresh()` answers `null` for a spent cookie and for a train tunnel alike, and this
        branch read that `null` as "signed out" — so a local-first product with a complete
        replica on disk met a lost connection by asking the user to authenticate against a
        server it could not reach. Nothing about that is recoverable by the person holding the
        laptop; the one thing they can do is keep working, which is the whole promise of
        keeping the data locally in the first place.

        `engine.start()` is already the right shape for this: it opens IndexedDB, hydrates a
        complete snapshot without a request, and only calls `bootstrap()` — the network — when
        the replica is missing or torn. The socket then reconnects on its own and
        `ConnectionIndicator` says so. So the offline boot is not a new mode, it is the
        ordinary one with the two questions that need a server skipped: the refresh, and the
        workspace list.

        Only with a remembered workspace, because there is nothing to open without one, and
        only when the browser believes it has held a session (`sessionMayExist` above) — an
        unreachable API on a browser that never signed in is a sign-in form and not a replica.
      */
      if (restored.kind === 'unreachable') {
        const remembered = readLastWorkspace();
        const offline = remembered === null ? null : readLastWorkspaceRecord(remembered);
        if (offline !== null) {
          // Published as the only workspace this session knows about. The switcher then
          // offers what it can honestly offer — the one already open — rather than an empty
          // list, and `listWorkspaces` is not asked, because it would fail.
          setWorkspaces([offline]);
          await open(offline);
          return;
        }
      }

      if (restored.kind !== 'session') {
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
  }, [enter, open]);

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
      setPhase({ kind: 'restoring', reason: 'switch', workspaceName: chosen.name });
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
      return <Splash message={restoringMessage(phase, status)} />;

    case 'signed-out':
      return <>{renderSignedOut({ onSignedIn: (workspaceId) => void enter(workspaceId) })}</>;

    case 'choosing':
      return <>{renderNoWorkspace({ onCreated: (workspaceId) => void enter(workspaceId) })}</>;

    case 'failed': {
      const outdated = isOutdatedClientMessage(phase.error);
      // A replica this build cannot open is the one failure where "Try again" is a lie:
      // the next attempt opens the same database and fails the same way, and the person is
      // left pressing a button forever. The replica is a cache of the server, so throwing
      // it away costs one bootstrap and is always safe to offer.
      const replicaBroken = !outdated && isReplicaFailureMessage(phase.error);
      return (
        <Splash
          tone="failure"
          message="Polaris could not open your workspace"
          // The exception's own sentence, kept — it is frequently the only clue anybody has
          // — but underneath a written headline rather than as the whole of the interface.
          // "Failed to fetch" is a fact about a function call, not something to say to a
          // person.
          detail={
            replicaBroken
              ? `${phase.error} Your offline copy of this workspace is unusable. Rebuilding it downloads the workspace again; nothing you have written is lost.`
              : phase.error
          }
          action={
            <Button
              className={styles.retry}
              onClick={() => {
                if (outdated) {
                  location.reload();
                  return;
                }
                if (replicaBroken) {
                  void rebuildReplica().then(() => enter());
                  return;
                }
                void enter();
              }}
            >
              {outdated ? 'Reload' : replicaBroken ? 'Rebuild offline data' : 'Try again'}
            </Button>
          }
        />
      );
    }

    case 'running':
      // The shell mounts once `engine.start()` has resolved, which — on a cold replica —
      // is after the snapshot has been downloaded, not before it. That is why `restoring`
      // now reports the engine's own progress rather than a static line: the wait is real,
      // its length is known, and the comment that used to sit here claimed the opposite.
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

/**
 * What the splash says while the workspace is being opened.
 *
 * It said "Signing you in" for the whole of it — for the snapshot download too, to somebody
 * who was already signed in, on a cold boot that can run for many seconds. The engine has been
 * reporting `{phase: 'bootstrapping', received: N}` into this component the entire time, and
 * nothing read it until the phase was over. A wait with a number attached to it reads as
 * progress; the same wait with a wrong sentence attached reads as a hang.
 *
 * Exported for its test: the interesting behaviour is a table of four cases, and driving it
 * through the whole boot sequence would test the mocks rather than the copy.
 */
export function restoringMessage(
  phase: { reason: 'session' | 'switch'; workspaceName?: string },
  status: EngineStatus,
): string {
  if (status.phase === 'bootstrapping') {
    return `Loading your workspace… ${status.received} items`;
  }
  if (status.phase === 'hydrating') return 'Opening your workspace';
  if (phase.reason === 'switch') {
    const name = phase.workspaceName ?? '';
    return name === '' ? 'Opening your workspace' : `Opening ${name}`;
  }
  return 'Signing you in';
}

/**
 * The boot screen, in its two tones.
 *
 * `status` is the polite live region a slow but healthy boot belongs in. `failure` is not a
 * status — a workspace that would not open is an error, and announcing it politely means it
 * waits behind whatever the screen reader was already saying, on a screen where there is
 * nothing else to hear.
 */
function Splash({
  message,
  detail,
  action,
  tone = 'status',
}: {
  message: string;
  detail?: string;
  action?: ReactNode;
  tone?: 'status' | 'failure';
}) {
  const failed = tone === 'failure';
  return (
    <div
      className={styles.splash}
      role={failed ? 'alert' : 'status'}
      aria-live={failed ? 'assertive' : 'polite'}
    >
      {/* The product's own mark, which appeared nowhere inside the product. The splash's
          animation-delay already keeps the whole block invisible on a fast boot, so this
          costs nothing on the path it would have been noise on. */}
      <Logo size="lg" />
      {/*
       * Keyed on the text so that a new sentence is a new element.
       *
       * `restoring` and `failed` are the same <Splash> at the same position, so React reuses
       * this span and swaps its text node — "Signing you in" becomes the reason the workspace
       * would not open with nothing between the two saying that anything changed. A key makes
       * the replacement a mount, which is what re-runs the fade in Boot.module.css.
       *
       * It costs nothing in announcements: this lives inside an aria-live region, and a live
       * region announces its new contents whether the node carrying them was replaced or
       * merely rewritten. The one string that must not be keyed away is the region itself,
       * which is the div above and is never remounted.
       */}
      <span key={message} className={styles.message}>
        {message}
      </span>
      {detail === undefined ? null : <span className={styles.detail}>{detail}</span>}
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

/**
 * Records which workspace to open next.
 *
 * Exported for the one caller outside this file: joining a workspace from an invitation
 * while already signed in reloads the app, and this is what tells the boot that follows to
 * open the workspace just joined rather than the one just left.
 */
export function rememberWorkspace(id: string, record?: Workspace): void {
  try {
    localStorage.setItem(LAST_WORKSPACE_KEY, id);
    if (record !== undefined) {
      localStorage.setItem(LAST_WORKSPACE_RECORD_KEY, JSON.stringify(record));
    }
  } catch {
    /* see readLastWorkspace */
  }
}

/**
 * The remembered workspace record, or null when there is none for this id.
 *
 * The id check is what keeps a stale record from being attached to the wrong workspace: the
 * id is written by every caller and the record only by the one that has a whole workspace to
 * hand, so the two can legitimately disagree.
 */
function readLastWorkspaceRecord(id: string): Workspace | null {
  try {
    const raw = localStorage.getItem(LAST_WORKSPACE_RECORD_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Workspace;
    return record.id === id ? record : null;
  } catch {
    /* see readLastWorkspace */
    return null;
  }
}

export { isSignedIn };
