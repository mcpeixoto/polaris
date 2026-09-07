/**
 * Where a screen's folded groups are remembered.
 *
 * In `localStorage` rather than in the display options, and that is a line rather than a
 * shortcut. Everything in the display options is *shared*: it rides in the URL so a filtered
 * view is a link somebody can paste, and it is what a saved view hands the next reader. A
 * collapsed group is neither — it is where one person has folded away work they are not
 * looking at this afternoon, and putting it in the URL would mean sending a colleague a link
 * that opens with half the screen hidden and no hint why.
 *
 * Keyed by the `preferenceKey` the remembered display options already use, so "the ENG issue
 * list" and "my issues" fold independently, and so a screen with no key — the ad-hoc list,
 * whose identity is the identifiers in its own URL — remembers nothing at all rather than
 * sharing one anonymous bucket with every other keyless screen.
 *
 * These three lived inside `views/IssueList.tsx`. They are here because every list screen
 * folds groups, and a second copy of the storage key is a second screen that silently forgets.
 */

/** The storage key for one screen, or null when the screen is not one that remembers. */
export function collapseStorageKey(preferenceKey: string | undefined): string | null {
  return preferenceKey === undefined ? null : `polaris.collapsedGroups:${preferenceKey}`;
}

export function readCollapsed(preferenceKey: string | undefined): ReadonlySet<string> {
  const key = collapseStorageKey(preferenceKey);
  if (key === null) return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [],
    );
  } catch {
    // A private window, a full quota, a row somebody hand-edited. None of them is worth
    // taking the list down for: an unreadable preference is the same as not having one.
    return new Set();
  }
}

export function writeCollapsed(
  preferenceKey: string | undefined,
  groups: ReadonlySet<string>,
): void {
  const key = collapseStorageKey(preferenceKey);
  if (key === null) return;
  try {
    if (groups.size === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify([...groups]));
  } catch {
    // See `readCollapsed`. A group that does not stay folded is a smaller problem than a
    // screen that will not render.
  }
}
