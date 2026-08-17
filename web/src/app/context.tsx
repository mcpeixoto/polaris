/**
 * The engine and store, made available to the component tree.
 *
 * Views subscribe to QUERY RESULTS rather than to entities or to the network. That is the
 * whole reason the local store exists: a status change should re-render the eleven rows
 * whose group membership moved, not the five thousand rows in the list, and certainly not
 * wait for a round trip first.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { sameResult, type EntityType, type Store } from '~/store';
import type { EngineStatus, SyncEngine } from '~/sync/engine';

interface EngineContextValue {
  engine: SyncEngine;
  status: EngineStatus;
}

const EngineContext = createContext<EngineContextValue | null>(null);

export function EngineProvider({
  engine,
  status,
  children,
}: {
  engine: SyncEngine;
  status: EngineStatus;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ engine, status }), [engine, status]);
  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}

export function useEngine(): SyncEngine {
  const ctx = useContext(EngineContext);
  if (!ctx) throw new Error('useEngine must be used inside an EngineProvider');
  return ctx.engine;
}

export function useSyncStatus(): EngineStatus {
  const ctx = useContext(EngineContext);
  if (!ctx) throw new Error('useSyncStatus must be used inside an EngineProvider');
  return ctx.status;
}

export function useStore(): Store {
  return useEngine().store;
}

/**
 * Subscribes to a derived value from the store.
 *
 * `deps` names the entity types the answer can depend on. Passing them is worth the
 * trouble: an issue list that declares `['issue']` sleeps through every comment posted
 * anywhere in the workspace, and on a busy Monday morning that is most of the traffic.
 * Omitting them is correct but wakes the selector on everything.
 *
 * `select` must be pure and cheap. It runs synchronously against in-memory indexes, which
 * is affordable precisely because nothing on this path touches IndexedDB or the network.
 *
 * IMPORTANT: only for selectors that read nothing but the store. The answer is cached and
 * recomputed when the store notifies — so a selector that closes over a route parameter or
 * a filter keeps returning the previous answer after that value changes, because the store
 * has not moved and nothing notifies. Use `useLiveQuery` from ~/hooks for those; it takes
 * the closed-over values as part of the subscription's identity.
 */
export function useQuery<T>(select: (store: Store) => T, deps?: readonly EntityType[]): T {
  const store = useStore();

  // The selector is almost always an inline arrow, so it is a new function on every
  // render. Reading it through a ref keeps the subscription stable — resubscribing each
  // render would tear the store's subscriber set down and rebuild it sixty times a second.
  const selectRef = useRef(select);
  selectRef.current = select;

  // useSyncExternalStore compares snapshots by reference and loops forever if getSnapshot
  // returns a fresh object each call, which a selector returning an array always does.
  const cache = useRef<{ value: T; valid: boolean }>({ value: undefined as T, valid: false });

  const depsKey = deps?.join(',') ?? '';

  const subscribe = useCallback(
    (onChange: () => void) =>
      store.subscribe<T>({
        select: (s) => selectRef.current(s),
        onChange: (result) => {
          cache.current = { value: result, valid: true };
          onChange();
        },
        deps,
        equals: sameResult,
      }),
    // depsKey rather than deps: an inline array literal is a new reference every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, depsKey],
  );

  const getSnapshot = useCallback(() => {
    if (!cache.current.valid) {
      cache.current = { value: selectRef.current(store), valid: true };
    }
    return cache.current.value;
  }, [store]);

  // A store swap — switching workspace — must not serve the previous workspace's answer.
  useEffect(() => {
    cache.current = { value: undefined as T, valid: false };
  }, [store]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
