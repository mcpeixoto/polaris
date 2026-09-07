/**
 * The row of sections a detail or list screen is divided into: Overview / Issues /
 * Activity, Active / Backlog, Issues / Projects.
 *
 * Two kinds of tab exist in this product and they are not interchangeable. A tab that is a
 * URL is a `NavLink`: the section is a place, it can be linked to and reloaded, and the
 * active mark comes from the router rather than from state a component keeps. A tab that
 * only changes what is on screen is a `button` in a `tablist`, which is the only shape a
 * screen reader announces as "tab, 2 of 3". Building the second where the first was meant
 * is how a section stops being linkable; building the first where the second was meant is
 * how the back button starts undoing a filter. A row is one kind or the other — every item
 * carries a `to`, or the row is a `tablist` — because a `tablist` with a link in it is
 * neither thing, and half a row that survives a reload is worse than none of it.
 *
 * Arrow-key roving is deliberately absent. The keyboard belongs to the registry (see
 * web/src/keys), a local handler here would be invisible to the command menu and the help
 * overlay, and every tab is reachable by Tab because every tab is a real control.
 */

import { Fragment, type ReactNode } from 'react';
import { NavLink } from 'react-router';

import styles from './Tabs.module.css';

export interface TabItem {
  /** Distinguishes the tab in `value`/`onSelect`, and keys the row. */
  id: string;
  label: ReactNode;
  /** The section's URL. Present makes this a link tab; absent makes it a button tab. */
  to?: string | undefined;
  /** Matches the path exactly, for the tab that is the section's own index. */
  end?: boolean | undefined;
  /** A count or a dot after the label — decorative, the label is the name. */
  detail?: ReactNode | undefined;
  /**
   * Draws this position in the row itself, instead of a tab.
   *
   * For the row that holds tabs a `TabItem` cannot describe: the project's attached views
   * are links that also drag to reorder and open a context menu, and they belong in the same
   * `<nav>` as Overview and Issues rather than in a second row beside it — one row of
   * sections is one landmark, whatever a given section can do. Everything drawn this way
   * still supplies its own class and its own accessible name.
   */
  render?: (() => ReactNode) | undefined;
}

export interface TabsProps {
  items: readonly TabItem[];
  /** Names the row; a screen with two tab rows needs to say which is which. */
  'aria-label': string;
  /** The selected tab's id. Ignored by link tabs, which the router marks instead. */
  value?: string | undefined;
  onSelect?: ((id: string) => void) | undefined;
  className?: string | undefined;
}

export function Tabs({ items, 'aria-label': label, value, onSelect, className }: TabsProps) {
  const drawn = items.filter((item) => item.render === undefined);
  const linked = drawn.length > 0 && drawn.every((item) => item.to !== undefined);
  const rowClass = [styles.tabs, className].filter(Boolean).join(' ');

  const body = (item: TabItem) => (
    <>
      <span>{item.label}</span>
      {item.detail === undefined ? null : <span className={styles.detail}>{item.detail}</span>}
    </>
  );

  if (linked) {
    return (
      <nav className={rowClass} aria-label={label}>
        {items.map((item) =>
          item.render === undefined ? (
            <NavLink
              key={item.id}
              to={item.to as string}
              end={item.end}
              className={({ isActive }) =>
                [styles.tab, isActive ? styles.active : null].filter(Boolean).join(' ')
              }
            >
              {body(item)}
            </NavLink>
          ) : (
            <Fragment key={item.id}>{item.render()}</Fragment>
          ),
        )}
      </nav>
    );
  }

  return (
    <div className={rowClass} role="tablist" aria-label={label}>
      {items.map((item) => {
        if (item.render !== undefined) return <Fragment key={item.id}>{item.render()}</Fragment>;
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            // The unselected tabs stay in the tab order rather than being roved between,
            // because roving needs the arrow handler this component is not allowed to own.
            className={[styles.tab, selected ? styles.active : null].filter(Boolean).join(' ')}
            onClick={() => onSelect?.(item.id)}
          >
            {body(item)}
          </button>
        );
      })}
    </div>
  );
}
