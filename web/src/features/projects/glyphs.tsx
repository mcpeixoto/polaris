/**
 * The small line glyphs a project row and rail draw beside their values.
 *
 * 14px at 1.5px stroke, the size and weight Linear uses inside a row, and drawn here rather
 * than borrowed from the sidebar's `NavGlyph` so a change to the navigation's icon weight
 * does not reach into a table cell.
 */

import type { ReactNode } from 'react';

const stroke = {
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function Glyph({ children }: { readonly children: ReactNode }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      {children}
    </svg>
  );
}

/** A project with no emoji of its own: the box the sidebar uses for Projects. */
export function ProjectGlyph() {
  return (
    <Glyph>
      <path d="M8 2.5 13.5 6v4L8 13.5 2.5 10V6L8 2.5Z" {...stroke} />
      <path d="M8 8v5.5M2.5 6 8 8l5.5-2" {...stroke} />
    </Glyph>
  );
}

/** A milestone: the diamond the timeline ticks with. */
export function MilestoneGlyph() {
  return (
    <Glyph>
      <path d="M8 2.5 13.5 8 8 13.5 2.5 8 8 2.5Z" {...stroke} />
    </Glyph>
  );
}

export function CalendarGlyph() {
  return (
    <Glyph>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" {...stroke} />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" {...stroke} />
    </Glyph>
  );
}

/** The empty seat where a lead's avatar would go. */
export function NoPersonGlyph() {
  return (
    <Glyph>
      <circle cx="8" cy="8" r="5.5" strokeDasharray="2 2" {...stroke} />
      <circle cx="8" cy="6.5" r="1.75" {...stroke} />
      <path d="M4.75 12a3.5 3.5 0 0 1 6.5 0" {...stroke} />
    </Glyph>
  );
}

export function PlusGlyph() {
  return (
    <Glyph>
      <path d="M8 3.5v9M3.5 8h9" {...stroke} />
    </Glyph>
  );
}

/** A person: the members row in the rail. */
export function MembersGlyph() {
  return (
    <Glyph>
      <circle cx="6" cy="5.5" r="2" {...stroke} />
      <path d="M3 12.5c.2-2 1.6-3 3-3s2.8 1 3 3" {...stroke} />
      <circle cx="11" cy="6" r="1.5" {...stroke} />
      <path d="M10.2 12.5c.15-1.4 1-2.2 2-2.2" {...stroke} />
    </Glyph>
  );
}

export function LabelGlyph() {
  return (
    <Glyph>
      <path
        d="M2.5 8.2 8.2 2.5h4.3A1 1 0 0 1 13.5 3.5v4.3L7.8 13.5a1 1 0 0 1-1.4 0L2.5 9.6a1 1 0 0 1 0-1.4Z"
        {...stroke}
      />
      <circle cx="10.2" cy="5.8" r="0.9" fill="currentColor" />
    </Glyph>
  );
}
