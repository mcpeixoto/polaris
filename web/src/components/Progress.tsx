import styles from './Progress.module.css';

export interface ProgressProps {
  /** 0–100. Values outside are clamped rather than rejected: a rollup should not throw. */
  percent: number;
  /**
   * What the number is about, for the accessible name. Required, because "62%" read on its
   * own tells a screen-reader user nothing about what is 62% done.
   */
  label: string;
  /**
   * Shown in the tooltip and read out alongside the percentage — "3 of 5 sub-issues". The
   * ring alone cannot say how many things it is summarising, and 2 of 3 and 200 of 300 are
   * not equally interesting.
   */
  detail?: string | undefined;
  size?: 'sm' | 'md' | undefined;
}

/**
 * A completion ring, for sub-issue progress.
 *
 * A ring rather than a bar because it sits inline in a title row beside an identifier and
 * a set of label chips, where a bar would need width it cannot have and would read as a
 * separator between the things either side of it.
 *
 * It is `role="img"` with a name, not `role="progressbar"`. A progressbar announces an
 * operation in flight — a copy, an upload — and screen readers treat it as something to
 * watch. This is a standing fact about an issue, no more live than its priority, and
 * announcing it as an operation makes a list of fifty parents sound like fifty downloads.
 */
export function Progress({ percent, label, detail, size = 'md' }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));

  // A stroke-dasharray on a circle, so the ring is one element and scales with the font
  // rather than needing a size prop threaded through every caller.
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const filled = (clamped / 100) * circumference;

  const description = detail === undefined ? `${label}: ${clamped}%` : `${label}: ${detail}`;

  return (
    <span
      className={[styles.ring, size === 'sm' ? styles.sm : null].filter(Boolean).join(' ')}
      role="img"
      aria-label={description}
      title={description}
    >
      <svg viewBox="0 0 18 18" aria-hidden="true">
        <circle className={styles.track} cx="9" cy="9" r={radius} />
        <circle
          className={styles.fill}
          cx="9"
          cy="9"
          r={radius}
          strokeDasharray={`${filled} ${circumference}`}
          // Starts the arc at twelve o'clock. Without it the ring fills from three
          // o'clock, which reads as an arbitrary rotation rather than as progress.
          transform="rotate(-90 9 9)"
        />
      </svg>
    </span>
  );
}
