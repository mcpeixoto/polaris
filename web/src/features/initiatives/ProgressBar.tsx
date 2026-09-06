/**
 * How much of a set of issues is done — a bar, and the number beside it.
 *
 * The number is not optional. A bar alone is a picture of a ratio that a reader has to
 * estimate, and in the 32px list row it is eight pixels tall; the percentage is what makes
 * the column answerable at a glance. The whole thing is one `role="img"` with a written
 * name, so the fill and the digits are announced once rather than twice.
 */

import { ProgressRing } from '~/features/projects/ProgressRing';

import type { Progress } from './progress';
import styles from './ProgressBar.module.css';

interface ProgressBarProps {
  readonly progress: Progress;
  /** Names what is being measured: "Platform reliability progress". */
  readonly label: string;
  readonly compact?: boolean | undefined;
}

export function ProgressBar({ progress, label, compact = false }: ProgressBarProps) {
  if (progress.total === 0) {
    return <span className={styles.muted}>No issues</span>;
  }

  const detail = `${progress.completed} of ${progress.total} issues completed, ${progress.percent}%`;

  // In a row the bar becomes a ring: the column is a few characters wide, and a ring says
  // the same ratio in the width of a glyph, with the digits beside it as before.
  if (compact) {
    return (
      <span className={styles.compact}>
        <ProgressRing percent={progress.percent} label={label} detail={detail} />
        <span className={styles.value} aria-hidden="true">
          {progress.percent}%
        </span>
      </span>
    );
  }

  return (
    <span className={styles.wrap} role="img" aria-label={`${label}: ${detail}`}>
      <span className={styles.track} aria-hidden="true">
        <span className={styles.fill} style={{ width: `${progress.percent}%` }} />
      </span>
      <span className={styles.value} aria-hidden="true">
        {progress.percent}%
      </span>
    </span>
  );
}
