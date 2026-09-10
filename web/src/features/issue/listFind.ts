/**
 * In-view find for issue lists (`Cmd/Ctrl+F`).
 *
 * Temporary — local state, not the URL filter — and matches title or identifier only, the
 * same bargain as Linear's list find and the inbox's find box. Titles go through the
 * trigram index so a keystroke over five thousand issues stays under the filter budget;
 * identifiers are a substring check over the corpus, which is already the set the list is
 * looking at and is never large enough to need its own index.
 */

import { fold } from '~/store';
import type { Store, UUID } from '~/store';

/**
 * Which of `corpus` match the find query.
 *
 * `null` means the query is empty and every id should stay — callers treat that as "do not
 * filter" rather than as an empty set, so clearing the box is how you leave find.
 */
export function listFindHits(
  store: Store,
  corpus: ReadonlySet<UUID>,
  query: string,
): ReadonlySet<UUID> | null {
  const raw = query.trim();
  if (raw === '') return null;

  const byTitle = store.index.search(raw);
  const needle = fold(raw);
  const hits = new Set<UUID>();
  for (const id of corpus) {
    if (byTitle.has(id)) {
      hits.add(id);
      continue;
    }
    const issue = store.issues.get(id);
    if (issue === undefined) continue;
    if (fold(store.identifierOf(issue)).includes(needle)) hits.add(id);
  }
  return hits;
}
