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
