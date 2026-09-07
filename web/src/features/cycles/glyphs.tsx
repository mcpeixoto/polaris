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

/**
 * The step-back and step-forward chevrons the cycle header's switcher draws.
 *
 * Drawn here rather than inline in the view, which is where all three of the detail
 * header's icons used to live: a screen that writes its own `<svg>` is a screen whose
 * stroke weight and box size drift from every other icon in the product the first time
 * either is touched. The three-dot glyph that sat beside them is not redrawn at all — the
 * issue screens already export one, and a fourth copy of three circles is three chances to
 * disagree about their radius.
 */
export function PreviousCycleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10 3.5 5.5 8l4.5 4.5" {...stroke} />
    </svg>
  );
}

export function NextCycleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 3.5 10.5 8 6 12.5" {...stroke} />
    </svg>
  );
}

/** Two figures: the members panel's toggle, which had no visible control at all before. */
export function CycleMembersGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="6" cy="6" r="2.25" {...stroke} />
      <path d="M2.5 13c0-2 1.6-3.25 3.5-3.25S9.5 11 9.5 13" {...stroke} />
      <path d="M10.5 4.2a2.25 2.25 0 0 1 0 4.1M11.5 9.9c1.3.3 2.2 1.4 2.2 3.1" {...stroke} />
    </svg>
  );
}
