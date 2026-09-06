/**
 * The line icons the issue screens draw: the header's actions, the rail's property rows,
 * the section chevrons and the activity feed's kinds.
 *
 * Drawn here rather than pulled from an icon set for the reason `relations.tsx` gives for
 * its two: the component library has no icon module, and a dependency for twenty paths is
 * a dependency to keep current. Every glyph is a 16-unit box at a 1.5 stroke so that one
 * `width`/`height` on the caller's side sizes them all alike — 16px in a header, 14px on a
 * rail row, 12px inside a pill — and `currentColor` so the row's own text colour paints
 * them. All are `aria-hidden`: the control or the row they sit in carries the name.
 */

import type { SVGProps } from 'react';

type GlyphProps = Omit<SVGProps<SVGSVGElement>, 'children'>;

function Glyph({ children, ...rest }: GlyphProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** A right-pointing chevron. Rotated by the caller's stylesheet when a section is open. */
export function ChevronGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </Glyph>
  );
}

export function PlusGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M8 3.5v9M3.5 8h9" />
    </Glyph>
  );
}

export function CrossGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </Glyph>
  );
}

export function DotsGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="3.5" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r="0.9" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/** Filled when `on`, so the favourite state is drawn as well as announced. */
export function StarGlyph({ on = false, ...props }: GlyphProps & { on?: boolean | undefined }) {
  return (
    <Glyph {...props}>
      <path
        d="M8 2.2l1.8 3.7 4.1.6-3 2.9.7 4.1L8 11.6l-3.6 1.9.7-4.1-3-2.9 4.1-.6z"
        fill={on ? 'currentColor' : 'none'}
      />
    </Glyph>
  );
}

export function LinkGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M6.8 9.2a2.8 2.8 0 0 0 4 0l2-2a2.8 2.8 0 0 0-4-4l-.9.9" />
      <path d="M9.2 6.8a2.8 2.8 0 0 0-4 0l-2 2a2.8 2.8 0 0 0 4 4l.9-.9" />
    </Glyph>
  );
}

export function CopyGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </Glyph>
  );
}

export function BranchGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="4.5" cy="3.5" r="1.5" />
      <circle cx="4.5" cy="12.5" r="1.5" />
      <circle cx="11.5" cy="5" r="1.5" />
      <path d="M4.5 5v6M11.5 6.5c0 2.5-7 2-7 4.5" />
    </Glyph>
  );
}

export function TrashGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M3 4.5h10M6.5 4.5v-1a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1M4.5 4.5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8" />
    </Glyph>
  );
}

export function PaperclipGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M10.8 5.2 6.4 9.6a1.2 1.2 0 0 0 1.7 1.7l4.7-4.7a2.6 2.6 0 0 0-3.7-3.7L4.3 7.7a4 4 0 0 0 5.6 5.6l3.4-3.4" />
    </Glyph>
  );
}

/** A parent with two children under it. */
export function SubIssueGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="2.5" y="2.5" width="5" height="3.5" rx="1" />
      <rect x="8.5" y="10" width="5" height="3.5" rx="1" />
      <path d="M5 6v4.5a1.5 1.5 0 0 0 1.5 1.5h2" />
    </Glyph>
  );
}

export function CalendarGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 7h11M5.5 2v3M10.5 2v3" />
    </Glyph>
  );
}

/** Three rising bars: the estimate. */
export function EstimateGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M3.5 13V9.5M8 13V6M12.5 13V3" />
    </Glyph>
  );
}

/** A hexagonal box: the project. */
export function ProjectGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M8 2.2 13 5v6l-5 2.8L3 11V5z" />
      <path d="M3 5l5 2.8L13 5M8 7.8V13.8" />
    </Glyph>
  );
}

/** Two arrows chasing each other: the cycle. */
export function CycleGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M13 8a5 5 0 0 1-8.7 3.4M3 8a5 5 0 0 1 8.7-3.4" />
      <path d="M11.5 2.5v2.4h-2.4M4.5 13.5v-2.4h2.4" />
    </Glyph>
  );
}

export function MilestoneGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M8 2.5 13.5 8 8 13.5 2.5 8z" />
    </Glyph>
  );
}

export function RepeatGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M3 6.5V6a2 2 0 0 1 2-2h8M11 2l2 2-2 2M13 9.5v.5a2 2 0 0 1-2 2H3M5 14l-2-2 2-2" />
    </Glyph>
  );
}

export function TagGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M2.5 3.5v4.2c0 .4.2.8.4 1.1l5.3 5.3a1.5 1.5 0 0 0 2.1 0l3.5-3.5a1.5 1.5 0 0 0 0-2.1L8.5 3.2a1.5 1.5 0 0 0-1-.4H3.5a1 1 0 0 0-1 .7z" />
      <circle cx="5.8" cy="6" r="0.8" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/** A dashed head-and-shoulders: nobody assigned. */
export function UnassignedGlyph(props: GlyphProps) {
  return (
    <Glyph {...props} strokeDasharray="2.2 1.6">
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3 13.5a5 5 0 0 1 10 0" />
    </Glyph>
  );
}

export function BellGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M4 11V7.5a4 4 0 0 1 8 0V11l1 1.5H3z" />
      <path d="M6.5 13.5a1.5 1.5 0 0 0 3 0" />
    </Glyph>
  );
}

export function PencilGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M11.3 2.7l2 2L6 12H4v-2z" />
      <path d="M9.7 4.3l2 2" />
    </Glyph>
  );
}

/** A dot with a ring: the activity feed's fallback marker. */
export function DotGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/** A speech bubble: a comment, a mention. */
export function CommentGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M3 3.5h10a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-.5.5H7l-3.5 2.5V10.5H3a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z" />
    </Glyph>
  );
}
