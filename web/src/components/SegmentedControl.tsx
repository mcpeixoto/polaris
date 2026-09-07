/**
 * One of these, and only one: Active / Backlog / All, Ascending / Descending, List / Board.
 *
 * Three screens had each grown their own — the issue list's `.scopePill` row, the display
 * menu's `.segmented` track, the projects list's `.pill` row — and the three had drifted
 * into two shapes and three ways of saying which one is in force. They are one control: a
 * small closed set of alternatives where exactly one holds, chosen in place, with no menu
 * to open.
 *
 * Buttons in a named group, each stating `aria-pressed`, rather than a `radiogroup`. A
 * radio group promises arrow-key roving and a single tab stop, and this component may not
 * own a key handler — the keyboard belongs to the registry (see web/src/keys). A group of
 * pressed buttons promises only what it delivers: every segment is its own tab stop, and
 * the pressed one is announced. The group label is required, because "Active, pressed" is
 * only useful after "Which issues".
 *
 * Two looks, because the product has two. `track` is the display menu's tinted rail with
 * the chosen segment lifted onto the panel's own surface, for a control inside a dialogue.
 * `bare` is the list header's row of pills on nothing, for a control sitting in a header
 * that already has a surface.
 */

import type { ReactNode } from 'react';

import styles from './SegmentedControl.module.css';

export type SegmentedControlVariant = 'track' | 'bare';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** The accessible name, where the label is a glyph or too terse to stand alone. */
  'aria-label'?: string | undefined;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Names the group: "Which issues", "Sort direction". */
  'aria-label': string;
  variant?: SegmentedControlVariant | undefined;
  className?: string | undefined;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  'aria-label': label,
  variant = 'track',
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={[styles.group, styles[variant], className].filter(Boolean).join(' ')}
      role="group"
      aria-label={label}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            aria-label={option['aria-label']}
            className={[styles.segment, selected ? styles.on : null].filter(Boolean).join(' ')}
            // Choosing the segment already in force is not a change; firing anyway would
            // have every caller re-sort a list into the order it is already in.
            onClick={selected ? undefined : () => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
