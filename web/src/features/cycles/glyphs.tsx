/**
 * The glyphs a cycle row draws: the cycle itself, and the scope it holds.
 *
 * 14px at 1.5px stroke, matching `features/projects/glyphs`. The cycle glyph is the same
 * drawing the sidebar's Cycles entry uses, redrawn here so the row does not depend on the
 * navigation's stylesheet.
 */

const stroke = {
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function CycleGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.25" {...stroke} />
      <path d="M8 5.25V8l2 1.5" {...stroke} />
    </svg>
  );
}

/** Stacked bars: how much work the window holds. */
export function ScopeGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 12.5h10M3 8.5h7M3 4.5h4" {...stroke} />
    </svg>
  );
}
