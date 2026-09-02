/**
 * Command-menu ranking and scoped prefixes.
 *
 * The menu is still a view over the keymap registry. Prefixes are how the same box also
 * jumps to replica rows: `>` keeps the list on commands, `#` on issues, `@` on people.
 * Matching is the same subsequence score the unprefixed command list already used, so
 * "cri" still finds "Create issue" and "eng1" can still find ENG-1.
 */

import { parseIssueIdentifier } from '~/features/issue/adhocList';
import { personName } from '~/features/prefs/prefs';
import type { Action } from '~/keys';
import type { Store, UUID } from '~/store';
import { frecency, NO_RECENTS, type RecentUses } from './commandMenuRecents';

export type CommandScope = 'command' | 'issue' | 'user' | 'mixed';

export interface ParsedCommandQuery {
  readonly scope: CommandScope;
  readonly needle: string;
}

export interface EntityHit {
  readonly id: UUID;
  readonly title: string;
  readonly hint: string;
  readonly href: string;
  readonly score: number;
}

const ENTITY_LIMIT = 12;

export function parseCommandQuery(raw: string): ParsedCommandQuery {
  if (raw.startsWith('>')) return { scope: 'command', needle: raw.slice(1).trim() };
  if (raw.startsWith('#')) return { scope: 'issue', needle: raw.slice(1).trim() };
  if (raw.startsWith('@')) return { scope: 'user', needle: raw.slice(1).trim() };
  return { scope: 'mixed', needle: raw.trim() };
}

/**
 * How much a command's history is allowed to move it.
 *
 * A tie-breaker, not an override. `subsequenceScore` returns tens per matched word start, so
 * a frecency weight of at most a few units reorders commands the query scored equally — which
 * is the case that matters, since "st" matches a dozen things equally well — without ever
 * floating a worse match above a better one. A palette that answers with what you used last
 * instead of what you typed has stopped being a search box.
 */
const RECENCY_WEIGHT = 3;

export function rankActions(
  actions: readonly Action[],
  needle: string,
  recents: RecentUses = NO_RECENTS,
  now: number = Date.now(),
): Action[] {
  const q = needle.toLowerCase();
  const bias = (action: Action) => RECENCY_WEIGHT * frecency(recents, action.id, now);

  // An empty query is not a search, so nothing is scored: it is the list of everything this
  // screen can do, with what this person actually runs lifted to the top of it. It used to be
  // registration order, i.e. the order the source file happens to be written in.
  if (q === '') {
    return [...actions].sort((a, b) => bias(b) - bias(a));
  }

  const scored: Array<{ action: Action; score: number }> = [];
  for (const action of actions) {
    const haystack = `${action.group} ${action.title}`.toLowerCase();
    const score = subsequenceScore(haystack, q);
    if (score !== null) scored.push({ action, score: score + bias(action) });
  }
  scored.sort((a, b) => b.score - a.score || a.action.title.localeCompare(b.action.title));
  return scored.map((s) => s.action);
}

/**
 * One issue, reduced to the strings a search actually touches.
 *
 * The point of the type is what it does *not* hold: no issue row, no store reference, nothing
 * whose identity would keep a replaced row alive.
 */
export interface IssueSearchEntry {
  readonly id: UUID;
  readonly identifier: string;
  readonly title: string;
  /** Lowercased once, at index time, rather than once per issue per keystroke. */
  readonly haystack: string;
}

/**
 * Everything searchable, built once per change to the issues or the teams.
 *
 * The palette used to walk the entire replica on every character: `store.issues.values()`,
 * `store.identifierOf(issue)` — a team lookup and a string build — and a `subsequenceScore`,
 * per issue, per keystroke. On a workspace with tens of thousands of issues that is the one
 * surface in the product that must never stutter, doing the most work in it. The identifier
 * and the lowercasing are the expensive halves and neither depends on what was typed, so
 * they move here and the keystroke is left with the scoring alone.
 *
 * Keyed by the caller on the `['issue', 'team']` query revision — teams because
 * `identifierOf` reads the team's key, so a renamed team invalidates every identifier.
 */
export function buildIssueIndex(store: Store): IssueSearchEntry[] {
  const entries: IssueSearchEntry[] = [];
  for (const issue of store.issues.values()) {
    if (issue.archivedAt !== undefined) continue;
    const identifier = store.identifierOf(issue);
    entries.push({
      id: issue.id,
      identifier,
      title: issue.title,
      haystack: `${identifier} ${issue.title}`.toLowerCase(),
    });
  }
  return entries;
}

/** Searches a prebuilt index. The hot path; see `buildIssueIndex`. */
export function searchIssueIndex(index: readonly IssueSearchEntry[], needle: string): EntityHit[] {
  const hits: EntityHit[] = [];
  const parsed = parseIssueIdentifier(needle.replace(/\s+/g, ''));
  const q = needle.toLowerCase();
  for (const entry of index) {
    let score = needle === '' ? 1 : subsequenceScore(entry.haystack, q);
    if (parsed !== null && entry.identifier.toUpperCase() === `${parsed.key}-${parsed.number}`) {
      score = (score ?? 0) + 1000;
    }
    if (score === null) continue;
    hits.push({
      id: entry.id,
      title: `${entry.identifier} ${entry.title}`,
      hint: entry.identifier,
      href: `/issue/${entry.identifier}`,
      score,
    });
  }
  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return hits.slice(0, ENTITY_LIMIT);
}

/**
 * The unindexed convenience, kept for callers that hold a store and search once.
 *
 * Not what the palette uses. Building the index and throwing it away is exactly the work
 * `buildIssueIndex` exists to hoist out of the keystroke.
 */
export function matchIssues(store: Store, needle: string): EntityHit[] {
  return searchIssueIndex(buildIssueIndex(store), needle);
}

export function matchUsers(store: Store, needle: string): EntityHit[] {
  const hits: EntityHit[] = [];
  for (const user of store.users.values()) {
    if (user.archivedAt !== undefined || user.kind !== 'human') continue;
    const name = personName(user);
    const score = needle === '' ? 1 : subsequenceScore(name.toLowerCase(), needle.toLowerCase());
    if (score === null) continue;
    hits.push({
      id: user.id,
      title: name,
      hint: user.displayName,
      href: `/user/${user.id}`,
      score,
    });
  }
  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return hits.slice(0, ENTITY_LIMIT);
}

/**
 * Subsequence matching, not substring: "cri" should find "Create issue". Scoring prefers
 * matches that start a word, so "issue" surfaces "Issue: change status" above "Archive issue".
 */
export function subsequenceScore(haystack: string, needle: string): number | null {
  if (needle === '') return 1;
  let score = 0;
  let h = 0;

  for (const ch of needle) {
    let found = -1;
    for (let i = h; i < haystack.length; i++) {
      if (haystack[i] === ch) {
        found = i;
        break;
      }
    }
    if (found === -1) return null;

    const atWordStart = found === 0 || haystack[found - 1] === ' ';
    score += atWordStart ? 10 : 1;
    if (found === h) score += 5;
    h = found + 1;
  }
  return score;
}
