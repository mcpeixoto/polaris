/**
 * A store subscription whose question is allowed to change.
 *
 * `useQuery` in app/context is the right tool for a selector that reads nothing but the
 * store: it caches its answer and recomputes only when the store says something relevant
 * moved. That cache is precisely wrong for a selector that also closes over a route
 * parameter. Navigating from `/team/ENG` to `/team/PLAT` changes the question without
 * changing the store, so nothing notifies, the cached answer survives, and the screen keeps
 * rendering the previous team's issues until an unrelated delta happens to arrive.
 *
 * This hook takes the closed-over values explicitly and treats them as part of the
 * subscription's identity, so a changed question is re-asked in the same render it changed
 * in. Everything else — subscribing to query RESULTS rather than to entities, comparing
 * results structurally so equal ids are not a re-render — is the same bargain the store's
 * `subscribe` offers, and the reason a keystroke re-renders a list inside one frame.
 */

import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';

import { useStore } from '~/app/context';
import { sameResult, type EntityType, type Store } from '~/store';

export function useLiveQuery<T>(
  select: (store: Store) => T,
  /**
   * The entity types the answer can depend on. A list that declares `['issue']` sleeps
   * through every comment posted anywhere in the workspace.
   */
  deps: readonly EntityType[],
  /** The values the selector closes over — route params, filters, the current team. */
  inputs: readonly unknown[] = [],
): T {
  const store = useStore();

  // The selector is an inline arrow, so it is a new function every render. Reading it
  // through a ref keeps the subscription stable; resubscribing per render would tear the
  // store's subscriber set down and rebuild it on every keystroke.
  const selectRef = useRef(select);
  selectRef.current = select;

  // One object whose identity changes exactly when the question does. Used as the cache's
  // stamp as well as the subscription's key, so the two can never disagree about which
  // question the cached answer belongs to.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const question = useMemo(() => ({}), [store, deps.join(','), ...inputs]);

  const cache = useRef<{ question: object | null; value: T }>({
    question: null,
    value: undefined as T,
  });

  const subscribe = useCallback(
    (onChange: () => void) =>
      store.subscribe<T>({
        select: (current) => selectRef.current(current),
        onChange: (result) => {
          cache.current = { question, value: result };
          onChange();
        },
        deps,
        equals: sameResult,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, question],
  );

  const getSnapshot = useCallback(() => {
    if (cache.current.question !== question) {
      cache.current = { question, value: selectRef.current(store) };
    }
    return cache.current.value;
  }, [store, question]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
