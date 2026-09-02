/**
 * The difference between "this is not here" and "this is not here yet".
 *
 * `useLiveQuery` answers `null` for both, and the shell mounts before the first snapshot
 * finishes on purpose (`app/Boot.tsx`) so the sidebar and the workspace name appear
 * immediately. Every deep link on a cold start therefore rendered a full-page "No such
 * project — it may have been deleted" over a row that was still on the wire, with a Go back
 * button offering the user a way off a page that was about to work.
 *
 * The signal that tells the two apart was already in context — `useSyncStatus()` — and had
 * exactly one consumer, the sync dot in the header. This is that signal, in the shape the
 * ten screens that need it can use:
 *
 *     const state = useEntityState(project);
 *     if (state === 'loading') return <EntityLoading label="Loading project…" />;
 *     if (state === 'missing') return <EmptyState title="No such project" … />;
 *
 * `hydrating` and `bootstrapping` are the only phases that mean "more is coming".  `idle`
 * is an engine that was never started (and is what tests mount with), `failed` has already
 * said so through the boot screen, and `ready` means the store's answer is the whole
 * answer — waiting on any of those three would be a skeleton that never resolves.
 */

import type { ReactNode } from 'react';

import { useSyncStatus } from '~/app/context';
import { Skeleton } from '~/components';
import styles from './EntityGate.module.css';

export type EntityState = 'loading' | 'missing' | 'ready';

/** True while the replica is still filling, so an empty answer is not yet an answer. */
export function useStoreSettled(): boolean {
  const status = useSyncStatus();
  return status.phase !== 'hydrating' && status.phase !== 'bootstrapping';
}

/**
 * What the screen should draw for the record it opened.
 *
 * `undefined` counts as absent alongside `null`, because `Map.get` and `?? null` are both
 * spelled in this codebase and a gate that only understood one of them would be a trap.
 */
export function useEntityState(entity: unknown): EntityState {
  const settled = useStoreSettled();
  if (entity !== null && entity !== undefined) return 'ready';
  return settled ? 'missing' : 'loading';
}

export interface EntityLoadingProps {
  /** Announced by the live region: "Loading project…". Says which thing is coming. */
  label: string;
  /** How many placeholder lines under the title bar. Match the screen's density. */
  lines?: number | undefined;
  className?: string | undefined;
}

/**
 * The skeleton a detail screen shows while its record is still arriving.
 *
 * The blocks are the `Skeleton` primitive, which owns the shimmer and its reduced-motion
 * exception. What belongs here is the one `role="status"` over the region: a skeleton block
 * announces nothing on purpose, and twenty of them each claiming "loading" would be the same
 * fact said twenty times. The widths taper because a paragraph does, and a rectangle of
 * identical bars reads as a table rather than as text on its way.
 */
export function EntityLoading({ label, lines = 3, className }: EntityLoadingProps) {
  return (
    <div
      className={[styles.loading, className].filter(Boolean).join(' ')}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className={styles.hidden}>{label}</span>
      <Skeleton width="40%" height="var(--space-6)" />
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} width={`${100 - index * 12}%`} height="var(--space-4)" />
      ))}
    </div>
  );
}

export interface EntityGateProps {
  /** The record the route points at, straight from `useLiveQuery`. */
  entity: unknown;
  /** Announced while it is still coming. */
  label: string;
  /** What to say once the store has settled and the record really is not there. */
  missing: ReactNode;
  /** The screen. A function so it only runs once the record exists. */
  children: () => ReactNode;
  lines?: number | undefined;
}

/** The three-way branch as a component, for screens whose hooks all sit above it. */
export function EntityGate({ entity, label, missing, children, lines }: EntityGateProps) {
  const state = useEntityState(entity);
  if (state === 'loading') return <EntityLoading label={label} lines={lines} />;
  if (state === 'missing') return <>{missing}</>;
  return <>{children()}</>;
}
