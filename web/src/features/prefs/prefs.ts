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

function readBag(): Partial<Preferences> {
  try {
    const raw = globalThis.localStorage?.getItem(PREFS_STORAGE_KEY);
    if (raw === null || raw === undefined) return {};
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

export function getPrefs(): Preferences {
  const stored = readBag();
  return {
    theme: getStoredTheme(),
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
