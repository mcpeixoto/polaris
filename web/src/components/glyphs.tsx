/**
 * The line icons the component library itself draws.
 *
 * A primitive may not reach into `~/features` — components are presentation and features
 * are the product — so the chevron a breadcrumb and a section header need cannot come from
 * `features/issue/glyphs.tsx`, which is where the issue screens keep theirs. It is drawn
 * again here rather than the boundary being bent, and to the same recipe: a 16-unit box at a
 * 1.5 stroke so one `width`/`height` on the caller sizes them alike, `currentColor` so the
 * surrounding text colour paints them, and `aria-hidden` because the control or the row they
 * sit in is what carries the name.
 *
 * Kept deliberately small. This is not the product's icon set; it holds only what a
 * primitive in this folder draws for itself.
 */

import type { ReactNode, SVGProps } from 'react';

export type GlyphProps = Omit<SVGProps<SVGSVGElement>, 'children'>;

function Glyph({ children, ...rest }: GlyphProps & { children: ReactNode }) {
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

/** A right-pointing chevron: the breadcrumb's separator, and the section's fold mark. */
export function ChevronGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </Glyph>
  );
}
