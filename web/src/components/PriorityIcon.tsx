import type { CSSProperties, ReactElement } from 'react';

import styles from './PriorityIcon.module.css';

export interface PriorityIconProps {
  /** 0 none, 1 urgent, 2 high, 3 medium, 4 low — the server's scale, unchanged. */
  priority: number;
  /**
   * Set where the priority is already written beside the icon. The glyph then adds nothing
   * to the accessibility tree, and announcing "Urgent, Urgent" is worse than once.
   */
  decorative?: boolean | undefined;
  className?: string | undefined;
}

/**
 * The five levels in display order — urgent first, none last — which is the order a picker
 * offers them in and the order the list groups by. It is deliberately not `0..4`: the
 * server stores 0 for "no priority", so counting puts unprioritised work above everything
 * urgent. See `PRIORITY_RANK` in the store, which this mirrors.
 */
export const PRIORITY_LEVELS: readonly number[] = [1, 2, 3, 4, 0];

/** The product's words for the scale. Used as the accessible name and by the pickers. */
export const PRIORITY_LABELS: readonly string[] = [
  'No priority',
  'Urgent',
  'High',
  'Medium',
  'Low',
];

/**
 * The label for a priority, tolerating a value outside the scale by calling it none — the
 * same forgiveness `priorityRank` shows, and for the same reason: a workspace restored from
 * a future export must render, not crash.
 */
export function priorityLabel(priority: number): string {
  return PRIORITY_LABELS[priority] ?? 'No priority';
}

const TOKENS: readonly string[] = [
  '--priority-none',
  '--priority-urgent',
  '--priority-high',
  '--priority-medium',
  '--priority-low',
];

/**
 * These two components have no stylesheet of their own, so the size and the colour are
 * inline — still tokens, just applied from the one place that knows which token applies.
 */
const ICON_STYLE: CSSProperties = {
  display: 'block',
  flex: 'none',
  width: 'var(--space-4)',
  height: 'var(--space-4)',
};

/** How many of the three bars are lit, by priority. The rest are drawn as the scale. */
const LIT_BARS: readonly number[] = [0, 0, 3, 2, 1];

/** x, y and height of the three bars, bottom-aligned on a 16-unit grid. */
const BARS: readonly { readonly x: number; readonly y: number; readonly height: number }[] = [
  { x: 1.5, y: 9.5, height: 5 },
  { x: 6.5, y: 6, height: 8.5 },
  { x: 11.5, y: 2.5, height: 12 },
];

/** The unlit part of the scale. Matched to Spinner's track, which does the same job. */
const TRACK_OPACITY = 0.28;

function bars(lit: number): ReactElement {
  return (
    <>
      {BARS.map((bar, index) => (
        <rect
          // Keyed by position, not by whether it is lit: the same three rectangles have to
          // survive a change of level for their opacity to have anything to ease between.
          key={bar.x}
          className={styles.bar}
          x={bar.x}
          y={bar.y}
          width={3}
          height={bar.height}
          rx={1}
          fill="currentColor"
          opacity={index < lit ? undefined : TRACK_OPACITY}
        />
      ))}
    </>
  );
}

function glyph(priority: number): ReactElement {
  // Urgent is the one level that is not a bar chart, because it is the one level that has
  // to stop a reader scanning past it.
  if (priority === 1) {
    return (
      <path
        // One path, evenodd: the exclamation is a hole in the square rather than a mark
        // painted in the page colour, so it stays correct on a hovered row, in a menu and
        // on a coloured group header — three surfaces a fixed fill would be wrong on.
        fillRule="evenodd"
        fill="currentColor"
        d="M4 1h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3Zm4 2.75a.75.75 0 0 0-.75.75v4a.75.75 0 0 0 1.5 0v-4A.75.75 0 0 0 8 3.75Zm0 6.75a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
      />
    );
  }
  // No priority is three level dashes, not three faint bars. Faintness is a colour
  // difference and this icon has to survive being read without colour at all; a flat row
  // of three marks says "no scale here" by its shape, which is the whole point.
  if (priority !== 2 && priority !== 3 && priority !== 4) {
    return (
      <>
        {[3, 7, 11].map((y) => (
          <rect key={y} x={3} y={y} width={10} height={2} rx={1} fill="currentColor" />
        ))}
      </>
    );
  }
  return bars(LIT_BARS[priority] ?? 0);
}

/**
 * PriorityIcon draws the five priority levels.
 *
 * Colour is the last thing this icon relies on, not the first. It is read at a glance in a
 * dense list, often by someone who cannot tell the orange from the red, so each level is a
 * different *shape*: a filled square with an exclamation, then three, two and one lit bars
 * against the unlit remainder of the same scale, then three level dashes for no priority.
 * Count the bars and you have the answer with the colour switched off entirely — which is
 * also how it reads in a screenshot, in a print stylesheet, and out of the corner of an eye.
 *
 * The unlit bars are drawn rather than omitted so all five glyphs occupy the same box. A
 * list whose icons change width shifts every title in it by a pixel or two per row, and
 * that is visible as noise long before anyone works out what is causing it.
 */
export function PriorityIcon({ priority, decorative = false, className }: PriorityIconProps) {
  const token = TOKENS[priority] ?? '--priority-none';
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      style={{ ...ICON_STYLE, color: `var(${token})` }}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : priorityLabel(priority)}
      aria-hidden={decorative ? true : undefined}
    >
      {glyph(priority)}
    </svg>
  );
}
