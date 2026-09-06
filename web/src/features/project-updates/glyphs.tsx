/**
 * The two row affordances an update carries. Shared so the Overview's pencil and the
 * Activity list's pencil are the same drawing rather than two that drift apart.
 */

import type { ProjectUpdateHealth } from '~/store';

export function PencilGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none">
      <path
        d="M11.3 2.7a1.4 1.4 0 0 1 2 2L6 12l-2.7.7.7-2.7 7.3-7.3Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TrashGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none">
      <path
        d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5 5 13h6l.5-8.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Health as a shape, not only a hue: a tick on track, a bang at risk, a cross off track.
 *
 * The badge used to be a coloured disc beside its word, which left the disc saying nothing
 * to a reader who cannot tell amber from green. The word still travels with it; the glyph
 * now carries the same fact in outline for the one place — a dense list cell — where the
 * eye lands on the mark before the text.
 */
export function HealthGlyph({ health }: { readonly health: ProjectUpdateHealth }) {
  const stroke = {
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.75" {...stroke} />
      {health === 'on_track' ? (
        <path d="m5.5 8.2 1.8 1.8 3.4-3.6" {...stroke} />
      ) : health === 'at_risk' ? (
        <path d="M8 5v3.5M8 10.75v.25" {...stroke} />
      ) : (
        <path d="m6 6 4 4M10 6l-4 4" {...stroke} />
      )}
    </svg>
  );
}
