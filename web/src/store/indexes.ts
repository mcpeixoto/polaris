import type { Issue, IssueLabel, IssueRelation, Notification, UUID } from './types';

/**
 * The secondary indexes every view reads through.
 *
 * The product's feel is decided here. A filtered, grouped, sorted issue list has to
 * re-render inside a frame, and a filter implemented as `[...issues.values()].filter(…)`
 * cannot: five thousand objects, five thousand property reads, five thousand closure
 * calls, per keystroke. These maps replace that scan with a set lookup and an
 * intersection over the smallest posting list, so the cost tracks the size of the
 * *answer* rather than the size of the workspace.
 *
 * They are maintained incrementally rather than rebuilt. A delta batch of fifty changes
 * arriving while a list is open must cost fifty small edits, not fifty full rebuilds —
 * and a full rebuild is O(n) in the workspace, which is exactly the number this file
 * exists to stop appearing on the hot path.
 */

const EMPTY: ReadonlySet<UUID> = new Set<UUID>();

/**
 * A one-to-many index: a key to the set of ids under it.
 *
 * Buckets are dropped when they empty. Left behind, they turn a long-lived session into
 * a slow leak — a workspace that has cycled through ten thousand assignees would keep
 * ten thousand empty sets alive — and they make `keys()` lie about what exists.
 */
export class SetIndex<K> {
  private readonly buckets = new Map<K, Set<UUID>>();

  add(key: K, id: UUID): void {
    const bucket = this.buckets.get(key);
    if (bucket === undefined) this.buckets.set(key, new Set([id]));
    else bucket.add(id);
  }

  remove(key: K, id: UUID): void {
    const bucket = this.buckets.get(key);
    if (bucket === undefined) return;
    bucket.delete(id);
    if (bucket.size === 0) this.buckets.delete(key);
  }

  /** Callers must treat the result as read-only; it is the live bucket, not a copy. */
  get(key: K): ReadonlySet<UUID> {
    return this.buckets.get(key) ?? EMPTY;
  }

  /**
   * The whole index as a map, for a caller that probes many keys rather than one.
   *
   * The filter compiler takes its context as maps precisely so the inner loop over five
   * thousand issues is a `Map.get` and not a method call per row. Live and read-only: it
   * is the index itself, so a caller that copied it would be copying the workspace.
   */
  asMap(): ReadonlyMap<K, ReadonlySet<UUID>> {
    return this.buckets;
  }

  keys(): IterableIterator<K> {
    return this.buckets.keys();
  }

  clear(): void {
    this.buckets.clear();
  }
}

/**
 * Folds a string the way the database does: diacritics stripped, case flattened, and
 * nothing else.
 *
 * This is `search_fold` from migration 000017 — `lower(unaccent(x))` — restated in
 * TypeScript. It is restated rather than shared because there is no way to share it: one
 * runs in Postgres and one runs in a browser. That makes it a contract between two
 * languages with no compiler holding it together, which is why the whitespace cases in
 * schema/filter-conformance.json exist, and why they record the server's answer rather
 * than either implementation's.
 *
 * Use this wherever the client answers a question the server also answers — `contains` in
 * a filter, the highlight ranges on a search result. Use `fold` below for the questions
 * only the client asks.
 *
 * One honest caveat: Postgres strips diacritics by a rules file, and NFD-plus-combining-
 * mark-strip is not byte-identical to it across all of Unicode. They agree on Latin, which
 * is what `unaccent.rules` actually covers; a script where they disagree is one where
 * Postgres was not folding either.
 */
export function foldExact(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Folds a string into its *display* comparison form: `foldExact`, and then whitespace
 * collapsed and the ends trimmed.
 *
 * Title ordering and the local trigram index both run on this rather than on the raw
 * title, so that sorting can use `<` instead of an `Intl.Collator`. The collator is the
 * correct answer linguistically and the wrong one here: a collator comparison costs
 * roughly fifty times a string comparison, and sorting five thousand titles is sixty
 * thousand comparisons \u2014 the frame budget, spent on ordering alone.
 *
 * The collapse is right for both of those and wrong for anything the server also answers,
 * because it rewrites the string: `"login  redirect"` and `"login redirect"` become one
 * query here and stay two in SQL. `contains` used to fold with this and matched rows the
 * API then declined to return \u2014 a filter that worked on screen and returned nothing from
 * a digest. Reach for `foldExact` there.
 */
export function fold(text: string): string {
  return foldExact(text).replace(/\s+/g, ' ').trim();
}

/** The trigram length. Three is the point where postings stay selective without the map exploding. */
const TRIGRAM = 3;

function trigramsOf(folded: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + TRIGRAM <= folded.length; i++) out.add(folded.slice(i, i + TRIGRAM));
  return out;
}

/**
 * Parses an RFC 3339 timestamp into epoch milliseconds for ordering.
 *
 * Sorting the strings directly would be wrong, not merely slower: Go emits RFC 3339 with
 * trailing zeros trimmed from the fraction, so `…:00.5Z` and `…:00.55Z` compare as `5Z`
 * against `55Z` and the earlier instant wins. Parsing once at index time costs a `Date`
 * per write and removes the whole question from the sort path.
 */
function epochOf(timestamp: string): number {
  const ms = Date.parse(timestamp);
  // An unparseable timestamp sorts oldest rather than poisoning every comparison it
  // touches with NaN, which would make the sort order silently non-deterministic.
  return Number.isNaN(ms) ? 0 : ms;
}

export class IssueIndex {
  private readonly ids = new Set<UUID>();
  /**
   * Non-archived issues. Archived work is excluded from every list by default, so
   * keeping it as an index rather than a per-candidate property read means the common
   * query is answered entirely out of the sets.
   */
  private readonly live = new Set<UUID>();
  private readonly team = new SetIndex<UUID>();
  private readonly state = new SetIndex<UUID>();
  private readonly assignee = new SetIndex<UUID>();
  /** Kept apart from `assignee` so "unassigned" is a bucket rather than a sentinel id. */
  private readonly unassigned = new Set<UUID>();
  private readonly priority = new SetIndex<number>();
  private readonly parent = new SetIndex<UUID>();
  private readonly project = new SetIndex<UUID>();
  private readonly cycle = new SetIndex<UUID>();
  /**
   * Issues with no parent. Kept apart from `parent` for the same reason `unassigned` is
   * kept apart from `assignee`, and because it is the corpus an issue list actually
   * wants: showing every sub-issue at the top level as well as under its parent is how a
   * list of forty items reads as a list of a hundred and twenty.
   */
  private readonly rootIssues = new Set<UUID>();
  private readonly updated = new Map<UUID, number>();
  private readonly folded = new Map<UUID, string>();
  private readonly trigram = new SetIndex<string>();

  private order: UUID[] = [];
  private orderStale = false;

  get size(): number {
    return this.ids.size;
  }

  add(issue: Issue): void {
    if (this.ids.has(issue.id)) {
      // An upsert for something already indexed is an update; routing it here rather
      // than double-adding is what keeps a replayed change idempotent.
      return;
    }
    this.ids.add(issue.id);
    if (issue.archivedAt === undefined) this.live.add(issue.id);
    this.team.add(issue.teamId, issue.id);
    this.state.add(issue.stateId, issue.id);
    if (issue.assigneeId === undefined) this.unassigned.add(issue.id);
    else this.assignee.add(issue.assigneeId, issue.id);
    this.priority.add(issue.priority, issue.id);
    if (issue.parentId === undefined) this.rootIssues.add(issue.id);
    else this.parent.add(issue.parentId, issue.id);
    if (issue.projectId !== undefined) this.project.add(issue.projectId, issue.id);
    if (issue.cycleId !== undefined) this.cycle.add(issue.cycleId, issue.id);
    this.updated.set(issue.id, epochOf(issue.updatedAt));
    this.indexTitle(issue.id, issue.title);
    this.orderStale = true;
  }

  /**
   * Moves an issue between buckets, touching only the dimensions that actually changed.
   *
   * The overwhelmingly common delta is a status move or a priority change, which leaves
   * the title — the expensive dimension, because retrigramming allocates two sets and
   * walks the string — untouched. Comparing before editing is what keeps a fifty-change
   * batch cheap.
   */
  update(previous: Issue, next: Issue): void {
    if (!this.ids.has(next.id)) {
      this.add(next);
      return;
    }
    const id = next.id;

    if (previous.teamId !== next.teamId) {
      this.team.remove(previous.teamId, id);
      this.team.add(next.teamId, id);
    }
    if (previous.stateId !== next.stateId) {
      this.state.remove(previous.stateId, id);
      this.state.add(next.stateId, id);
    }
    if (previous.assigneeId !== next.assigneeId) {
      if (previous.assigneeId === undefined) this.unassigned.delete(id);
      else this.assignee.remove(previous.assigneeId, id);
      if (next.assigneeId === undefined) this.unassigned.add(id);
      else this.assignee.add(next.assigneeId, id);
    }
    if (previous.priority !== next.priority) {
      this.priority.remove(previous.priority, id);
      this.priority.add(next.priority, id);
    }
    if (previous.parentId !== next.parentId) {
      if (previous.parentId === undefined) this.rootIssues.delete(id);
      else this.parent.remove(previous.parentId, id);
      if (next.parentId === undefined) this.rootIssues.add(id);
      else this.parent.add(next.parentId, id);
    }
    if (previous.projectId !== next.projectId) {
      if (previous.projectId !== undefined) this.project.remove(previous.projectId, id);
      if (next.projectId !== undefined) this.project.add(next.projectId, id);
    }
    if (previous.cycleId !== next.cycleId) {
      if (previous.cycleId !== undefined) this.cycle.remove(previous.cycleId, id);
      if (next.cycleId !== undefined) this.cycle.add(next.cycleId, id);
    }
    if (previous.archivedAt !== next.archivedAt) {
      if (next.archivedAt === undefined) this.live.add(id);
      else this.live.delete(id);
    }
    if (previous.title !== next.title) {
      this.unindexTitle(id);
      this.indexTitle(id, next.title);
    }
    if (previous.updatedAt !== next.updatedAt) {
      this.updated.set(id, epochOf(next.updatedAt));
      this.orderStale = true;
    }
  }

  remove(issue: Issue): void {
    if (!this.ids.delete(issue.id)) return;
    const id = issue.id;
    this.live.delete(id);
    this.team.remove(issue.teamId, id);
    this.state.remove(issue.stateId, id);
    if (issue.assigneeId === undefined) this.unassigned.delete(id);
    else this.assignee.remove(issue.assigneeId, id);
    this.priority.remove(issue.priority, id);
    if (issue.parentId === undefined) this.rootIssues.delete(id);
    else this.parent.remove(issue.parentId, id);
    if (issue.projectId !== undefined) this.project.remove(issue.projectId, id);
    if (issue.cycleId !== undefined) this.cycle.remove(issue.cycleId, id);
    this.updated.delete(id);
    this.unindexTitle(id);
    this.orderStale = true;
  }

  /**
   * Rebuilds from scratch, for hydration from IndexedDB and for the resync path.
   *
   * This is the only O(n) entry point and it is deliberately not reachable from a delta:
   * everything the socket delivers goes through `add`/`update`/`remove`.
   */
  rebuild(issues: Iterable<Issue>): void {
    this.clear();
    for (const issue of issues) this.add(issue);
  }

  clear(): void {
    this.ids.clear();
    this.live.clear();
    this.team.clear();
    this.state.clear();
    this.assignee.clear();
    this.unassigned.clear();
    this.priority.clear();
    this.parent.clear();
    this.project.clear();
    this.cycle.clear();
    this.rootIssues.clear();
    this.updated.clear();
    this.folded.clear();
    this.trigram.clear();
    this.order = [];
    this.orderStale = false;
  }

  all(): ReadonlySet<UUID> {
    return this.ids;
  }

  /** Non-archived issues — the default corpus for every list. */
  active(): ReadonlySet<UUID> {
    return this.live;
  }

  byTeam(teamId: UUID): ReadonlySet<UUID> {
    return this.team.get(teamId);
  }

  byState(stateId: UUID): ReadonlySet<UUID> {
    return this.state.get(stateId);
  }

  /** `null` asks for the unassigned bucket; there is no id that means "nobody". */
  byAssignee(assigneeId: UUID | null): ReadonlySet<UUID> {
    return assigneeId === null ? this.unassigned : this.assignee.get(assigneeId);
  }

  byPriority(priority: number): ReadonlySet<UUID> {
    return this.priority.get(priority);
  }

  /**
   * Sub-issues of one issue, or the issues that have no parent when asked for `null`.
   *
   * The rollup on a parent row reads this once per open parent, so it has to be a bucket
   * rather than a scan: an issue list showing progress on twenty parents would otherwise
   * walk the whole workspace twenty times per frame.
   */
  byParent(parentId: UUID | null): ReadonlySet<UUID> {
    return parentId === null ? this.rootIssues : this.parent.get(parentId);
  }

  /** Issues in one project. An issue with no project is in no bucket here. */
  byProject(projectId: UUID): ReadonlySet<UUID> {
    return this.project.get(projectId);
  }

  /** Issues in one cycle. An issue with no cycle is in no bucket here. */
  byCycle(cycleId: UUID): ReadonlySet<UUID> {
    return this.cycle.get(cycleId);
  }

  /** Epoch milliseconds, for comparators that must not re-parse a timestamp per comparison. */
  updatedAtOf(id: UUID): number {
    return this.updated.get(id) ?? 0;
  }

  /** The folded title, which is both the search corpus and the title sort key. */
  titleOf(id: UUID): string {
    return this.folded.get(id) ?? '';
  }

  /**
   * Every issue id, most recently updated first.
   *
   * Sorted lazily and shared. A delta batch marks the order stale once however many
   * issues it touches, and the sort is paid on the next read — so a burst of five
   * hundred changes costs one sort, and every open view ordering by recency reads the
   * same array instead of sorting its own copy.
   */
  updatedOrder(): readonly UUID[] {
    if (this.orderStale || this.order.length !== this.ids.size) {
      this.order = [...this.ids];
      this.order.sort((a, b) => {
        const delta = this.updatedAtOf(b) - this.updatedAtOf(a);
        // Ids break ties so that two issues saved in the same millisecond keep a stable
        // position between renders instead of swapping under the cursor.
        return delta !== 0 ? delta : a < b ? -1 : a > b ? 1 : 0;
      });
      this.orderStale = false;
    }
    return this.order;
  }

  /**
   * Ids whose title contains `query`.
   *
   * Trigrams narrow the candidates and a substring check confirms them, because trigram
   * containment is a superset test: `abcd` and `abcxxbcd` share every trigram of the
   * query without one containing the other. Skipping the confirmation would show hits
   * that do not match, which reads as a broken search rather than a fast one.
   *
   * Queries shorter than a trigram cannot use the postings at all and scan the folded
   * titles instead. That is a linear pass, and it is fine: it happens only on the first
   * one or two keystrokes, over short strings, and the alternative — indexing one- and
   * two-grams as well — doubles the map to make the least selective queries faster.
   */
  search(query: string): ReadonlySet<UUID> {
    const needle = fold(query);
    if (needle === '') return this.ids;

    if (needle.length < TRIGRAM) {
      const hits = new Set<UUID>();
      for (const [id, title] of this.folded) if (title.includes(needle)) hits.add(id);
      return hits;
    }

    const postings = [...trigramsOf(needle)].map((gram) => this.trigram.get(gram));
    postings.sort((a, b) => a.size - b.size);
    const smallest = postings[0];
    if (smallest === undefined || smallest.size === 0) return EMPTY;

    const hits = new Set<UUID>();
    candidate: for (const id of smallest) {
      for (let i = 1; i < postings.length; i++) {
        const posting = postings[i];
        if (posting === undefined || !posting.has(id)) continue candidate;
      }
      if (this.titleOf(id).includes(needle)) hits.add(id);
    }
    return hits;
  }

  private indexTitle(id: UUID, title: string): void {
    const folded = fold(title);
    this.folded.set(id, folded);
    for (const gram of trigramsOf(folded)) this.trigram.add(gram, id);
  }

  private unindexTitle(id: UUID): void {
    const folded = this.folded.get(id);
    if (folded === undefined) return;
    for (const gram of trigramsOf(folded)) this.trigram.remove(gram, id);
    this.folded.delete(id);
  }
}

/**
 * Which labels are on which issues, from an `issueLabel` row per application.
 *
 * Four maps, and each one earns its memory:
 *
 *   issue → label ids   the render path. A filtered list draws every visible row's
 *                       labels, so this must be a set that already exists rather than
 *                       one built per row per frame.
 *   label → issue ids   the filter path, so "labelled bug" is an intersection over a
 *                       posting list instead of a scan.
 *   issue → row ids     the cascade. Losing an issue must take its applications with it,
 *                       and a pair of ids cannot name the row that asserts it.
 *   label → row ids     the same, for a label deleted out of settings.
 *
 * The pair sets are safe to unwind on a single row delete because `issue_label` carries a
 * unique index on (issue_id, label_id) — see migration 000012 — so no second row can be
 * asserting the pair that is going away.
 */
export class LabelIndex {
  private readonly labelsOfIssue = new SetIndex<UUID>();
  private readonly issuesOfLabel = new SetIndex<UUID>();
  private readonly rowsOfIssue = new SetIndex<UUID>();
  private readonly rowsOfLabel = new SetIndex<UUID>();

  add(row: IssueLabel): void {
    this.labelsOfIssue.add(row.issueId, row.labelId);
    this.issuesOfLabel.add(row.labelId, row.issueId);
    this.rowsOfIssue.add(row.issueId, row.id);
    this.rowsOfLabel.add(row.labelId, row.id);
  }

  /**
   * Neither end of an application is editable in the product — a label is added or it is
   * removed — but a replayed upsert must still be idempotent, and a row that did somehow
   * move ends up in the new buckets and nowhere else.
   */
  update(previous: IssueLabel, next: IssueLabel): void {
    if (previous.issueId !== next.issueId || previous.labelId !== next.labelId) {
      this.remove(previous);
    }
    this.add(next);
  }

  remove(row: IssueLabel): void {
    this.labelsOfIssue.remove(row.issueId, row.labelId);
    this.issuesOfLabel.remove(row.labelId, row.issueId);
    this.rowsOfIssue.remove(row.issueId, row.id);
    this.rowsOfLabel.remove(row.labelId, row.id);
  }

  rebuild(rows: Iterable<IssueLabel>): void {
    this.clear();
    for (const row of rows) this.add(row);
  }

  clear(): void {
    this.labelsOfIssue.clear();
    this.issuesOfLabel.clear();
    this.rowsOfIssue.clear();
    this.rowsOfLabel.clear();
  }

  /** The labels on an issue. Read once per rendered row, so it is the live set, not a copy. */
  labelIdsFor(issueId: UUID): ReadonlySet<UUID> {
    return this.labelsOfIssue.get(issueId);
  }

  /** The same thing as a map, which is the shape the filter compiler's context takes. */
  labelsByIssue(): ReadonlyMap<UUID, ReadonlySet<UUID>> {
    return this.labelsOfIssue.asMap();
  }

  issueIdsWith(labelId: UUID): ReadonlySet<UUID> {
    return this.issuesOfLabel.get(labelId);
  }

  rowIdsForIssue(issueId: UUID): ReadonlySet<UUID> {
    return this.rowsOfIssue.get(issueId);
  }

  rowIdsForLabel(labelId: UUID): ReadonlySet<UUID> {
    return this.rowsOfLabel.get(labelId);
  }
}

/**
 * Relations, indexed from both ends.
 *
 * Only one row exists per link — `blocks` is stored and "blocked by" is that same row
 * read from the other side — so the inverse direction has to be an index rather than a
 * row. Without `rowIdsTo`, answering "what blocks this issue" means scanning every
 * relation in the workspace, on a panel that opens on every issue.
 */
export class RelationIndex {
  private readonly outgoing = new SetIndex<UUID>();
  private readonly incoming = new SetIndex<UUID>();
  /**
   * The `blocks` rows again, as issue ids rather than row ids.
   *
   * A second view of the same rows, kept because the filter grammar has `blockedBy` and
   * `blocking` fields and compiles them into a map probe per issue. Deriving the map from
   * the row buckets would mean resolving every row through the table on every keystroke,
   * which is the scan this file exists to remove — and relations are few, so the extra
   * two buckets cost almost nothing.
   */
  private readonly blocking = new SetIndex<UUID>();
  private readonly blockedBy = new SetIndex<UUID>();

  add(row: IssueRelation): void {
    this.outgoing.add(row.issueId, row.id);
    this.incoming.add(row.relatedIssueId, row.id);
    if (row.type === 'blocks') {
      this.blocking.add(row.issueId, row.relatedIssueId);
      this.blockedBy.add(row.relatedIssueId, row.issueId);
    }
  }

  update(previous: IssueRelation, next: IssueRelation): void {
    // The type is included: a link retyped from `blocks` to `related` has to leave the
    // blocking buckets, or an issue stays blocked by something that no longer blocks it.
    if (
      previous.issueId !== next.issueId ||
      previous.relatedIssueId !== next.relatedIssueId ||
      previous.type !== next.type
    ) {
      this.remove(previous);
    }
    this.add(next);
  }

  remove(row: IssueRelation): void {
    this.outgoing.remove(row.issueId, row.id);
    this.incoming.remove(row.relatedIssueId, row.id);
    if (row.type === 'blocks') {
      this.blocking.remove(row.issueId, row.relatedIssueId);
      this.blockedBy.remove(row.relatedIssueId, row.issueId);
    }
  }

  rebuild(rows: Iterable<IssueRelation>): void {
    this.clear();
    for (const row of rows) this.add(row);
  }

  clear(): void {
    this.outgoing.clear();
    this.incoming.clear();
    this.blocking.clear();
    this.blockedBy.clear();
  }

  /** Relations this issue declares: it blocks, duplicates or relates to something. */
  rowIdsFrom(issueId: UUID): ReadonlySet<UUID> {
    return this.outgoing.get(issueId);
  }

  /** Relations pointing at this issue — where "blocked by" comes from. */
  rowIdsTo(issueId: UUID): ReadonlySet<UUID> {
    return this.incoming.get(issueId);
  }

  /** For each issue, the issues it blocks. The shape the filter compiler's context takes. */
  blockingByIssue(): ReadonlyMap<UUID, ReadonlySet<UUID>> {
    return this.blocking.asMap();
  }

  /** For each issue, the issues blocking it — the same rows, read from the other end. */
  blockedByIssue(): ReadonlyMap<UUID, ReadonlySet<UUID>> {
    return this.blockedBy.asMap();
  }
}

/**
 * The inbox, indexed by the two questions asked of it.
 *
 * `unread` is a set rather than a counter because the badge is not the only reader: the
 * inbox filters to unread, marking one read has to move exactly one id, and a counter
 * maintained beside a list is a counter that eventually disagrees with it.
 *
 * Snoozed rows are deliberately not a bucket. A snooze expires because the clock moved,
 * not because anything was written, so an index over it is stale the moment it matters
 * and nothing arrives to rebuild it. The inbox compares `snoozedUntil` at read time.
 */
export class NotificationIndex {
  private readonly unreadIds = new Set<UUID>();
  private readonly issue = new SetIndex<UUID>();

  add(row: Notification): void {
    if (row.readAt === undefined) this.unreadIds.add(row.id);
    if (row.issueId !== undefined) this.issue.add(row.issueId, row.id);
  }

  update(previous: Notification, next: Notification): void {
    if (previous.issueId !== next.issueId) {
      if (previous.issueId !== undefined) this.issue.remove(previous.issueId, previous.id);
      if (next.issueId !== undefined) this.issue.add(next.issueId, next.id);
    }
    // Marking read is the overwhelmingly common update — coalescing rewrites the row on
    // every repeat event — so the membership is corrected rather than re-derived.
    if (next.readAt === undefined) this.unreadIds.add(next.id);
    else this.unreadIds.delete(next.id);
  }

  remove(row: Notification): void {
    this.unreadIds.delete(row.id);
    if (row.issueId !== undefined) this.issue.remove(row.issueId, row.id);
  }

  rebuild(rows: Iterable<Notification>): void {
    this.clear();
    for (const row of rows) this.add(row);
  }

  clear(): void {
    this.unreadIds.clear();
    this.issue.clear();
  }

  unread(): ReadonlySet<UUID> {
    return this.unreadIds;
  }

  rowIdsForIssue(issueId: UUID): ReadonlySet<UUID> {
    return this.issue.get(issueId);
  }
}
