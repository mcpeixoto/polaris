/**
 * The initiative glyph a list row draws before its name — the sidebar's target, redrawn
 * at 14px so the row does not depend on the navigation's stylesheet.
 */

const stroke = {
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function InitiativeGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.25" {...stroke} />
      <circle cx="8" cy="8" r="2" {...stroke} />
      <path d="M8 2.75v2M8 11.25v2M2.75 8h2M11.25 8h2" {...stroke} />
    </svg>
  );
}

/**
 * The rail toggle's glyph: a pane with its trailing column marked.
 *
 * The sidebar's own toggle draws the leading column, because that is the panel it hides.
 * This one hides the panel on the other side, and a glyph pointing the wrong way would be
 * the only thing on the row saying which of the two it means.
 */
export function RailGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="2.5"
        y="3"
        width="11"
        height="10"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
      />
      <path d="M9.5 3v10" stroke="currentColor" strokeWidth={1.4} />
    </svg>
  );
}
