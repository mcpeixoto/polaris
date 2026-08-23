/**
 * Account preferences that live on this device.
 *
 * Theme already had its own key; everything else that is "how I like the product to
 * behave" joins it here. Auto-assign, the comment submit key and the default home view
 * are decisions about *this* client, and storing them next to the theme means a laptop
 * that is not the one you usually use does not inherit a comment-submit habit it was
 * never taught.
 *
 * Saved drafts and workspace membership are the things that have to follow the account;
 * these do not.
 */

import { applyTheme, getStoredTheme, type ThemeName } from '~/styles/theme';

export type HomeView = 'team' | 'my-issues' | 'inbox' | 'drafts';
export type FontSize = 'small' | 'default' | 'large';
export type WeekStart = 'sunday' | 'monday';
export type CommentSubmit = 'mod-enter' | 'enter';

export interface Preferences {
  readonly theme: ThemeName;
  readonly homeView: HomeView;
  readonly fullNames: boolean;
  readonly weekStartsOn: WeekStart;
  readonly convertEmoticons: boolean;
  readonly commentSubmit: CommentSubmit;
  readonly fontSize: FontSize;
  readonly pointerCursor: boolean;
  readonly underlineLinks: boolean;
  readonly autoAssignOnCreate: boolean;
  readonly autoAssignOnStart: boolean;
}

export const PREFS_STORAGE_KEY = 'polaris.prefs';

const DEFAULTS: Omit<Preferences, 'theme'> = {
  homeView: 'team',
  fullNames: true,
  weekStartsOn: 'monday',
  convertEmoticons: false,
  commentSubmit: 'mod-enter',
  fontSize: 'default',
  pointerCursor: true,
  underlineLinks: false,
  autoAssignOnCreate: false,
  autoAssignOnStart: false,
};

const listeners = new Set<() => void>();

function readRaw(): string | null {
  try {
    return globalThis.localStorage?.getItem(PREFS_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function parseBag(raw: string | null): Partial<Preferences> {
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Partial<Preferences>;
  } catch {
    return {};
  }
}

function writeBag(prefs: Omit<Preferences, 'theme'>): void {
  try {
    globalThis.localStorage?.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Same bargain as theme: a preference is never worth failing boot over.
  }
}

/**
 * The last object `getPrefs` handed out, and the stored state it was built from.
 *
 * `getPrefs` is a `useSyncExternalStore` snapshot, and that hook compares snapshots by
 * reference. Building a fresh object on every call therefore reads as "the store changed"
 * on every commit: React re-renders, re-reads, sees another new object, and does it again
 * until it gives up with "Maximum update depth exceeded" — which is not a slow render but
 * a dead route, because the throw escapes past a Settings screen that has no error
 * boundary and takes the whole tree with it. `Preferences` was the one component
 * subscribing to the whole object rather than to one field of it, so `/settings/preferences`
 * rendered an empty page and every preference below was unreachable.
 *
 * Keyed on the raw stored string rather than invalidated by `setPrefs`, so a write from
 * another tab — or a test that pokes `localStorage` directly — still produces a new
 * snapshot rather than a stale one.
 */
let snapshot: Preferences | null = null;
let snapshotKey: string | null = null;

export function getPrefs(): Preferences {
  const raw = readRaw();
  const theme = getStoredTheme();
  const key = `${theme} ${raw ?? ''}`;
  if (snapshot !== null && snapshotKey === key) return snapshot;

  snapshot = buildPrefs(raw, theme);
  snapshotKey = key;
  return snapshot;
}

function buildPrefs(raw: string | null, theme: ThemeName): Preferences {
  const stored = parseBag(raw);
  return {
    theme,
    homeView: isHomeView(stored.homeView) ? stored.homeView : DEFAULTS.homeView,
    fullNames: typeof stored.fullNames === 'boolean' ? stored.fullNames : DEFAULTS.fullNames,
    weekStartsOn: stored.weekStartsOn === 'sunday' ? 'sunday' : DEFAULTS.weekStartsOn,
    convertEmoticons:
      typeof stored.convertEmoticons === 'boolean'
        ? stored.convertEmoticons
        : DEFAULTS.convertEmoticons,
    commentSubmit: stored.commentSubmit === 'enter' ? 'enter' : DEFAULTS.commentSubmit,
    fontSize: isFontSize(stored.fontSize) ? stored.fontSize : DEFAULTS.fontSize,
    pointerCursor:
      typeof stored.pointerCursor === 'boolean' ? stored.pointerCursor : DEFAULTS.pointerCursor,
    underlineLinks:
      typeof stored.underlineLinks === 'boolean' ? stored.underlineLinks : DEFAULTS.underlineLinks,
    autoAssignOnCreate:
      typeof stored.autoAssignOnCreate === 'boolean'
        ? stored.autoAssignOnCreate
        : DEFAULTS.autoAssignOnCreate,
    autoAssignOnStart:
      typeof stored.autoAssignOnStart === 'boolean'
        ? stored.autoAssignOnStart
        : DEFAULTS.autoAssignOnStart,
  };
}

export function setPrefs(patch: Partial<Preferences>): Preferences {
  const current = getPrefs();
  const next: Preferences = { ...current, ...patch };
  const { theme: _theme, ...rest } = next;
  writeBag(rest);
  if (patch.theme !== undefined) applyTheme(patch.theme);
  applyPrefs(next);
  for (const listener of listeners) listener();
  return next;
}

export function subscribePrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Puts the non-theme preferences on the document element so CSS can see them.
 *
 * Theme has its own attribute because the cascade has to resolve it before React boots;
 * these can wait for the module, but they still have to land as attributes rather than as
 * classes sprinkled through components, or a new screen will forget them.
 */
export function applyPrefs(prefs: Preferences = getPrefs()): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-font-size', prefs.fontSize);
  root.setAttribute('data-pointer', prefs.pointerCursor ? 'pointer' : 'default');
  root.setAttribute('data-underline-links', prefs.underlineLinks ? 'on' : 'off');
}

export function personName(
  user: { name: string; displayName: string },
  prefs: Preferences = getPrefs(),
): string {
  return prefs.fullNames ? user.displayName : user.name;
}

function isHomeView(value: unknown): value is HomeView {
  return value === 'team' || value === 'my-issues' || value === 'inbox' || value === 'drafts';
}

function isFontSize(value: unknown): value is FontSize {
  return value === 'small' || value === 'default' || value === 'large';
}
