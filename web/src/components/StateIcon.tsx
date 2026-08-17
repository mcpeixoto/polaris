import type { CSSProperties, ReactElement } from 'react';

import type { StateCategory } from '../store';

export interface StateIconProps {
  category: StateCategory;
  /**
   * The workflow state's own colour, as the workspace set it. This is the one place a
   * component takes a raw colour rather than a token, and it is not an exception to the
   * rule: a status's colour is *data*, chosen by the team in team settings, and no theme
   * gets to overrule it. Omit it and the category's token is used, which is what every
   * picker, header and chart wants.
   */
  color?: string | undefined;
  /**
   * How far through the started work is, 0 to 1. Halfway when unknown, because "in
   * progress" is what the glyph has to say and an empty pie says "not started".
   */
  progress?: number | undefined;
  /**
   * The accessible name, defaulting to the category. Pass the workflow state's real name —
   * "In Review", "Needs QA" — wherever it is known: the category is the product's word for
   * the shape, and the state's name is the team's word for the thing.
   */
  label?: string | undefined;
  /** Set where the status is already written beside the icon, to stop it being read twice. */
  decorative?: boolean | undefined;
  className?: string | undefined;
}

/** The product's words for the categories. The default accessible name for each glyph. */
export const STATE_LABELS: Readonly<Record<StateCategory, string>> = {
  triage: 'Triage',
  backlog: 'Backlog',
  unstarted: 'Unstarted',
  started: 'Started',
  completed: 'Completed',
  canceled: 'Canceled',
  duplicate: 'Duplicate',
};

/**
 * Duplicate has no colour of its own. It is closed work with a reason attached rather than
 * a seventh place an issue can be, it is never assigned by hand, and giving it a token
 * would put a value in every theme that no theme author can reason about.
 */
const TOKENS: Readonly<Record<StateCategory, string>> = {
  triage: '--state-triage',
  backlog: '--state-backlog',
  unstarted: '--state-unstarted',
  started: '--state-started',
  completed: '--state-completed',
  canceled: '--state-canceled',
  duplicate: '--state-canceled',
};

const ICON_STYLE: CSSProperties = {
  display: 'block',
  flex: 'none',
  width: 'var(--space-4)',
  height: 'var(--space-4)',
};

/** The ring: radius 6 with a 2-wide stroke, so every glyph fills the same 14-unit circle. */
const RING_RADIUS = 6;
const RING_STROKE = 2;
/** Filled glyphs match the ring's outer edge exactly, or the two read as different sizes. */
const DISC_RADIUS = RING_RADIUS + RING_STROKE / 2;
const PIE_RADIUS = 3.75;

/**
 * Eight even dashes on a circumference of 2π×6 ≈ 37.7. Written out rather than computed so
 * that the dashes close cleanly at twelve o'clock instead of leaving a short last segment.
 */
const DASH_ARRAY = '2.4 2.31';

/**
 * The interior marks are painted in the page colour rather than cut out of the disc. They
 * are entirely surrounded by the fill, so nothing about them touches the surface behind the
 * icon and the illusion holds on a hovered row or inside a menu.
 */
const KNOCKOUT: CSSProperties = { stroke: 'var(--bg-primary)' };

function ring(dashed: boolean): ReactElement {
  return (
    <circle
      cx={8}
      cy={8}
      r={RING_RADIUS}
      fill="none"
      stroke="currentColor"
      strokeWidth={RING_STROKE}
      strokeDasharray={dashed ? DASH_ARRAY : undefined}
    />
  );
}

/**
 * The wedge, drawn from twelve o'clock clockwise. A full circle cannot be expressed as one
 * arc — start and end coincide and the browser draws nothing — so it is special-cased
 * rather than approximated at 359 degrees.
 */
function pie(progress: number): ReactElement | null {
  const fraction = Math.min(Math.max(progress, 0), 1);
  if (fraction <= 0) return null;
  if (fraction >= 1) return <circle cx={8} cy={8} r={PIE_RADIUS} fill="currentColor" />;
  const angle = fraction * 2 * Math.PI;
  const x = 8 + PIE_RADIUS * Math.sin(angle);
  const y = 8 - PIE_RADIUS * Math.cos(angle);
  const largeArc = fraction > 0.5 ? 1 : 0;
  return (
    <path
      d={`M8 8 L8 ${8 - PIE_RADIUS} A${PIE_RADIUS} ${PIE_RADIUS} 0 ${largeArc} 1 ${x.toFixed(3)} ${y.toFixed(3)} Z`}
      fill="currentColor"
    />
  );
}

function glyph(category: StateCategory, progress: number): ReactElement {
  switch (category) {
    case 'triage':
      // A dashed ring says "not in a workflow yet"; the mark inside says "and somebody has
      // to look at it". Backlog is the same ring without the mark, so the two are told
      // apart by shape and not by the grey.
      return (
        <>
          {ring(true)}
          <rect x={7.25} y={4.4} width={1.5} height={4.2} rx={0.75} fill="currentColor" />
          <circle cx={8} cy={10.7} r={0.95} fill="currentColor" />
        </>
      );
    case 'backlog':
      return ring(true);
    case 'unstarted':
      return ring(false);
    case 'started':
      return (
        <>
          {ring(false)}
          {pie(progress)}
        </>
      );
    case 'completed':
      return (
        <>
          <circle cx={8} cy={8} r={DISC_RADIUS} fill="currentColor" />
          <path
            d="M4.9 8.2 7 10.3l4.1-4.4"
            style={KNOCKOUT}
            fill="none"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    case 'canceled':
    case 'duplicate':
      return (
        <>
          <circle cx={8} cy={8} r={DISC_RADIUS} fill="currentColor" />
          <path
            d="m5.6 5.6 4.8 4.8m0-4.8-4.8 4.8"
            style={KNOCKOUT}
            fill="none"
            strokeWidth={1.75}
            strokeLinecap="round"
          />
        </>
      );
  }
}

/**
 * StateIcon draws the status categories: the mark at the head of every issue row, in every
 * status picker, and in every group header in the list.
 *
 * The six shapes carry the meaning on their own — dashed ring for work that is not in the
 * workflow yet, open ring for work that has not begun, a filling pie for work under way,
 * a disc for work that is finished one way or the other. Colour agrees with the shape but
 * is never the only thing saying it, because backlog and unstarted are both grey by
 * design, and a reader scanning two hundred rows is reading silhouettes rather than hues.
 *
 * `duplicate` shares the canceled drawing. The product treats it as closed work with a
 * different reason rather than a different kind of state — it is system-managed, never
 * assignable, and never in a picker — so it is the accessible name that separates them,
 * which is where that distinction is actually useful.
 */
export function StateIcon({
  category,
  color,
  progress = 0.5,
  label,
  decorative = false,
  className,
}: StateIconProps) {
  const paint = color ?? `var(${TOKENS[category]})`;
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      style={{ ...ICON_STYLE, color: paint }}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : (label ?? STATE_LABELS[category])}
      aria-hidden={decorative ? true : undefined}
    >
      {glyph(category, progress)}
    </svg>
  );
}
