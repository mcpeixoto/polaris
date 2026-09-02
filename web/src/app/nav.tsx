/**
 * The pieces both sidebars are built out of.
 *
 * `AppShell` drew all of this privately while there was one navigation to draw. There are
 * two now — the workspace one and the settings one — and a glyph set or an active-row rule
 * that exists twice is a glyph set or an active-row rule that will eventually disagree with
 * itself. Neither sidebar imports the other, which is the other half of the reason this is
 * a module of its own: `AppShell` renders `SettingsNav`, so anything `SettingsNav` needed
 * back from `AppShell` would close a cycle.
 */

import { useCallback, useState, type ReactNode } from 'react';

import styles from './nav.module.css';

export { styles as navStyles };

// CSS-module lookups are `string | undefined` under noUncheckedIndexedAccess, so classes
// are composed by filtering rather than by interpolation — a missing class should drop
// out, not render the literal "undefined" into the DOM.
export function navClass({ isActive }: { isActive: boolean }): string {
  return [styles.navItem, isActive ? styles.navItemActive : null].filter(Boolean).join(' ');
}

export type NavGlyphName =
  | 'back'
  | 'issues'
  | 'inbox'
  | 'pulse'
  | 'drafts'
  | 'search'
  | 'project'
  | 'initiative'
  | 'customer'
  | 'dashboard'
  | 'cycle'
  | 'view'
  | 'members'
  | 'labels'
  | 'bell'
  | 'template'
  | 'key'
  | 'apps'
  | 'webhook'
  | 'github'
  | 'gitlab'
  | 'sentry'
  | 'slack'
  | 'export'
  | 'prefs'
  | 'trash';

export function NavGlyph({ name }: { name: NavGlyphName }) {
  return (
    <svg
      className={styles.navIcon}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      {glyphPath(name)}
    </svg>
  );
}

function glyphPath(name: NavGlyphName) {
  const stroke = {
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'back':
      return <path d="M9.5 3.5 5 8l4.5 4.5" {...stroke} />;
    case 'issues':
      return (
        <>
          <rect x="2.5" y="2.5" width="11" height="11" rx="2" {...stroke} />
          <path d="M5 8h6M5 10.5h3.5" {...stroke} />
        </>
      );
    case 'inbox':
      return (
        <>
          <path
            d="M2.5 8.5 4.2 3.8A1.5 1.5 0 0 1 5.6 3h4.8a1.5 1.5 0 0 1 1.4.8L13.5 8.5"
            {...stroke}
          />
          <path
            d="M2.5 8.5h2.6l.8 1.8h4.2l.8-1.8h2.6V12a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 2.5 12V8.5Z"
            {...stroke}
          />
        </>
      );
    case 'pulse':
      return (
        <>
          <path d="M2.5 8h2.2l1.3-3.5 2.2 7 1.6-4.2H13.5" {...stroke} />
        </>
      );
    case 'search':
      return (
        <>
          <circle cx="7" cy="7" r="3.75" {...stroke} />
          <path d="m10.2 10.2 3 3" {...stroke} />
        </>
      );
    case 'project':
      return (
        <>
          <path d="M8 2.5 13.5 6v4L8 13.5 2.5 10V6L8 2.5Z" {...stroke} />
          <path d="M8 8v5.5M2.5 6 8 8l5.5-2" {...stroke} />
        </>
      );
    case 'initiative':
      return (
        <>
          <circle cx="8" cy="8" r="5.25" {...stroke} />
          <circle cx="8" cy="8" r="2" {...stroke} />
          <path d="M8 2.75v2M8 11.25v2M2.75 8h2M11.25 8h2" {...stroke} />
        </>
      );
    case 'customer':
      return (
        <>
          <rect x="2.5" y="4.5" width="11" height="9" rx="1.5" {...stroke} />
          <path d="M5.5 4.5V3.5A2.5 2.5 0 0 1 10.5 3.5V4.5M6 9.5h4" {...stroke} />
        </>
      );
    case 'dashboard':
      return (
        <>
          <rect x="2.5" y="2.5" width="4.75" height="4.75" rx="0.75" {...stroke} />
          <rect x="8.75" y="2.5" width="4.75" height="4.75" rx="0.75" {...stroke} />
          <rect x="2.5" y="8.75" width="4.75" height="4.75" rx="0.75" {...stroke} />
          <rect x="8.75" y="8.75" width="4.75" height="4.75" rx="0.75" {...stroke} />
        </>
      );
    case 'cycle':
      return (
        <>
          <circle cx="8" cy="8" r="5.25" {...stroke} />
          <path d="M8 5.25V8l2 1.5" {...stroke} />
        </>
      );
    case 'drafts':
      return (
        <>
          <path
            d="M4.5 2.5h5.2L13.5 6.3V13a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3.5 13V4A1.5 1.5 0 0 1 4.5 2.5Z"
            {...stroke}
          />
          <path d="M9.5 2.5V6h3.5M6 9h4M6 11.5h2.5" {...stroke} />
        </>
      );
    case 'view':
      return (
        <>
          <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7" {...stroke} />
        </>
      );
    case 'members':
      return (
        <>
          <circle cx="6" cy="5.5" r="2" {...stroke} />
          <path d="M3 12.5c.2-2 1.6-3 3-3s2.8 1 3 3" {...stroke} />
          <circle cx="11" cy="6" r="1.5" {...stroke} />
          <path d="M10.2 12.5c.15-1.4 1-2.2 2-2.2" {...stroke} />
        </>
      );
    case 'labels':
      return (
        <>
          <path
            d="M2.5 8.2 8.2 2.5h4.3A1 1 0 0 1 13.5 3.5v4.3L7.8 13.5a1 1 0 0 1-1.4 0L2.5 9.6a1 1 0 0 1 0-1.4Z"
            {...stroke}
          />
          <circle cx="10.2" cy="5.8" r="0.9" fill="currentColor" />
        </>
      );
    case 'bell':
      return (
        <>
          <path d="M4 10.5V8a4 4 0 0 1 8 0v2.5l1 1.5H3l1-1.5Z" {...stroke} />
          <path d="M6.5 12.5a1.5 1.5 0 0 0 3 0" {...stroke} />
        </>
      );
    case 'template':
      return (
        <>
          <rect x="3" y="2.5" width="10" height="11" rx="1.5" {...stroke} />
          <path d="M6 6h4M6 8.5h4M6 11h2" {...stroke} />
        </>
      );
    case 'key':
      return (
        <>
          <circle cx="6" cy="8" r="2.5" {...stroke} />
          <path d="M8.2 8H14v2.2M11.5 8v2.2" {...stroke} />
        </>
      );
    case 'apps':
      return (
        <>
          <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" {...stroke} />
          <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" {...stroke} />
          <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" {...stroke} />
          <rect x="9" y="9" width="4.5" height="4.5" rx="1" {...stroke} />
        </>
      );
    case 'webhook':
      return (
        <>
          <circle cx="4.5" cy="8" r="2" {...stroke} />
          <path d="M6.5 8h3" {...stroke} />
          <path d="M9.5 5.5 12 8l-2.5 2.5" {...stroke} />
        </>
      );
    case 'github':
      return (
        <>
          <path d="M8 2.5v7" {...stroke} />
          <path d="M5 6.5 8 9.5l3-3" {...stroke} />
          <path d="M4.5 12.5h7" {...stroke} />
        </>
      );
    case 'gitlab':
      return (
        <>
          <path d="M2.5 10.5 5 4.5 8 10.5 11 4.5 13.5 10.5 8 13.5Z" {...stroke} />
        </>
      );
    case 'sentry':
      return (
        <>
          <circle cx="8" cy="8" r="5.25" {...stroke} />
          <path d="M8 5.25V8.75M8 11v.01" {...stroke} />
        </>
      );
    case 'slack':
      return (
        <>
          <path d="M3.5 5.5h3v3h-3zM9.5 5.5h3v3h-3zM3.5 9.5h3v3h-3zM9.5 9.5h3v3h-3z" {...stroke} />
        </>
      );
    case 'export':
      return (
        <>
          <path d="M8 3.5v6.5M5.5 7.5 8 10l2.5-2.5" {...stroke} />
          <path d="M3.5 12.5h9" {...stroke} />
        </>
      );
    case 'prefs':
      return (
        <>
          <circle cx="5.5" cy="5" r="1.25" {...stroke} />
          <path d="M3 5h1.2M6.8 5H13" {...stroke} />
          <circle cx="10.5" cy="11" r="1.25" {...stroke} />
          <path d="M3 11h6.2M11.8 11H13" {...stroke} />
        </>
      );
    case 'trash':
      return (
        <>
          <path
            d="M3.5 5h9M6 5V3.5h4V5M5 5l.6 7.2A1 1 0 0 0 6.6 13h2.8a1 1 0 0 0 1-.8L11 5"
            {...stroke}
          />
        </>
      );
  }
}

/**
 * A section that opens and closes, with its open state remembered.
 *
 * Linear's sidebar is four or five blocks and every one of them collapses, which is what
 * keeps a workspace with nine teams and thirty favourites from being a column nobody can
 * see the bottom of. Ours drew all of them permanently expanded.
 *
 * The header is a button rather than a heading, and that is a deliberate loss. A heading is
 * a landmark in the document outline, and `SettingsNav` keeps its `h2`s for exactly that
 * reason — those name groups that are always there. These name a control, `aria-expanded`
 * says what it does, and the region below is named by the button through `aria-labelledby`,
 * so nothing is left unnamed by the trade.
 *
 * Closed means unmounted rather than hidden. The rows are `NavLink`s, and a hidden link is
 * still a tab stop, still a `getByRole('link')`, and still a thing a screen reader walks
 * past — a section somebody closed to make the sidebar shorter should be shorter for them
 * too.
 */
export function NavSection({
  id,
  title,
  open,
  onToggle,
  action,
  children,
}: {
  /** Stable, and the id the persisted flag is stored under. */
  id: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  /** A control belonging to the section rather than to a row in it — "New folder". */
  action?: ReactNode;
  children: ReactNode;
}) {
  const headerId = `nav-section-${id}`;
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <button
          type="button"
          id={headerId}
          className={styles.sectionToggle}
          aria-expanded={open}
          onClick={onToggle}
        >
          <NavChevron open={open} />
          {title}
        </button>
        {action}
      </div>
      {open ? (
        <div role="group" aria-labelledby={headerId} className={styles.section}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** The disclosure arrow. Smaller than a NavGlyph, because it marks a row rather than names one. */
export function NavChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={[styles.chevron, open ? styles.chevronOpen : null].filter(Boolean).join(' ')}
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2.5 4 5 6.5 7.5 4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The square beside the workspace name: its logo if it has one, its initial otherwise.
 *
 * The letter is not a placeholder waiting for an upload — most workspaces never set a logo,
 * and it is what Settings → Workspace promises is kept when the field is blank. Which makes
 * the image the exception, and the fallback the thing that has to be right: a URL that
 * 404s, or one that pointed at an image somebody has since deleted, falls back to the letter
 * rather than leaving a broken-image glyph in the corner of every screen.
 *
 * Keyed by url rather than by a boolean, as `Avatar` is, so replacing a broken logo with a
 * working one is not ignored for the rest of the session.
 */
export function WorkspaceMark({ name, logoUrl }: { name: string; logoUrl?: string | undefined }) {
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const usable = logoUrl !== undefined && logoUrl !== '' && logoUrl !== brokenSrc;

  return (
    <span className={styles.workspaceMark} aria-hidden="true">
      {usable ? (
        // Empty alt, and the wrapper is already hidden: the workspace's name is written
        // immediately beside this, and naming it twice helps nobody.
        <img
          className={styles.workspaceLogo}
          src={logoUrl}
          alt=""
          onError={() => setBrokenSrc(logoUrl)}
        />
      ) : (
        [...name][0]?.toUpperCase()
      )}
    </span>
  );
}

/**
 * Everything the sidebar remembers between sittings, under one key.
 *
 * One key rather than one per section, because these are all answers to the same question —
 * what shape did this person leave their sidebar in — and a dozen `polaris.sidebar.teams.…`
 * entries is a schema nobody can migrate and a quota nobody can reason about.
 *
 * Every read and every write is guarded. Safari's private mode throws on `localStorage`
 * outright, and so do sandboxed iframes; `Boot.tsx` makes the argument at length. Forgetting
 * which sections were open is a small annoyance, and refusing to render a navigation over it
 * is not.
 */
const SIDEBAR_KEY = 'polaris.sidebar';

/**
 * The default width, mirroring `--sidebar-width` in tokens.css.
 *
 * The stylesheet stays the source of truth: until somebody drags the handle nothing sets the
 * custom property at all, so the token — and the narrow-window rule that derives from it —
 * still governs. This number is only what the resize handle reports to assistive technology
 * and what a drag starts from before there is a stored width to start from.
 */
export const DEFAULT_SIDEBAR_WIDTH = 232;

/** Narrow enough to be worth doing, wide enough to still hold a glyph and a readable label. */
export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 420;

interface SidebarMemory {
  readonly collapsed?: boolean;
  readonly width?: number;
  /**
   * Explicit choices only, so a default can change without overriding what somebody decided.
   * A section absent from here has never been touched and answers to its own fallback —
   * which is open for the three top-level blocks and closed for a team's sub-navigation.
   */
  readonly sections?: Record<string, boolean>;
}

function readMemory(): SidebarMemory {
  try {
    const raw = localStorage.getItem(SIDEBAR_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as SidebarMemory) : {};
  } catch {
    // A throwing storage, or a value some earlier version wrote in another shape. Neither is
    // worth failing a render over.
    return {};
  }
}

function writeMemory(memory: SidebarMemory): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, JSON.stringify(memory));
  } catch {
    /* see readMemory */
  }
}

export interface SidebarChrome {
  readonly collapsed: boolean;
  /** `null` until somebody drags the handle, so the token keeps deciding until then. */
  readonly width: number | null;
  toggleCollapsed(): void;
  setWidth(width: number): void;
  /** Whether a section is open, given what it should be for somebody who never touched it. */
  isOpen(id: string, fallback: boolean): boolean;
  toggleSection(id: string, fallback: boolean): void;
}

export function useSidebarChrome(): SidebarChrome {
  const [memory, setMemory] = useState<SidebarMemory>(readMemory);

  const update = useCallback((change: (current: SidebarMemory) => SidebarMemory) => {
    setMemory((current) => {
      const next = change(current);
      writeMemory(next);
      return next;
    });
  }, []);

  const toggleCollapsed = useCallback(
    () => update((current) => ({ ...current, collapsed: current.collapsed !== true })),
    [update],
  );

  const setWidth = useCallback(
    (width: number) =>
      update((current) => ({
        ...current,
        width: Math.round(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width))),
      })),
    [update],
  );

  const isOpen = useCallback(
    (id: string, fallback: boolean) => memory.sections?.[id] ?? fallback,
    [memory],
  );

  const toggleSection = useCallback(
    (id: string, fallback: boolean) =>
      update((current) => ({
        ...current,
        sections: { ...current.sections, [id]: (current.sections?.[id] ?? fallback) === false },
      })),
    [update],
  );

  return {
    collapsed: memory.collapsed === true,
    width: memory.width ?? null,
    toggleCollapsed,
    setWidth,
    isOpen,
    toggleSection,
  };
}
