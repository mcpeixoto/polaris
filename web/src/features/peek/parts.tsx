/**
 * The pieces both peeks are made of.
 *
 * Peek started as one panel for one kind of thing. A second one — the project under the
 * cursor on the project list — is the same panel with different facts in it: the same
 * stylesheet, the same presence, the same header with the same close button, the same rail
 * of label-and-value rows, and the same rule that a glance shows the first paragraph of a
 * description rather than the whole document.
 *
 * So the shared half lives here and each peek is left with what is actually specific to it:
 * which entity it reads and which facts it draws. What is deliberately *not* here is the
 * `<aside>` and its `usePresence` — each peek keeps those, because the live query that fills
 * it is gated on `present` and a shell that owned the hook could not hand that fact back.
 */

import type { ReactNode } from 'react';

import { IconButton } from '~/components';
import { CrossGlyph } from '~/features/issue/glyphs';

import styles from './Peek.module.css';

/**
 * The panel's top line: what this is, and the way out.
 *
 * The close button exists only when a caller supplies `onClose`, which is the same bargain
 * the issue peek struck: the list owns the open state, so the list owns the close, and a
 * panel rendered without one is a panel Escape is the only exit from.
 */
export function PeekHeader({
  eyebrow,
  onClose,
}: {
  eyebrow: ReactNode;
  onClose?: (() => void) | undefined;
}) {
  return (
    <header className={styles.header}>
      <span className={styles.identifier}>{eyebrow}</span>
      {onClose === undefined ? null : (
        <IconButton
          aria-label="Close peek"
          keys="Escape"
          size="sm"
          className={styles.close}
          onClick={onClose}
          icon={<CrossGlyph />}
        />
      )}
    </header>
  );
}

/**
 * One rail row. The label is for the accessibility tree, as it is on the issue screen: on
 * screen the glyph and the value are the row.
 */
export function Fact({
  label,
  wrap = false,
  children,
}: {
  label: string;
  wrap?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={styles.fact}>
      <dt className={styles.srOnly}>{label}</dt>
      <dd className={wrap ? styles.factWrap : undefined}>{children}</dd>
    </div>
  );
}

/** Peek is a glance: a novel in the description stays on the entity's own page. */
export function glanceDescription(raw: string, limit = 480): string {
  const collapsed = raw.trim().replace(/\n{3,}/g, '\n\n');
  if (collapsed.length <= limit) return collapsed;
  const cut = collapsed.slice(0, limit);
  const at = cut.lastIndexOf(' ');
  return `${(at > 80 ? cut.slice(0, at) : cut).trimEnd()}…`;
}
