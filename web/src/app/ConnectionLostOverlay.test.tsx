/**
 * A lost connection takes the screen. The sidebar badge is not enough: a click that
 * looks like it landed is a change sitting in an outbox, and the user has to know they
 * cannot keep working until the replica is reachable again.
 */

import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Store } from '~/store';
import type { EngineStatus, SyncEngine } from '~/sync/engine';

import { CONNECTION_LOST_GRACE_MS, ConnectionLostOverlay } from './ConnectionLostOverlay';
import { EngineProvider } from './context';
import { KeymapProvider } from './keymap';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';

const READY: EngineStatus = { phase: 'ready', connection: 'ready', pending: 0 };
const RECONNECTING: EngineStatus = { phase: 'ready', connection: 'connecting', pending: 0 };
const FAILED: EngineStatus = { phase: 'failed', error: 'Failed to fetch' };

let originalOnline: boolean;

beforeEach(() => {
  originalOnline = navigator.onLine;
  setOnline(true);
});

afterEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: originalOnline });
  vi.useRealTimers();
});

function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

/** The direct children of <body> that are not the overlay's own backdrop. */
function pageChildren(): HTMLElement[] {
  const dialog = document.querySelector('[role="dialog"]');
  return [...document.body.children].filter(
    (child): child is HTMLElement => child instanceof HTMLElement && !child.contains(dialog),
  );
}

function tree(status: EngineStatus, engine: SyncEngine, onEdit?: () => void) {
  return (
    <KeymapProvider>
      <EngineProvider engine={engine} status={status}>
        <button type="button" onClick={onEdit}>
          Edit issue
        </button>
        <ConnectionLostOverlay />
      </EngineProvider>
    </KeymapProvider>
  );
}

function renderOverlay(status: EngineStatus) {
  const engine = {
    store: new Store(WORKSPACE),
    mutate: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
  } as unknown as SyncEngine;
  return render(tree(status, engine));
}

describe('ConnectionLostOverlay', () => {
  it('stays quiet while the replica is reachable', () => {
    renderOverlay(READY);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit issue' })).toBeTruthy();
  });

  it('does not flash on a reconnect that comes back inside the grace', () => {
    vi.useFakeTimers();
    const engine = {
      store: new Store(WORKSPACE),
      mutate: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
    } as unknown as SyncEngine;
    const { rerender } = render(tree(RECONNECTING, engine));
    act(() => {
      vi.advanceTimersByTime(CONNECTION_LOST_GRACE_MS - 1);
    });
    expect(screen.queryByRole('dialog')).toBeNull();

    rerender(tree(READY, engine));
    act(() => {
      vi.advanceTimersByTime(CONNECTION_LOST_GRACE_MS);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('takes the screen once a reconnect has lasted past the grace', () => {
    vi.useFakeTimers();
    renderOverlay(RECONNECTING);
    act(() => {
      vi.advanceTimersByTime(CONNECTION_LOST_GRACE_MS);
    });
    expect(screen.getByRole('dialog', { name: 'Connection lost.' })).toBeTruthy();
    expect(screen.getByText('Please wait.')).toBeTruthy();
  });

  it('takes the screen immediately when the browser itself goes offline', () => {
    renderOverlay(READY);
    act(() => {
      setOnline(false);
    });
    expect(screen.getByRole('dialog', { name: 'Connection lost.' })).toBeTruthy();
  });

  it('makes the page behind it inert, so nothing there can be reached', () => {
    renderOverlay(READY);
    expect(pageChildren().every((child) => child.inert !== true)).toBe(true);

    act(() => {
      setOnline(false);
    });

    expect(screen.getByRole('dialog', { name: 'Connection lost.' })).toBeTruthy();
    const behind = pageChildren();
    expect(behind.length).toBeGreaterThan(0);
    expect(behind.every((child) => child.inert === true)).toBe(true);
  });

  it('leaves the failed badge alone: a failed boot is a retry, not a lost connection', () => {
    renderOverlay(FAILED);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit issue' })).toBeTruthy();
  });
});
