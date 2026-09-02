/**
 * The queries this reader has already asked, kept per workspace.
 *
 * Search is the one screen somebody arrives at with a half-remembered question, and the
 * expensive part of it is not the scan — it is retyping "customer import timeout" for the
 * third time this week. A list of what was asked before is the cheapest possible answer to
 * that, and it is the only durable thing this screen has.
 *
 * `localStorage`, not the replica: what somebody typed into a search box is a fact about
 * one browser rather than about the workspace, it has no server representation to sync
 * against, and putting it in the outbox would replicate a person's search history to every
 * device they own — which is a product decision nobody has taken. Scoped by workspace for
 * the reason the outbox journal is: the queries that make sense in one are noise in another.
 *
 * Every touch is wrapped, and not out of habit: the `localStorage` property access itself
 * throws a SecurityError in a sandboxed iframe and in Safari's private mode, before any
 * method is called. Failing degrades to a screen with no recent list, which is exactly what
 * this screen was before — a convenience must never be able to break the search box.
 */

/**
 * How many queries are kept.
 *
 * Short on purpose. The list sits above the recent-work rows and competes with them for the
 * top of an empty screen, and a search somebody ran eleven queries ago is one they will type
 * again faster than they will find it in a wall of chips.
 */
export const RECENT_SEARCH_LIMIT = 6;

/** A cap on one entry, so a pasted essay cannot fill the origin's quota on its own. */
const MAX_QUERY_LENGTH = 200;

function keyFor(workspaceId: string): string {
  return `polaris.recentSearches/${workspaceId}`;
}

/** What this browser remembers, newest first. Empty when there is no workspace to key on. */
export function readRecentSearches(workspaceId: string | null): readonly string[] {
  if (workspaceId === null) return [];
  try {
    const raw = globalThis.localStorage?.getItem(keyFor(workspaceId));
    if (raw === null || raw === undefined) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string' && entry !== '');
  } catch {
    // Unreadable and absent are the same answer: a half-written value came from a build that
    // is no longer running, and there is nothing to recover from a string that will not parse.
    return [];
  }
}

/**
 * Records a query and returns the list as it now stands.
 *
 * Returned rather than re-read because the caller renders it, and a second `getItem` to
 * learn the result of a write it just made is a parse the main thread does not need.
 *
 * The prefix rule is what makes the list readable at all. A query is typed a character at a
 * time and every keystroke that settles is a query this screen answered, so recording each
 * of them verbatim would fill six slots with the six ways somebody spelled one search —
 * "cus", "custo", "customer imp", and so on. An entry the new query begins with is therefore
 * replaced by it rather than kept beside it: refining a search leaves one entry, and asking
 * a genuinely different question adds one.
 */
export function rememberSearch(workspaceId: string | null, query: string): readonly string[] {
  const asked = query.trim();
  if (workspaceId === null || asked === '' || asked.length > MAX_QUERY_LENGTH) {
    return readRecentSearches(workspaceId);
  }

  const kept = readRecentSearches(workspaceId).filter((entry) => !asked.startsWith(entry));
  const next = [asked, ...kept].slice(0, RECENT_SEARCH_LIMIT);

  try {
    globalThis.localStorage?.setItem(keyFor(workspaceId), JSON.stringify(next));
  } catch {
    // Quota, or a storage the browser will not hand over. The list is still right for this
    // session; it simply will not outlive the tab.
  }
  return next;
}

/** Forgets everything this browser remembers about what was searched for here. */
export function clearRecentSearches(workspaceId: string | null): void {
  if (workspaceId === null) return;
  try {
    globalThis.localStorage?.removeItem(keyFor(workspaceId));
  } catch {
    // Nothing to do and nothing to say: the list this cannot remove is one the next read
    // will still return, and the button that called this is the only way to try again.
  }
}
