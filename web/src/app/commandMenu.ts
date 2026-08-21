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

export function rankActions(actions: readonly Action[], needle: string): Action[] {
  const q = needle.toLowerCase();
  if (q === '') return [...actions];

  const scored: Array<{ action: Action; score: number }> = [];
  for (const action of actions) {
    const haystack = `${action.group} ${action.title}`.toLowerCase();
    const score = subsequenceScore(haystack, q);
    if (score !== null) scored.push({ action, score });
  }
  scored.sort((a, b) => b.score - a.score || a.action.title.localeCompare(b.action.title));
  return scored.map((s) => s.action);
}

export function matchIssues(store: Store, needle: string): EntityHit[] {
  const hits: EntityHit[] = [];
  const parsed = parseIssueIdentifier(needle.replace(/\s+/g, ''));
  for (const issue of store.issues.values()) {
    if (issue.archivedAt !== undefined) continue;
    const identifier = store.identifierOf(issue);
    const haystack = `${identifier} ${issue.title}`.toLowerCase();
    let score = needle === '' ? 1 : subsequenceScore(haystack, needle.toLowerCase());
    if (parsed !== null && identifier.toUpperCase() === `${parsed.key}-${parsed.number}`) {
      score = (score ?? 0) + 1000;
    }
    if (score === null) continue;
    hits.push({
      id: issue.id,
      title: `${identifier} ${issue.title}`,
      hint: identifier,
      href: `/issue/${identifier}`,
      score,
    });
  }
  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return hits.slice(0, ENTITY_LIMIT);
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
