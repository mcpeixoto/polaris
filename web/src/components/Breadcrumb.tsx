/**
 * Where you are, as a trail: "Projects › Apollo", "ENG › ENG-214".
 *
 * Every detail screen in the product needs one and, before this, every detail screen had
 * built its own — one with `<nav aria-label="Breadcrumb">` and a real `aria-current`, one
 * with a bare `<div>` and a `›` typed into the markup. The difference does not show in a
 * screenshot and shows immediately in a screen reader, which is the case for a primitive.
 *
 * The last crumb is the page you are on, so it is never a link: it is marked
 * `aria-current="page"` and rendered as text. A link to here is a link that does nothing,
 * and a trail whose final step is clickable reads as though there is somewhere further to
 * go. Every earlier crumb is a `Link` rather than a button, so it is announced as a link,
 * opens in a new tab on a middle click, and can be copied from the context menu.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { ChevronGlyph } from './glyphs';

import styles from './Breadcrumb.module.css';

export interface BreadcrumbItem {
  /** The crumb's text. Also its accessible name, so it says where it goes. */
  label: ReactNode;
  /** Where it goes. Absent on the last crumb, and on any step that is not a destination. */
  to?: string | undefined;
  /** A mark before the label — a project's emoji, a team's avatar. Decorative. */
  icon?: ReactNode | undefined;
}

export interface BreadcrumbProps {
  items: readonly BreadcrumbItem[];
  className?: string | undefined;
}

export function Breadcrumb({ items, className }: BreadcrumbProps) {
  return (
    <nav className={[styles.crumbs, className].filter(Boolean).join(' ')} aria-label="Breadcrumb">
      {items.map((item, index) => {
        const last = index === items.length - 1;
        const body = (
          <>
            {item.icon === undefined ? null : (
              <span className={styles.icon} aria-hidden="true">
                {item.icon}
              </span>
            )}
            <span className={styles.label}>{item.label}</span>
          </>
        );

        return (
          // The index is the key because a trail is positional: crumb two is "the second
          // step", and two steps may legitimately carry the same words.
          <span className={styles.step} key={index}>
            {index === 0 ? null : <ChevronGlyph className={styles.chevron} />}
            {last || item.to === undefined ? (
              <span
                className={last ? styles.current : styles.crumb}
                {...(last ? { 'aria-current': 'page' } : {})}
              >
                {body}
              </span>
            ) : (
              <Link className={styles.crumb} to={item.to}>
                {body}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
