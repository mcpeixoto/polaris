import { Skeleton } from '~/components';

import styles from './RouteFallback.module.css';

export type FallbackVariant = 'list' | 'detail' | 'settings';

/**
 * Which shape a path is about to become.
 *
 * A prefix table rather than a second copy of the route tree: the point is not to know
 * exactly which screen is loading, it is to know whether the pane is about to hold a list, a
 * document, or a record with a properties column. Getting the family right is nearly all of
 * the value and none of the maintenance — a route added under `/settings` is covered the day
 * it is written, and a new list screen falls into the default, which is the list.
 */
export function fallbackVariantFor(pathname: string): FallbackVariant {
  if (pathname === '/settings' || pathname.startsWith('/settings/')) return 'settings';

  const detail = [
    '/issue/',
    '/project/',
    '/document/',
    '/customer/',
    '/initiative/',
    '/cycle/',
    '/dashboard/',
  ];
  if (detail.some((prefix) => pathname.startsWith(prefix))) return 'detail';

  // A team's home is a record, not a list — the only detail screen whose path does not say so.
  if (/^\/team\/[^/]+\/home$/.test(pathname)) return 'detail';

  return 'list';
}

export interface RouteFallbackProps {
  variant?: FallbackVariant | undefined;
}

/**
 * What the main pane shows while a lazy route chunk is still arriving.
 *
 * It replaced eight identical grey bars, and the two things wrong with those are worth
 * stating because they are the whole design here. The first is that a warm chunk resolves in
 * tens of milliseconds, so the bars mounted and unmounted inside a couple of frames — a
 * flicker on every navigation, which reads as a fault in the application rather than as
 * loading. The stylesheet answers that with a delay in front of the entrance, so a fast
 * navigation paints no placeholder at all. The second is that a bar stack is a placeholder
 * for nothing in particular: the pane visibly re-laid itself out when content landed. So the
 * shapes below are the destination's shapes, measured against the same tokens the real
 * screens use, and the arrival is a swap rather than a jump.
 *
 * The whole region carries one `role="status"` with `aria-busy`, and every block inside it
 * stays `aria-hidden` — the contract `Skeleton` documents. Forty placeholders each announcing
 * themselves is forty announcements of one fact.
 */
export function RouteFallback({ variant = 'list' }: RouteFallbackProps) {
  return (
    <div className={styles.fallback} role="status" aria-busy="true" aria-label="Loading">
      {variant === 'settings' ? (
        <SettingsShape />
      ) : variant === 'detail' ? (
        <DetailShape />
      ) : (
        <ListShape />
      )}
    </div>
  );
}

/*
 * Row widths that are varied but not random.
 *
 * A list of equal-length titles is the one thing a real list never looks like, and
 * `Math.random()` in a render is worse than equal: it changes on every re-render, so the
 * placeholder shimmers *and* reshuffles. A fixed cycle gives the eye the irregularity it
 * expects and gives React a stable tree.
 */
const TITLE_WIDTHS = ['62%', '38%', '81%', '47%', '70%', '29%', '55%', '74%'];

function ListShape() {
  return (
    <>
      <div className={styles.listHeader}>
        <Skeleton width="var(--space-5)" height="var(--space-5)" radius="md" />
        <Skeleton width="9ch" height="var(--font-size-md)" />
        <div className={styles.listActions}>
          <Skeleton width="var(--space-16)" height="var(--control-height-md)" radius="md" />
          <Skeleton width="var(--space-12)" height="var(--control-height-md)" radius="md" />
        </div>
      </div>
      <div className={styles.rows}>
        {TITLE_WIDTHS.map((width, index) => (
          <div className={styles.row} key={index}>
            <Skeleton width="var(--space-3)" height="var(--space-3)" radius="full" />
            <Skeleton width="7ch" height="var(--font-size-sm)" radius="sm" />
            <div className={styles.rowTitle}>
              <Skeleton width={width} height="var(--font-size-md)" radius="sm" />
            </div>
            <div className={styles.rowEnd}>
              <Skeleton width="var(--space-10)" height="var(--font-size-sm)" radius="sm" />
              <Skeleton width="var(--space-5)" height="var(--space-5)" radius="full" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function DetailShape() {
  return (
    <>
      <div className={styles.listHeader}>
        <Skeleton width="7ch" height="var(--font-size-sm)" radius="sm" />
        <Skeleton width="12ch" height="var(--font-size-sm)" radius="sm" />
      </div>
      <div className={styles.detailBody}>
        <div className={styles.detailMain}>
          <Skeleton width="68%" height="var(--space-6)" />
          <div className={styles.paragraph}>
            <Skeleton height="var(--font-size-md)" radius="sm" />
            <Skeleton height="var(--font-size-md)" radius="sm" />
            <Skeleton width="84%" height="var(--font-size-md)" radius="sm" />
            {/* The short last line is what makes a block of bars read as prose. */}
            <Skeleton width="41%" height="var(--font-size-md)" radius="sm" />
          </div>
        </div>
        <div className={styles.detailSide}>
          {['70%', '55%', '62%', '48%', '66%'].map((width, index) => (
            <div className={styles.property} key={index}>
              <Skeleton width="var(--space-4)" height="var(--space-4)" radius="full" />
              <Skeleton width={width} height="var(--font-size-sm)" radius="sm" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function SettingsShape() {
  return (
    <div className={styles.settingsBody}>
      <div className={styles.settingsHeader}>
        <Skeleton width="10ch" height="var(--font-size-2xl)" />
        <Skeleton width="46ch" height="var(--font-size-md)" radius="sm" />
      </div>
      <Skeleton width="14ch" height="var(--font-size-lg)" />
      <div className={styles.card}>
        {['58%', '44%', '66%', '39%'].map((width, index) => (
          <div className={styles.settingsRow} key={index}>
            <div className={styles.settingsLabel}>
              <Skeleton width={width} height="var(--font-size-md)" radius="sm" />
              <Skeleton width="88%" height="var(--font-size-sm)" radius="sm" />
            </div>
            <Skeleton width="var(--space-16)" height="var(--control-height-md)" radius="md" />
          </div>
        ))}
      </div>
    </div>
  );
}
