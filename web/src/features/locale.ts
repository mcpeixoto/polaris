/**
 * The one place that decides what language the product speaks.
 *
 * This exists because of a bug that shipped in M0 and looked like nothing: every date in
 * the app went through `Intl` with an undefined locale, which means *the browser's*
 * locale. On a machine set to Portuguese, an entirely English interface rendered "há 20
 * minutos" beside "Updated by Ada". Half-translated is worse than untranslated — it reads
 * as a rendering fault rather than as a feature, and it is the kind of thing that makes
 * people distrust the rest of the page.
 *
 * So the rule is: `Intl` never gets `undefined`. It gets this, and this is the UI's own
 * language. When the interface is actually translated, this function starts returning the
 * user's chosen language and every date follows in the same commit — which is the point
 * of routing them all through one function now, before there are thirty call sites.
 */

/** The languages the interface itself is available in. English until that changes. */
const AVAILABLE = ['en'] as const;

export type UILocale = (typeof AVAILABLE)[number];

const DEFAULT: UILocale = 'en';

let current: UILocale = DEFAULT;

/**
 * The locale to hand to every `Intl` constructor.
 *
 * Deliberately not the browser's. A browser locale describes the reader's preference for
 * content that has been translated; it says nothing about whether this interface has been.
 */
export function uiLocale(): UILocale {
  return current;
}

/**
 * Sets the interface language, ignoring anything not actually available.
 *
 * Silently falling back rather than throwing: a stored preference for a language that was
 * removed, or a profile written by a newer build, must not stop the app from rendering.
 */
export function setUILocale(locale: string): UILocale {
  const match = AVAILABLE.find((l) => l === locale || locale.startsWith(`${l}-`));
  current = match ?? DEFAULT;
  return current;
}

/**
 * The timezone to reckon calendar days in.
 *
 * Separate from the language on purpose, and it is the browser's rather than the UI's:
 * someone reading an English interface in Lisbon still wants "today" to mean today in
 * Lisbon. It is a fact about where the reader is, not about what they read.
 *
 * The workspace's own timezone overrides it where a date belongs to the team rather than
 * to the reader — a due date is the team's Friday, not the reader's.
 */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    // Some locked-down environments throw here rather than returning a default, and a
    // clock that cannot name its own zone should still render dates.
    return 'UTC';
  }
}

const FALLBACK_ZONES = [
  'UTC',
  'Europe/Lisbon',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Asia/Tokyo',
] as const;

/**
 * IANA zones for a settings `<select>`.
 *
 * The browser's own list when it has one, so a person in `Atlantic/Madeira` can pick it
 * rather than the nearest city we remembered. The handful below is only for environments
 * that do not expose `Intl.supportedValuesOf`.
 */
export function listTimezones(): readonly string[] {
  try {
    const supported = Intl.supportedValuesOf?.('timeZone');
    if (supported !== undefined && supported.length > 0) return supported;
  } catch {
    // Same bargain as browserTimezone: a clock that cannot list zones still has to render.
  }
  return FALLBACK_ZONES;
}
