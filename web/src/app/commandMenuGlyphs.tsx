/**
 * One line icon per command group, for the left edge of a command-menu row.
 *
 * An `Action` carries no icon of its own, and a registry of two hundred actions is not
 * going to grow one per row overnight — so the glyph is the group's, which is the level at
 * which the palette is actually scanned: the eye finds the run of "Navigation" rows by the
 * arrow beside them, then reads. A group not named here gets the terminal chevron, which is
 * the honest picture of "a command".
 *
 * Sixteen-pixel line icons at 1.5px stroke, the same weight the sidebar draws its own at.
 */

import type { ReactElement } from 'react';

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const GLYPHS: Readonly<Record<string, ReactElement>> = {
  General: (
    <svg viewBox="0 0 16 16" {...STROKE} aria-hidden="true">
      <path d="M8.5 1.5 3 9h4.5l-1 5.5L13 7H8.5z" />
    </svg>
  ),
  Navigation: (
    <svg viewBox="0 0 16 16" {...STROKE} aria-hidden="true">
      <path d="M2.5 8h11m-4.5-4.5L13.5 8 9 12.5" />
    </svg>
  ),
  Issues: (
    <svg viewBox="0 0 16 16" {...STROKE} aria-hidden="true">
      <circle cx="8" cy="8" r="5.75" />
      <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
    </svg>
  ),
  Views: (
    <svg viewBox="0 0 16 16" {...STROKE} aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="M2.5 6.5h11M6.5 6.5v7" />
    </svg>
  ),
  Editor: (
    <svg viewBox="0 0 16 16" {...STROKE} aria-hidden="true">
      <path d="M3 3.5h10M3 8h10M3 12.5h6" />
    </svg>
  ),
  Inbox: (
    <svg viewBox="0 0 16 16" {...STROKE} aria-hidden="true">
      <path d="M2.5 9.5V4.75A1.25 1.25 0 0 1 3.75 3.5h8.5a1.25 1.25 0 0 1 1.25 1.25V9.5m-11 0h3l1 2h4l1-2h3m-11 0v2.75a1.25 1.25 0 0 0 1.25 1.25h8.5a1.25 1.25 0 0 0 1.25-1.25V9.5" />
    </svg>
  ),
  Selection: (
    <svg viewBox="0 0 16 16" {...STROKE} aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="m5.5 8 2 2 3.5-4" />
    </svg>
  ),
  Filters: (
    <svg viewBox="0 0 16 16" {...STROKE} aria-hidden="true">
      <path d="M2.5 3.5h11L9.5 8.5v4l-3 1.5v-5.5z" />
    </svg>
  ),
  Projects: (
    <svg viewBox="0 0 16 16" {...STROKE} aria-hidden="true">
      <path d="M8 2 13.5 5v6L8 14l-5.5-3V5z" />
    </svg>
  ),
  Search: (
    <svg viewBox="0 0 16 16" {...STROKE} aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </svg>
  ),
};

const COMMAND = (
  <svg viewBox="0 0 16 16" {...STROKE} aria-hidden="true">
    <path d="m3 4 4 4-4 4m5.5 0.5h4.5" />
  </svg>
);

/** Known group names, exported so a test can prove every one of them draws something. */
export const GLYPH_GROUPS: readonly string[] = Object.keys(GLYPHS);

export function commandGlyph(group: string): ReactElement {
  return GLYPHS[group] ?? COMMAND;
}
