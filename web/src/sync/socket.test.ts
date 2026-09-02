/**
 * What the socket does when the connection lies to it.
 *
 * Every case here is one where `readyState` says OPEN and the truth is otherwise: a
 * half-open TCP connection after a laptop resume, a second socket opened over a live one,
 * a delta batch that starts after where the replica stands. None of them raise an error
 * anywhere — the failure is silence, and silence is what the app used to render as "ready"
 * while showing data from an hour ago.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SyncSocket, type Change, type ConnectionState, type ResyncReason } from './socket';

const ensureFreshToken = vi.hoisted(() => vi.fn());
const currentWorkspace = vi.hoisted(() => vi.fn());

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return { ...actual, ensureFreshToken, currentWorkspace };
});

/** Every socket the module opened, in order, with the frames it sent. */
const sockets: FakeSocket[] = [];

class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FakeSocket.OPEN;
  readonly sent: string[] = [];
  readonly closes: { code?: number; reason?: string }[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(readonly url: string) {
    sockets.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = FakeSocket.CLOSED;
    this.closes.push({ code, reason });
  }

  /** Delivers a server frame, as the browser would. */
  deliver(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  get pings(): number {
    return this.sent.filter((line) => line.includes('"ping"')).length;
  }
}

interface Handlers {
  onReady: ReturnType<typeof vi.fn>;
  onDelta: ReturnType<typeof vi.fn>;
  onResync: ReturnType<typeof vi.fn>;
  onStateChange: ReturnType<typeof vi.fn>;
}

function handlers(): Handlers {
  return {
    onReady: vi.fn(),
    onDelta: vi.fn(),
    onResync: vi.fn(),
    onStateChange: vi.fn(),
  };
}

/** Opens a socket and runs the async handshake far enough for the WebSocket to exist. */
async function connected(
  version: number,
  spies: Handlers,
): Promise<{ socket: SyncSocket; ws: FakeSocket }> {
  const socket = new SyncSocket('client-1', {
    onReady: spies.onReady as (v: number, skew: number) => void,
    onDelta: spies.onDelta as (c: Change[], from: number, to: number) => void,
    onResync: spies.onResync as (r: ResyncReason, ms: number) => void,
    onStateChange: spies.onStateChange as (s: ConnectionState) => void,
  });
  socket.connect(version);
  await vi.advanceTimersByTimeAsync(0);
  return { socket, ws: sockets[sockets.length - 1]! };
}

const READY = { t: 'ready', version: 1, serverTime: new Date().toISOString(), heartbeat: 10 };

beforeEach(() => {
  sockets.length = 0;
  ensureFreshToken.mockReset().mockResolvedValue('token');
  currentWorkspace.mockReset().mockReturnValue('ws-1');
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('heartbeat liveness', () => {
  it('closes a connection that has stopped answering', async () => {
    const spies = handlers();
    const { ws } = await connected(1, spies);
    ws.deliver(READY);

    // Two intervals of silence is what the protocol allows. The pings still go out — the
    // socket is OPEN as far as the browser is concerned, which is the whole problem.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(ws.pings).toBe(2);
    expect(ws.closes).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(ws.closes).toEqual([{ code: 4000, reason: 'no response to heartbeat' }]);
  });

  it('keeps a connection that answers, however quiet the workspace is', async () => {
    const spies = handlers();
    const { ws } = await connected(1, spies);
    ws.deliver(READY);

    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
      ws.deliver({ t: 'pong', serverTime: new Date().toISOString() });
    }

    expect(ws.closes).toHaveLength(0);
    expect(ws.pings).toBe(6);
  });

  it('counts any frame as proof of life, not only a pong', async () => {
    const spies = handlers();
    const { ws } = await connected(1, spies);
    ws.deliver(READY);

    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
      ws.deliver({ t: 'delta', from: i + 1, to: i + 2, changes: [] });
    }

    expect(ws.closes).toHaveLength(0);
  });

  it('refuses a heartbeat interval of zero', async () => {
    const spies = handlers();
    const { ws } = await connected(1, spies);
    // A `heartbeat: 0` used to become `setInterval(fn, 0)`: a spinning main thread and a
    // socket flooded with pings for as long as the tab stayed open.
    ws.deliver({ ...READY, heartbeat: 0 });

    await vi.advanceTimersByTimeAsync(4_999);
    expect(ws.pings).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(ws.pings).toBe(1);
  });
});

describe('opening over a live socket', () => {
  it('abandons the previous socket rather than running two', async () => {
    const spies = handlers();
    const { socket, ws: first } = await connected(1, spies);
    first.deliver(READY);

    // The resync path: the engine reconnects after a bootstrap, and nothing disconnected.
    socket.connect(5);
    await vi.advanceTimersByTimeAsync(0);
    const second = sockets[1]!;

    expect(sockets).toHaveLength(2);
    expect(first.closes).toEqual([{ code: 1000, reason: 'replaced' }]);
    expect(second).not.toBe(first);
  });

  it('ignores the abandoned socket when it finally closes', async () => {
    const spies = handlers();
    const { socket, ws: first } = await connected(1, spies);
    first.deliver(READY);
    socket.connect(5);
    await vi.advanceTimersByTimeAsync(0);
    const second = sockets[1]!;

    // The old socket's close used to clear the *new* socket's heartbeat, drop its
    // reference and schedule a third connection on top of it.
    first.onclose?.();
    second.deliver(READY);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(sockets).toHaveLength(2);
    expect(second.pings).toBeGreaterThan(0);
    expect(socket.connectionState()).toBe('ready');
  });

  it('delivers nothing from a socket that has been replaced', async () => {
    const spies = handlers();
    const { socket, ws: first } = await connected(1, spies);
    first.deliver(READY);
    socket.connect(5);
    await vi.advanceTimersByTimeAsync(0);

    spies.onDelta.mockClear();
    first.deliver({ t: 'delta', from: 5, to: 6, changes: [{ v: 6 }] });
    expect(spies.onDelta).not.toHaveBeenCalled();
  });
});

describe('gap detection', () => {
  it('asks for a resync when a frame starts after where the replica stands', async () => {
    const spies = handlers();
    const { socket, ws } = await connected(5, spies);
    ws.deliver(READY);

    ws.deliver({ t: 'delta', from: 9, to: 10, changes: [{ v: 10 }] });

    expect(spies.onDelta).not.toHaveBeenCalled();
    expect(spies.onResync).toHaveBeenCalledWith('gap_too_large', 0);
    // The version must not move: resuming from 10 would make the hole permanent.
    expect(socket.currentVersion()).toBe(5);
  });

  it('applies a frame that continues from where the replica stands', async () => {
    const spies = handlers();
    const { socket, ws } = await connected(5, spies);
    ws.deliver(READY);

    ws.deliver({ t: 'delta', from: 5, to: 7, changes: [{ v: 7 }] });

    expect(spies.onDelta).toHaveBeenCalledTimes(1);
    expect(spies.onResync).not.toHaveBeenCalled();
    expect(socket.currentVersion()).toBe(7);
  });

  it('asks for a resync when applying a batch throws', async () => {
    const spies = handlers();
    spies.onDelta.mockImplementation(() => {
      throw new Error('indexeddb is on fire');
    });
    const { socket, ws } = await connected(5, spies);
    ws.deliver(READY);

    ws.deliver({ t: 'delta', from: 5, to: 7, changes: [{ v: 7 }] });

    // Advancing the version here is what used to skip the failed batch for good: the next
    // frame arrives with a higher `from`, is applied, and nothing ever notices the hole.
    expect(socket.currentVersion()).toBe(5);
    expect(spies.onResync).toHaveBeenCalledWith('gap_too_large', 0);
  });
});

describe('disconnecting mid-handshake', () => {
  it('does not open a socket that was cancelled while the token was being refreshed', async () => {
    let release: (token: string) => void = () => {};
    ensureFreshToken.mockReturnValue(
      new Promise<string>((resolve) => {
        release = resolve;
      }),
    );

    const spies = handlers();
    const socket = new SyncSocket('client-1', {
      onReady: spies.onReady as (v: number, skew: number) => void,
      onDelta: spies.onDelta as (c: Change[], from: number, to: number) => void,
      onResync: spies.onResync as (r: ResyncReason, ms: number) => void,
      onStateChange: spies.onStateChange as (s: ConnectionState) => void,
    });
    socket.connect(1);
    socket.disconnect();

    release('token');
    await vi.advanceTimersByTimeAsync(0);

    expect(sockets).toHaveLength(0);
  });
});
