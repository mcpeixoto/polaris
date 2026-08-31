/**
 * The Polaris mark and wordmark, and the only place either is drawn.
 *
 * Until now the logo was the string "Polaris" in semibold, repeated in five files with
 * five slightly different rules for its size and colour. That is not a logo, it is a
 * heading that happens to be in the top-left, and it left the product with nothing to put
 * in a favicon, a tab, an OG card or an installed app that was not a screenshot of type.
 *
 * ## The mark
 *
 * A four-point star inside a tilted orbit. It is the obvious mark and it is the right one:
 * Polaris is the star you navigate by because it is the one that does not move, which is
 * also the pitch — a local replica that answers before the network has been asked. The
 * geometry is drawn on a 40×40 grid so every coordinate is a whole or half pixel at 20px,
 * the size it is used at most:
 *
 *   - the star's points reach r=15.5 and its waist is pulled to r≈4.5 by control points
 *     3.2 off centre, which is what makes the points read as sharp rather than as a
 *     rounded plus sign;
 *   - the two vertical points are painted a second time at a different strength, so the
 *     star is faceted like a compass rose instead of being one flat silhouette;
 *   - four rays sit in the diagonal gaps, outside the waist and inside the bounding box;
 *   - the orbit is an ellipse rotated 24°, thin enough to stay a hairline at 20px.
 *
 * Everything is `currentColor` or `--accent`. There is not a hex value in the file, for
 * the same reason nothing else in components/ has one: a theme is a list of declarations,
 * not a fork.
 *
 * ## The entrance, and why it is scripted rather than a fade
 *
 * The whole animation is CSS on mount, in one timeline of about 1.9 seconds:
 *
 *   60ms   the orbit draws itself round, stroke-dashoffset from its own circumference
 *   140ms  the star arrives — rotate(-140°) scale(0.2) unwinding on --ease-out
 *   420ms  the four rays burst outward, 60ms apart
 *   380ms  the wordmark's letters rise and un-blur, 38ms apart, each starting further
 *          right than the last so the word pulls its own tracking in as it lands
 *   560ms  the core flashes
 *   900ms  a specular crosses the star, clipped to it
 *
 * The tracking collapse is the load-bearing part. Letters that merely fade in look like a
 * page that has not finished loading; letters that start wide and pull together look like
 * a mark assembling itself, which is the same trick every aerospace logo animation is
 * doing and the reason they read as engineered rather than decorated. It is written as a
 * per-letter transform rather than an animated `letter-spacing`, because the header logo
 * sits immediately before a `flex: 1` nav and a word that changed width for a second
 * would drag the whole navigation sideways on load. See Logo.module.css.
 *
 * `prefers-reduced-motion: reduce` removes all of it — not slowed, removed — and the mark
 * is painted in its finished state. Nothing here is the only thing making the logo
 * visible, so a browser that ran none of these rules would still show the finished lockup.
 *
 * ## Hover
 *
 * The star turns 90° and its rays extend; the glint runs again. It is on `:hover` of the
 * lockup and on `:focus-visible` of whatever wraps it, because the header logo is a link
 * and a keyboard user should get the same acknowledgement a pointer does.
 *
 * ## Why the accessible name is a second, hidden copy of the word
 *
 * The visible word is one `<span>` per letter, which is what lets each letter carry its
 * own delay. Some screen readers spell a run of inline-block single-character elements
 * out loud — "P, O, L, A, R, I, S" — so the drawn word is `aria-hidden` and the name comes
 * from one ordinary text node beside it. The DOM says "Polaris" exactly once either way.
 */

import { type CSSProperties, useId } from 'react';

import styles from './Logo.module.css';

export type LogoSize = 'sm' | 'md' | 'lg';

export interface LogoProps {
  /** `sm` (20px mark) for headers, `md` (24px) for cards, `lg` (30px) for a footer. */
  size?: LogoSize;
  /** Drop the word and render the mark alone — for a favicon-sized slot or a tight bar. */
  markOnly?: boolean;
  className?: string | undefined;
}

/** The star silhouette. Also the clip the specular sweeps inside, so it is declared once. */
const STAR = 'M20 4.5Q23.2 16.8 35.5 20 23.2 23.2 20 35.5 16.8 23.2 4.5 20 16.8 16.8 20 4.5Z';
/** The two vertical points on their own, painted over the star to facet it. */
const FACET =
  'M20 4.5Q23.2 16.8 20 20 16.8 16.8 20 4.5ZM20 35.5Q23.2 23.2 20 20 16.8 23.2 20 35.5Z';

/**
 * The four diagonal rays, as [x1, y1, x2, y2] on the 40×40 grid: r=8.5 out to r=13.5 at
 * 45°, 135°, 225° and 315°, which is the empty quarter between two of the star's points.
 */
const RAYS: readonly [number, number, number, number][] = [
  [26.01, 13.99, 29.55, 10.45],
  [13.99, 13.99, 10.45, 10.45],
  [13.99, 26.01, 10.45, 29.55],
  [26.01, 26.01, 29.55, 29.55],
];

const WORD = 'Polaris';

/** Stagger index, read by the stylesheet as `calc(var(--i) * <step>)` on a delay. */
function at(index: number): CSSProperties {
  return { '--i': index } as CSSProperties;
}

export function Logo({ size = 'sm', markOnly = false, className }: LogoProps) {
  // Two lockups on one page — the header's and the footer's — would otherwise declare the
  // same gradient and clip ids twice, and a duplicate id in SVG is not a warning: the
  // second `url(#…)` silently resolves to the first element.
  //
  // The strip is not cosmetic. `useId` is free to return delimiters — React has shipped
  // both `:r0:` and `«r0»` — and neither survives being interpolated into a `url(#…)`
  // fragment, which would leave the star with no fill at all.
  const id = `logo${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <span
      className={[styles.root, styles[size], className].filter(Boolean).join(' ')}
      data-size={size}
    >
      <LogoMark id={id} />
      {markOnly ? null : (
        <>
          <span className={styles.word} aria-hidden="true">
            {[...WORD].map((letter, index) => (
              // Index as key: the word is one immutable constant, so a letter's position
              // in it is its identity. "Polaris" has no stable per-letter id either way.
              <span key={index} className={styles.letter} style={at(index)}>
                {letter}
              </span>
            ))}
          </span>
          <span className={styles.name}>{WORD}</span>
        </>
      )}
    </span>
  );
}

function LogoMark({ id }: { id: string }) {
  const gradient = `${id}-star`;
  const clip = `${id}-clip`;

  return (
    <svg className={styles.mark} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <defs>
        {/*
          The facet needs two strengths of one colour rather than two colours, so the
          gradient runs from the accent to a fainter version of it. `color-mix` is not
          available inside a stop, but stop-opacity is — same result, one value.
        */}
        <linearGradient id={gradient} x1="14" y1="2" x2="28" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="currentColor" stopOpacity="1" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.62" />
        </linearGradient>
        <clipPath id={clip}>
          <path d={STAR} />
        </clipPath>
      </defs>

      {/* The orbit turns on its own, forever and very slowly. It is a separate group from
          the star because the star's hover rotation would otherwise cancel it. */}
      <g className={styles.orbit}>
        <ellipse
          className={styles.ring}
          cx="20"
          cy="20"
          rx="17.5"
          ry="6.8"
          transform="rotate(-24 20 20)"
        />
      </g>

      <g className={styles.star}>
        {RAYS.map(([x1, y1, x2, y2], index) => (
          <line
            key={index}
            className={styles.ray}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            style={at(index)}
          />
        ))}
        <path className={styles.body} d={STAR} fill={`url(#${gradient})`} />
        <path className={styles.facet} d={FACET} />
        <circle className={styles.core} cx="20" cy="20" r="1.7" />
        {/*
          The specular, and the only element here that exists purely to be animated.

          Three nested groups rather than one rect with two transforms: a CSS `transform`
          replaces an element's `transform` attribute outright rather than composing with
          it, so a rect that carried both its tilt and its sweep would snap upright the
          instant the animation began. The clip stays on the outer group, which must not
          rotate with the bar, and the tilt on the inner one.
        */}
        <g clipPath={`url(#${clip})`}>
          <g transform="rotate(24 20 20)">
            <rect className={styles.glint} x="6" y="-8" width="5" height="56" />
          </g>
        </g>
      </g>
    </svg>
  );
}
