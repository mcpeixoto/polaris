/**
 * The sync socket: the read half of the sync engine.
 *
 * Mutations do NOT go over this connection. They go over POST /graphql, the same path the
 * SDK and every integration uses, so the write path has one authorisation implementation
 * and one rate limiter. This socket carries deltas inward and heartbeats outward.
 */

import { CLIENT_SCHEMA as STORE_SCHEMA } from '~/store/db';

import { ensureFreshToken, currentWorkspace } from './api';
import { socketUrl } from './endpoint';

/**
 * The schema version this socket announces in its hello frame. Re-exported from the store,
 * not declared here.
 *
 * It was its own literal, and `engine.ts` compared the two at module load to catch them
 * drifting — a good instinct, and still one assertion more than a shared constant needs.
 * Bumping the store to v3 turned that check into a startup crash, which is the *designed*
 * failure and is still a worse outcome than not being able to disagree: the two numbers
 * describe one thing, which is what shape of replica this build has.
 *
 * The server made exactly this mistake with the same value — see the comment on
 * domain.ClientSchemaVersion, which is now the single definition on that side for the same
 * reason. Four copies of one number across two languages is three too many; the one
 * remaining contract, across the language boundary, is pinned by
 * services/internal/syncsrv/schema_pin_test.go.
 */
export const CLIENT_SCHEMA = STORE_SCHEMA;

export type Op = 'upsert' | 'delete' | 'revoke';

export interface Change {
  v: number;
  type: string;
  id: string;
  op: Op;
  actor: { type: string; id?: string };
  payload?: unknown;
}

export type ResyncReason =
  'gap_too_large' | 'schema_changed' | 'permissions_changed' | 'buffer_overflow';

export type ConnectionState = 'connecting' | 'ready' | 'offline' | 'resyncing';

export interface SocketHandlers {
  onReady(version: number, serverTimeSkewMs: number): void;
  onDelta(changes: Change[], from: number, to: number): void;
  onResync(reason: ResyncReason, retryAfterMs: number): void;
  onStateChange(state: ConnectionState): void;
}

interface ReadyFrame {
  t: 'ready';
  version: number;
  serverTime: string;
  heartbeat: number;
}
interface DeltaFrame {
  t: 'delta';
  from: number;
  to: number;
  changes: Change[];
}
interface ResyncFrame {
  t: 'resync';
  reason: ResyncReason;
  retryAfterMs: number;
}
interface ErrorFrame {
  t: 'error';
  code: string;
  message: string;
}
interface PongFrame {
  t: 'pong';
  serverTime: string;
}

type ServerFrame = ReadyFrame | DeltaFrame | ResyncFrame | ErrorFrame | PongFrame;

/**
 * Backoff bounds for reconnection.
 *
 * Jittered, because the interesting failure is the server restarting: without jitter
 * every client in the fleet reconnects on the same millisecond and the process that just
 * came up falls over again. That turns a five-second deploy blip into an outage.
 */
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * Bounds on the heartbeat interval the server asks for.
 *
 * The number arrives in a frame, and a frame is not a promise. A `heartbeat: 0` — a bug,
 * an older or newer server, a proxy that rewrote the JSON — becomes `setInterval(fn, 0)`,
 * which spins the main thread and floods the socket with pings for as long as the tab is
 * open. The floor is what makes that impossible; the ceiling keeps a nonsense large value
 * from disabling liveness detection entirely.
 */
const HEARTBEAT_MIN_S = 5;
const HEARTBEAT_MAX_S = 300;

/**
 * How many heartbeat intervals may pass with no word from the server before the socket is
 * treated as dead.
 *
 * Two, because that is what the protocol says: "Missed pongs: 2 (60s) - close; client
 * reconnects". The server implements its half. Without this half a half-open connection —
 * laptop resume, a NAT or load-balancer idle timeout, a proxy that drops the stream without
 * a FIN — stays `readyState === OPEN` forever, so the app shows "ready", receives nothing,
 * and only recovers on a manual reload.
 */
const MISSED_PONGS = 2;

export class SyncSocket {
  private ws: WebSocket | null = null;
  private handlers: SocketHandlers;
  private clientId: string;

  private version = 0;
  private state: ConnectionState = 'offline';
  private closedByUs = false;

  private reconnectDelay = RECONNECT_MIN_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  /** When the server was last heard from at all — a pong, a delta, anything. */
  private lastHeardAt = 0;

  constructor(clientId: string, handlers: SocketHandlers) {
    this.clientId = clientId;
    this.handlers = handlers;
  }

  /** version is where the local replica currently stands; 0 means "I have nothing". */
  connect(version: number): void {
    this.version = version;
    this.closedByUs = false;
    void this.open();
  }

  /** Called after every applied delta so a reconnect resumes from the right place. */
  setVersion(v: number): void {
    if (v > this.version) this.version = v;
  }

  currentVersion(): number {
    return this.version;
  }

  connectionState(): ConnectionState {
    return this.state;
  }

  disconnect(): void {
    this.closedByUs = true;
    this.clearTimers();
    this.ws?.close(1000, 'client closing');
    this.ws = null;
    this.lastHeardAt = 0;
    this.setState('offline');
  }

  private setState(s: ConnectionState): void {
    if (this.state === s) return;
    this.state = s;
    this.handlers.onStateChange(s);
  }

  private async open(): Promise<void> {
    const workspace = currentWorkspace();
    if (!workspace) return;

    const token = await ensureFreshToken();
    if (!token) return;

    // `disconnect()` may have run during the await above. Without this the socket it just
    // tore down is replaced by a live one nobody asked for, which then delivers deltas into
    // an engine that believes it is stopped.
    if (this.closedByUs) return;

    // Any socket still around is abandoned here rather than left to overlap. `connect()` on
    // a live socket is the resync path — the engine calls it after every bootstrap — and two
    // sockets is not the worst of it: the old one's `onclose` used to clear the *new* one's
    // heartbeat, null out its reference and schedule a third connection.
    const previous = this.ws;
    this.ws = null;
    previous?.close(1000, 'replaced');

    this.setState('connecting');

    // Built from the configured origin rather than from `location`, because in the packaged
    // desktop app `location` is a file:// URL whose host is the empty string — which
    // produces a malformed socket URL and a sync engine that never connects.
    const ws = new WebSocket(socketUrl('/sync'));
    this.ws = ws;

    ws.onopen = () => {
      // Authentication travels in the first frame rather than a header, because browsers
      // cannot set headers on a WebSocket handshake — and putting a token in the query
      // string would write it into every proxy access log on the path.
      ws.send(
        JSON.stringify({
          t: 'hello',
          token,
          workspace,
          resume: this.version,
          clientSchema: CLIENT_SCHEMA,
          clientId: this.clientId,
        }),
      );
    };

    // Every handler is guarded on the socket it was installed for. A socket this instance
    // has already moved past is entitled to finish closing; it is not entitled to speak for
    // the connection that replaced it.
    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      let frame: ServerFrame;
      try {
        frame = JSON.parse(event.data as string) as ServerFrame;
      } catch {
        return;
      }
      this.handleFrame(frame);
    };

    ws.onerror = () => {
      // onerror is always followed by onclose; reconnection is handled once, there.
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.clearTimers();
      this.ws = null;
      if (this.closedByUs) return;
      this.setState('offline');
      this.scheduleReconnect();
    };
  }

  private handleFrame(frame: ServerFrame): void {
    // Any frame at all proves the stream is alive, not just a pong. A busy workspace may
    // never idle long enough to need one, and counting only pongs would close a connection
    // that is delivering deltas the moment a heartbeat reply is dropped.
    this.lastHeardAt = Date.now();

    switch (frame.t) {
      case 'ready': {
        // A successful handshake is the only proof the backoff should reset. Resetting on
        // socket open instead would produce a hot loop against a server that accepts
        // connections and then rejects every hello.
        this.reconnectDelay = RECONNECT_MIN_MS;
        const skew = new Date(frame.serverTime).getTime() - Date.now();
        this.startHeartbeat(frame.heartbeat);
        this.setState('ready');
        this.handlers.onReady(frame.version, skew);
        break;
      }

      case 'delta': {
        // A frame that starts after where this replica stands means something was lost or
        // reordered: applying it would leave a hole nothing ever fills, and the replica would
        // diverge silently for the life of the tab. `version > 0` because a client that has
        // not yet resumed from anywhere has no position to be gapped against.
        if (this.version > 0 && frame.from > this.version) {
          this.setState('resyncing');
          this.handlers.onResync('gap_too_large', 0);
          break;
        }
        try {
          this.handlers.onDelta(frame.changes, frame.from, frame.to);
        } catch (err) {
          // The batch did not land. Advancing the version now would skip it for good, and
          // an exception thrown out of `onmessage` is swallowed by the browser — so this is
          // the only place that can notice.
          console.error('[sync] could not apply a delta batch', err);
          this.setState('resyncing');
          this.handlers.onResync('gap_too_large', 0);
          break;
        }
        this.setVersion(frame.to);
        break;
      }

      case 'resync':
        this.setState('resyncing');
        this.handlers.onResync(frame.reason, frame.retryAfterMs);
        break;

      case 'pong':
        // Already recorded above. The frame exists so that a quiet connection still has
        // something to prove itself with.
        break;

      case 'error':
        // A protocol-level rejection: the socket is about to close and reconnecting on
        // the same terms would fail identically, so let the close handler back off.
        console.error('[sync]', frame.code, frame.message);
        break;
    }
  }

  private startHeartbeat(intervalSeconds: number): void {
    this.clearHeartbeat();
    const intervalMs = Math.max(HEARTBEAT_MIN_S, Math.min(intervalSeconds, HEARTBEAT_MAX_S)) * 1000;
    this.lastHeardAt = Date.now();

    // Required by the protocol whether or not anything is happening: Cloudflare cuts an
    // idle proxied WebSocket at about 100 seconds, so a quiet connection has to prove it
    // is alive or it silently stops delivering.
    this.heartbeatTimer = setInterval(() => {
      const ws = this.ws;
      if (ws?.readyState !== WebSocket.OPEN) return;

      // `readyState` is the browser's opinion about a TCP connection, and on a half-open one
      // it says OPEN indefinitely. Silence is the only evidence available, so it is what the
      // decision is made on: closing hands the existing `onclose` its ordinary reconnect.
      if (Date.now() - this.lastHeardAt > MISSED_PONGS * intervalMs) {
        ws.close(4000, 'no response to heartbeat');
        return;
      }
      ws.send(JSON.stringify({ t: 'ping' }));
    }, intervalMs);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const jitter = Math.random() * this.reconnectDelay * 0.5;
    const delay = this.reconnectDelay + jitter;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.open();
    }, delay);

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
