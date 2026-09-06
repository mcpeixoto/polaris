/**
 * A completion ring at the size a table row draws it — 14px, between the two sizes
 * `components/Progress` ships, both of which answer to the 32px issue row rather than to
 * a 51px project row.
 *
 * Same contract as `Progress`: `role="img"` with a written name, because a ring is a
 * picture of a ratio and the ratio is the fact. The stroke is `currentColor`, so a caller
 * can hand it a status's own colour — data the workspace chose — and the default is the
 * accent, which is what progress means when nothing more specific is known.
 */

import type { CSSProperties } from 'react';

import styles from './ProgressRing.module.css';

interface ProgressRingProps {
  /** 0–100. Clamped, not rejected: a rollup should not throw. */
  readonly percent: number;
  /** What is being measured — "Launch", "Cycle 31". */
  readonly label: string;
  /** "3 of 5 issues completed". Read in place of the bare percentage when given. */
  readonly detail?: string | undefined;
  readonly className?: string | undefined;
  /** Inline only for a colour that is data — a status's own — never for layout. */
  readonly style?: CSSProperties | undefined;
}

export function ProgressRing({ percent, label, detail, className, style }: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  // One dash the length of the ring, wound back by what is not done yet — a single length
  // for the browser to interpolate, so a change sweeps rather than shuffles both ends.
  const radius = 5.5;
  const circumference = 2 * Math.PI * radius;
  const filled = (clamped / 100) * circumference;
  const description = detail === undefined ? `${label}: ${clamped}%` : `${label}: ${detail}`;

  return (
    <span
      className={[styles.ring, className].filter(Boolean).join(' ')}
      style={style}
      role="img"
      aria-label={description}
      title={description}
    >
      <svg viewBox="0 0 14 14" aria-hidden="true">
        <circle className={styles.track} cx="7" cy="7" r={radius} />
        <circle
          className={styles.fill}
          cx="7"
          cy="7"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference - filled}
          transform="rotate(-90 7 7)"
        />
      </svg>
    </span>
  );
}
