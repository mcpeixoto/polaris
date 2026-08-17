/**
 * The sync socket: the read half of the sync engine.
 *
 * Mutations do NOT go over this connection. They go over POST /graphql, the same path the
 * SDK and every integration uses, so the write path has one authorisation implementation
 * and one rate limiter. This socket carries deltas inward and heartbeats outward.
 */

import { ensureFreshToken, currentWorkspace } from './api';
import { socketUrl } from './endpoint';

/** Must match syncsrv.ClientSchema. A mismatch drops the local store and re-bootstraps. */
export const CLIENT_SCHEMA = 2;

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

    ws.onmessage = (event) => {
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
      this.clearTimers();
      this.ws = null;
      if (this.closedByUs) return;
      this.setState('offline');
      this.scheduleReconnect();
    };
  }

  private handleFrame(frame: ServerFrame): void {
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

      case 'delta':
        this.handlers.onDelta(frame.changes, frame.from, frame.to);
        this.setVersion(frame.to);
        break;

      case 'resync':
        this.setState('resyncing');
        this.handlers.onResync(frame.reason, frame.retryAfterMs);
        break;

      case 'pong':
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
    // Required by the protocol whether or not anything is happening: Cloudflare cuts an
    // idle proxied WebSocket at about 100 seconds, so a quiet connection has to prove it
    // is alive or it silently stops delivering.
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ t: 'ping' }));
      }
    }, intervalSeconds * 1000);
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
