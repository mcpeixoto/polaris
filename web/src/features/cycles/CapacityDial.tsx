/**
 * Trailing-velocity capacity for a cycle that has not started yet.
 */

import { Progress } from '~/components';

import type { CycleCapacity } from './computeCapacity';
import styles from './CapacityDial.module.css';

interface CapacityDialProps {
  readonly data: CycleCapacity;
  readonly compact?: boolean;
}

export function CapacityDial({ data, compact = false }: CapacityDialProps) {
  const unit = data.unitLabel === 'issues' ? 'issues' : 'points';
  const over = data.scoped > data.capacity;
  const detail = `${data.scoped} of ${data.capacity} ${unit}`;
  const source =
    data.source === 'velocity'
      ? `from the last ${data.cyclesSampled === 1 ? 'cycle' : `${data.cyclesSampled} cycles`}`
      : 'estimated from team size';

  if (compact) {
    return (
      <span className={styles.compact}>
        <Progress
          percent={Math.min(data.percent, 100)}
          label="Capacity"
          detail={detail}
          size="sm"
        />
        <span className={over ? styles.over : styles.muted}>
          {data.scoped}/{data.capacity}
        </span>
      </span>
    );
  }

  return (
    <section className={styles.panel} aria-label="Cycle capacity">
      <Progress percent={Math.min(data.percent, 100)} label="Capacity" detail={detail} />
      <div className={styles.copy}>
        <p className={styles.headline}>
          <strong className={over ? styles.over : undefined}>
            {data.scoped} / {data.capacity}
          </strong>{' '}
          {unit} scoped
        </p>
        <p className={styles.muted}>Capacity {source}.</p>
      </div>
    </section>
  );
}
