import type { HTMLAttributes } from 'react';

import styles from './LabelChip.module.css';

interface LabelChipBase extends Omit<HTMLAttributes<HTMLSpanElement>, 'color'> {
  name: string;
  /** The label's own colour, chosen by whoever created it. Any CSS colour. */
  color: string;
  /** The group's name, shown as `Priority: P0` so a bare "P0" is not the only clue. */
  groupName?: string | undefined;
}

/**
 * The two sizes take different props, and the type says so rather than a comment.
 *
 * A compact chip appears on an issue row, where the whole row is the click target. An 18px
 * dismiss button inside it is below the size anybody can reliably hit, so in practice it
 * is a way to delete a label while trying to open an issue. Removal belongs on the detail
 * view, where the chip is full size — and making that a type error is the only version of
 * the rule that survives the next person in a hurry.
 */
export type LabelChipProps = LabelChipBase &
  (
    | {
        compact?: false | undefined;
        /** Fired by the dismiss control. Its absence is what removes the control. */
        onRemove?: (() => void) | undefined;
      }
    | { compact: true; onRemove?: never }
  );

/**
 * A label, as it appears on an issue.
 *
 * The whole design problem here is that the colour is *workspace data*. Somebody picked it
 * in a colour well, it can be any hex at all, and the same value has to stay legible on a
 * light page, on a near-black page, on a hovered row and inside a menu. Using it as a
 * background and computing a foreground is the obvious approach and it is the wrong one:
 * the arithmetic that keeps text readable on `#ffff00` produces a chip that looks nothing
 * like the colour the user chose, and it has to be redone for every theme.
 *
 * So the colour is a dot and a wash. The dot carries the identity at full strength, the
 * background is a low-percentage mix of it into the surface, and the text stays a token —
 * which means contrast is the theme's problem, where it is already solved, rather than
 * this component's. It also means a custom theme cannot break a label into illegibility,
 * because the only thing the theme controls is the part that was already readable.
 *
 * The colour never carries meaning on its own. The name is always present, and where a
 * label belongs to a group the group's name is rendered with it: "P0" alone is a mystery
 * to anybody who has not memorised the taxonomy, and two labels called "High" in different
 * groups are indistinguishable without it.
 */
export function LabelChip({
  name,
  color,
  groupName,
  compact = false,
  onRemove,
  className,
  ...rest
}: LabelChipProps) {
  return (
    <span
      {...rest}
      className={[styles.chip, compact ? styles.compact : null, className]
        .filter(Boolean)
        .join(' ')}
      // Inline rather than a class because the value is data, not design. The stylesheet
      // reads it back through a custom property so the wash and the dot cannot drift
      // apart; see the CSS.
      style={{ '--label-color': color } as React.CSSProperties}
    >
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.name}>
        {groupName === undefined ? null : <span className={styles.group}>{groupName}: </span>}
        {name}
      </span>
      {onRemove === undefined ? null : (
        <button
          type="button"
          className={styles.remove}
          onClick={(event) => {
            // The chip itself is often inside a clickable row, and removing a label must
            // not also open the issue.
            event.stopPropagation();
            onRemove();
          }}
          // Named for what it does to what, because a row of six chips otherwise offers a
          // screen-reader user six identical "Remove" buttons.
          aria-label={`Remove label ${groupName === undefined ? name : `${groupName}: ${name}`}`}
        >
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </span>
  );
}
