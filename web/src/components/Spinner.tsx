import styles from './Spinner.module.css';

export type SpinnerSize = 'sm' | 'md';

export interface SpinnerProps {
  size?: SpinnerSize | undefined;
  /**
   * The accessible name, which is also the switch between "this is the busy indicator"
   * and "this is decoration". Omit it inside a control that already reports its own state
   * — a loading Button carries `aria-busy`, and a second announcement from the spinner
   * inside it says the same thing twice.
   */
  label?: string | undefined;
  className?: string | undefined;
}

/**
 * Spinner is the only indeterminate progress indicator in the product.
 *
 * It draws in `currentColor` rather than taking a colour, because it is always shown
 * inside something that has already decided what colour it is — a button, a row, an empty
 * state — and a spinner that disagrees with its container is a spinner that looks pasted on.
 */
export function Spinner({ size = 'md', label, className }: SpinnerProps) {
  const decorative = label === undefined;
  return (
    <span
      className={[styles.spinner, styles[size], className].filter(Boolean).join(' ')}
      role={decorative ? undefined : 'status'}
      aria-label={label}
      aria-hidden={decorative ? true : undefined}
    >
      <svg className={styles.svg} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle
          className={styles.track}
          cx="8"
          cy="8"
          r="6.5"
          stroke="currentColor"
          strokeWidth="2"
        />
        {/* A quarter of the circumference (2π × 6.5 ≈ 40.8), so the arc reads as motion
            rather than as a nearly-closed ring. */}
        <circle
          className={styles.arc}
          cx="8"
          cy="8"
          r="6.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="10.2 40.8"
        />
      </svg>
    </span>
  );
}
