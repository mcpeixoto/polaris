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
