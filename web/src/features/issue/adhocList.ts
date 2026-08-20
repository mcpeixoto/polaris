/**
 * Ad-hoc issue lists from a URL of identifiers.
 *
 * `/issues/ENG-123,ENG-456` is a shareable review list that is not a saved view and not a
 * label. The path is the whole state: parse it, resolve each identifier against the replica,
 * and the ordinary issue list takes over. Missing or malformed tokens drop out rather than
 * 404 — a link copied last week should still open the issues that still exist.
 */

import type { Store, UUID } from '~/store';

export function adhocListPath(identifiers: readonly string[]): string {
  return `/issues/${identifiers.join(',')}`;
}

/**
 * Splits a path segment into canonical identifiers (`ENG-123`), in URL order.
 *
 * Last-hyphen split, same rule as the API: a team key cannot contain a hyphen today, but
 * the last separator is the one that would still be right if that ever changed. Invalid
 * tokens and duplicates are skipped so a pasted list with a typo still opens the rest.
 */
export function parseAdhocIdentifiers(raw: string): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const piece of raw.split(',')) {
    const parsed = parseIssueIdentifier(piece);
    if (parsed === null) continue;
    const identifier = `${parsed.key}-${parsed.number}`;
    if (seen.has(identifier)) continue;
    seen.add(identifier);
    out.push(identifier);
  }
  return out;
}

export function parseIssueIdentifier(raw: string): { key: string; number: number } | null {
  const trimmed = raw.trim();
  const sep = trimmed.lastIndexOf('-');
  if (sep <= 0 || sep === trimmed.length - 1) return null;
  const key = trimmed.slice(0, sep).toUpperCase();
  const digits = trimmed.slice(sep + 1);
  if (!/^[1-9]\d*$/.test(digits)) return null;
  const number = Number.parseInt(digits, 10);
  for (const code of key) {
    const ok = (code >= 'A' && code <= 'Z') || (code >= '0' && code <= '9');
    if (!ok) return null;
  }
  return { key, number };
}

/** The issues named in the URL, in that order, skipping ones this replica does not hold. */
export function issueIdsForAdhocList(store: Store, identifiers: readonly string[]): UUID[] {
  const byIdentifier = new Map<string, UUID>();
  for (const issue of store.issues.values()) {
    byIdentifier.set(store.identifierOf(issue).toUpperCase(), issue.id);
  }
  const ids: UUID[] = [];
  const seen = new Set<UUID>();
  for (const identifier of identifiers) {
    const id = byIdentifier.get(identifier.toUpperCase());
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function adhocListTitle(identifiers: readonly string[]): string {
  if (identifiers.length === 0) return 'Issues';
  if (identifiers.length <= 4) return identifiers.join(', ');
  return `${identifiers.length} issues`;
}
