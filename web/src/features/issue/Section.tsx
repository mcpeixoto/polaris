/**
 * A collapsible section on the issue screen: sub-issues, relations, links, customers.
 *
 * One component for the four so that the four headers are the same drawing — a chevron, the
 * name, a count, and a "+" at the trailing edge — rather than four that drift. The header is
 * the toggle: the whole title row folds the body, and the "+" beside it is whatever the
 * section adds. Folding is local state and is not remembered, because a section a person
 * folded on one issue is not a decision about the next one.
 *
 * The heading element wraps the toggle rather than the other way round, so the section's
 * accessible name — read off the `<h2>` by `aria-labelledby`, or by a heading query — is the
 * title alone. The count sits outside the heading for the same reason: "Sub-issues 3" is not
 * the name of anything.
 */

import { useId, useState, type ReactNode } from 'react';

import { ChevronGlyph } from './glyphs';
import styles from './Section.module.css';

export interface SectionProps {
  title: string;
  /** The heading's DOM id, for a caller whose region is named by it. */
  headingId?: string | undefined;
  /** The region's own name, when it is not the heading's text. */
  'aria-label'?: string | undefined;
  /** How many rows the body holds. Omitted rather than shown as zero. */
  count?: number | undefined;
  /** Extra content on the header row, between the count and the trailing action. */
  detail?: ReactNode;
  /** The trailing control: the section's "+". */
  action?: ReactNode;
  /** Whether the body starts open. Sections that hold something do; the default. */
  defaultOpen?: boolean | undefined;
  className?: string | undefined;
  children: ReactNode;
}

export function Section({
  title,
  headingId,
  'aria-label': ariaLabel,
  count,
  detail,
  action,
  defaultOpen = true,
  className,
  children,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const generated = useId();
  const bodyId = `${generated}-body`;
  const id = headingId ?? `${generated}-heading`;

  return (
    <section
      className={[styles.section, className].filter(Boolean).join(' ')}
      {...(ariaLabel === undefined ? { 'aria-labelledby': id } : { 'aria-label': ariaLabel })}
    >
      <div className={styles.head}>
        <h2 id={id} className={styles.title}>
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((current) => !current)}
          >
            <ChevronGlyph
              className={[styles.chevron, open ? styles.open : null].filter(Boolean).join(' ')}
            />
            <span>{title}</span>
          </button>
        </h2>
        {count === undefined ? null : <span className={styles.count}>{count}</span>}
        {detail}
        <div className={styles.spacer} />
        {action}
      </div>
      <div id={bodyId} className={styles.body} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
