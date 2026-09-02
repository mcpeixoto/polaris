import styles from './Skeleton.module.css';

export interface SkeletonProps {
  /** Any CSS length. Defaults to filling the container, which is right for a row. */
  width?: string | undefined;
  /** Any CSS length. Defaults to one line of body text. */
  height?: string | undefined;
  /** `full` for an avatar-shaped placeholder; `md` otherwise. */
  radius?: 'sm' | 'md' | 'full' | undefined;
  className?: string | undefined;
}

/**
 * Skeleton is what a screen shows while its rows are still arriving.
 *
 * It exists because the alternative this codebase had was worse in a specific way. Ten
 * screens each shipped a bare `.loading` div, and every list that had none of its own fell
 * through to `EmptyState` after 200ms — so a slow first sync said "Nothing here" about data
 * that was on its way. In a local-first client, "empty" and "not yet" are different facts
 * and the user acts differently on each; painting one as the other is a lie the interface
 * tells while it is still loading.
 *
 * The shimmer is decoration and deliberately silent. A skeleton block announces nothing: the
 * surrounding screen owns the one `aria-busy`/`role="status"` that says the region is
 * loading, and twenty placeholders each claiming it would be twenty announcements of the
 * same fact. Under `prefers-reduced-motion` the sweep stops entirely rather than collapsing
 * to the 1ms the token gives it, which for an infinite animation is a strobe — the same
 * exception, for the same reason, that `Spinner` takes.
 */
export function Skeleton({ width, height, radius = 'md', className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={[styles.skeleton, styles[radius], className].filter(Boolean).join(' ')}
      style={{ width, height }}
    />
  );
}

export interface SkeletonRowsProps {
  /** How many placeholder rows. Match the density of the list being stood in for. */
  count?: number | undefined;
  /** Row height. Defaults to the issue row's own height, which is what most lists are. */
  height?: string | undefined;
  className?: string | undefined;
}

/**
 * The list-shaped case, which is nearly every case.
 *
 * A count rather than a caller's `map`, because the loop is the part every screen was about
 * to write identically, and because the number of rows a skeleton shows is a judgement about
 * density that belongs next to the component drawing them.
 */
export function SkeletonRows({ count = 6, height, className }: SkeletonRowsProps) {
  return (
    <div className={[styles.rows, className].filter(Boolean).join(' ')}>
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} height={height ?? 'var(--space-8)'} />
      ))}
    </div>
  );
}
