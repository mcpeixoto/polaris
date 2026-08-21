/**
 * The parts of search that are arithmetic rather than interface: folding, the tokenisation
 * that mirrors the server's, where the matched words sit in a string, and the words the
 * screen uses to say how much of an answer it is showing.
 *
 * All of it is here rather than in the screen for one reason. The interesting failures in a
 * search box are not rendering failures — they are a highlight that misses the word the
 * server matched on, an excerpt that cuts through the middle of it, a count that claims
 * there is more to fetch when there is not. Each of those is a pure function of a string
 * and a query, and each is a test that runs in a millisecond and needs no DOM at all.
 *
 * ## Folding, and why this file has its own
 *
 * The server indexes `lower(unaccent(x))` and matches the query the same way (migration
 * 000017, `search_fold`). Somebody typing "acao" is looking for "Ação", the server agrees,
 * and a highlighter that compared raw strings would decorate nothing on the very rows the
 * search worked hardest to find — the accented ones. So the folding here restates the
 * server's, and the test asserts that pairing directly.
 *
 * `~/store`'s `fold` is the same idea and cannot be used: it also collapses runs of
 * whitespace and trims, which is right for a comparison key and fatal here, because every
 * character it removes shifts every offset after it and the highlight lands on the wrong
 * word. This one preserves length-per-character mapping instead, which is the whole reason
 * it exists separately.
 *
 * The honest limit of the restatement: Postgres's `unaccent` works from a rules file that
 * also expands non-decomposable letters — Ø to O, Æ to AE, ß to ss — and Unicode's NFD does
 * not, because those characters have no canonical decomposition to strip. Every accented
 * Latin letter in ordinary use (á, ê, ï, õ, ü, ç, ñ) does decompose and is covered. Where
 * the two disagree the consequence is a missing highlight on a row the server correctly
 * returned, never a wrong row: the server decided the match, this file only decorates it.
 */

/**
 * The URL parameter the query lives in.
 *
 * Exported because it is the contract for anything that links *into* search — a sidebar
 * entry, a command-menu action, the desktop shell's deep links — and a second string
 * literal spelled `'q'` somewhere else is how a link ends up opening an empty search box.
 */
export const QUERY_PARAM = 'q';

/** What the server returns when nobody has asked for more. Its default, restated. */
export const SEARCH_PAGE_SIZE = 25;

/**
 * The server's ceiling on `first`. Asking for more is silently clamped rather than refused,
 * which is exactly why the number has to exist on this side too: a client that asked for 500
 * and rendered 100 would show a "show more" that fetched the same hundred rows for ever.
 */
export const SEARCH_MAX_RESULTS = 100;

/**
 * How many words of a query reach the index. The server truncates at twelve, because each
 * token is an AND and a query with a thousand of them is a way to make the planner do a
 * thousand probes per row. Truncating here too keeps the highlight honest — a thirteenth
 * word was not matched on, so it must not be drawn as though it were.
 */
export const SEARCH_MAX_TOKENS = 12;

/** How much of a comment an excerpt shows, in characters, before the window is cut. */
export const EXCERPT_WIDTH = 160;

/**
 * A word, as both the tokeniser and the index understand one: letters and decimal digits.
 *
 * `\p{Nd}` rather than `\p{N}`, because the server splits on Go's `unicode.IsDigit`, which
 * is the Nd category alone — `Ⅳ` and `½` are numbers to Unicode and separators to the
 * tokeniser, and a client that treated them as word characters would tokenise a query
 * differently from the index it is querying.
 */
const WORD = /[\p{L}\p{Nd}]/u;
const WORDS = /[\p{L}\p{Nd}]+/gu;

/** Everything NFD splits an accented letter into, which is the half that gets thrown away. */
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/**
 * A string in its folded form, with each folded character pointing back at the original.
 *
 * The mapping is the point. Folding is not length-preserving — one character can fold to
 * two ("İ" lowercases to "i̇"), to one, or to none (a lone combining mark) — so an offset
 * found in the folded text is not an offset in the text on screen, and highlighting with it
 * directly draws the mark a character or two off. Recording where each folded character came
 * from costs one array per string and removes the question.
 */
interface FoldedText {
  readonly folded: string;
  /** `starts[i]` is where in the original the character at folded index `i` begins. */
  readonly starts: readonly number[];
  /** `ends[i]` is just past it, absorbing anything that folded to nothing after it. */
  readonly ends: readonly number[];
}

function foldedText(text: string): FoldedText {
  let folded = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let at = 0;

  // Iterated by code point rather than by UTF-16 unit: `normalize` on half a surrogate pair
  // is meaningless, and an emoji in a title would otherwise fold to two replacement halves.
  for (const character of text) {
    const next = at + character.length;
    const piece = character.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase();

    if (piece === '') {
      // A character with no folded form at all — a combining mark standing on its own, a
      // zero-width joiner. It is attached to whatever preceded it so that a highlight
      // covering the base letter covers its accent too, rather than leaving the mark
      // stranded outside the mark element and drawn against the wrong background.
      if (ends.length > 0) ends[ends.length - 1] = next;
    } else {
      for (let i = 0; i < piece.length; i++) {
        starts.push(at);
        ends.push(next);
      }
      folded += piece;
    }
    at = next;
  }

  return { folded, starts, ends };
}

/**
 * The comparison form of a string: accents stripped, case flattened, nothing else touched.
 *
 * Deliberately not trimmed and not whitespace-collapsed, unlike `~/store`'s `fold`. This is
 * the server's `search_fold` and no more, so that "what the server matched" and "what the
 * screen highlights" are answers to the same question.
 */
export function foldForSearch(text: string): string {
  return foldedText(text).folded;
}

/**
 * The words a query is searched by, folded, in the order they were typed.
 *
 * This is `buildTSQuery` restated: split on anything that is not a letter or a digit,
 * drop unquoted English glue ("the", "a", "of", …), keep quoted spans as their words, and
 * keep at most twelve. What is *not* restated is the trailing `:*` or the `<->` phrase
 * operator — those are matching instructions, not extra things to highlight.
 *
 * The cost of that symmetry, stated so nobody has to rediscover it: a non-final term is
 * highlighted the same way, so searching "login redirect" also marks the "login" inside
 * "logins" — a word the server did not match on. Over-drawing a highlight by a word the
 * reader can see for themselves is a much smaller error than under-drawing one, and the
 * alternative is reimplementing tsquery's word semantics in the browser.
 *
 * Stop words are restated from `searchStopWords` in services/internal/domain/search.go.
 */
const SEARCH_STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'to',
  'in',
  'for',
  'and',
  'or',
  'on',
  'is',
  'at',
  'by',
  'as',
  'it',
  'be',
  'this',
  'that',
]);

export function searchTerms(query: string): readonly string[] {
  const parts: { words: string[]; phrase: boolean }[] = [];
  let loose: string[] = [];
  const flushLoose = () => {
    for (const word of loose) parts.push({ words: [word], phrase: false });
    loose = [];
  };

  let i = 0;
  while (i < query.length) {
    const char = query[i] ?? '';
    if (char === '"') {
      flushLoose();
      i += 1;
      let inner = '';
      while (i < query.length && query[i] !== '"') {
        inner += query[i];
        i += 1;
      }
      if (query[i] === '"') i += 1;
      const quoted = inner.match(WORDS);
      if (quoted !== null) parts.push({ words: quoted.map(foldForSearch), phrase: true });
      continue;
    }
    if (WORD.test(char)) {
      let token = char;
      i += 1;
      while (i < query.length && WORD.test(query[i] ?? '')) {
        token += query[i];
        i += 1;
      }
      loose.push(foldForSearch(token));
      continue;
    }
    i += 1;
  }
  flushLoose();

  const hasContent = parts.some(
    (part) => part.phrase || !SEARCH_STOP_WORDS.has(part.words[0] ?? ''),
  );
  const kept = hasContent
    ? parts.filter((part) => part.phrase || !SEARCH_STOP_WORDS.has(part.words[0] ?? ''))
    : parts;
  const words: string[] = [];
  for (const part of kept) words.push(...part.words);
  return words.slice(0, SEARCH_MAX_TOKENS);
}

/** Half-open, in offsets into the original string — ready for `slice`. */
export interface MatchRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Where the searched-for words sit in a string, merged and in reading order.
 *
 * Merged because two terms can overlap — "ac ao" over "Ação" produces two ranges that share
 * characters — and rendering them as separate runs would emit nested mark elements and a
 * visible seam through the middle of a word.
 */
export function matchRanges(text: string, terms: readonly string[]): readonly MatchRange[] {
  if (text === '' || terms.length === 0) return [];

  const { folded, starts, ends } = foldedText(text);
  const found: MatchRange[] = [];

  for (const term of terms) {
    if (term === '') continue;
    let from = 0;
    for (;;) {
      const at = folded.indexOf(term, from);
      if (at === -1) break;
      // Advanced by one rather than by the term's length: two occurrences of "aa" in "aaa"
      // overlap, and skipping past the first would lose the second.
      from = at + 1;
      // Anchored at a word boundary, because the index matches words and prefixes of words.
      // Without this, searching "ao" would decorate the middle of "chaos" — a highlight
      // pointing at something that had nothing to do with why the row is on screen.
      if (at > 0 && WORD.test(folded[at - 1] ?? '')) continue;

      const start = starts[at];
      const end = ends[at + term.length - 1];
      if (start === undefined || end === undefined) continue;
      found.push({ start, end });
    }
  }

  return mergeRanges(found);
}

function mergeRanges(ranges: readonly MatchRange[]): MatchRange[] {
  if (ranges.length <= 1) return [...ranges];

  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: MatchRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous === undefined || range.start > previous.end) {
      merged.push(range);
      continue;
    }
    if (range.end > previous.end)
      merged[merged.length - 1] = { start: previous.start, end: range.end };
  }
  return merged;
}

/** A stretch of text and whether it is one of the words that was searched for. */
export interface TextRun {
  readonly text: string;
  readonly match: boolean;
}

/**
 * A string split into the runs a renderer can walk: matched, unmatched, matched.
 *
 * Returned as data rather than as markup so that this stays testable without a DOM, and so
 * that the same computation serves a title, a comment excerpt and anything later that wants
 * to draw the same marks somewhere else.
 */
export function highlightRuns(text: string, terms: readonly string[]): readonly TextRun[] {
  if (text === '') return [];

  const ranges = matchRanges(text, terms);
  if (ranges.length === 0) return [{ text, match: false }];

  const runs: TextRun[] = [];
  let at = 0;
  for (const range of ranges) {
    if (range.start > at) runs.push({ text: text.slice(at, range.start), match: false });
    runs.push({ text: text.slice(range.start, range.end), match: true });
    at = range.end;
  }
  if (at < text.length) runs.push({ text: text.slice(at), match: false });
  return runs;
}

/**
 * A window of a comment's body around the first thing that matched.
 *
 * A comment body is markdown of any length, and the head of it is very often a quote, a
 * greeting or a list marker — so showing the first 160 characters shows the reader why they
 * are looking at the row roughly never. Centring on the match is the whole value of the
 * excerpt.
 *
 * Whitespace is collapsed first, which makes the offsets those of the excerpt rather than of
 * the body — deliberate, because the caller highlights the string this returns, not the one
 * it was given. The window is then grown outwards to the nearest space rather than cut, so
 * it never ends mid-word, and marked with an ellipsis on whichever side was actually cut.
 */
export function excerptAround(
  body: string,
  terms: readonly string[],
  width: number = EXCERPT_WIDTH,
): string {
  const text = body.replace(/\s+/g, ' ').trim();
  if (text.length <= width) return text;

  const first = matchRanges(text, terms)[0];
  // Nothing matched — a comment can be in the results because of a term the excerpt window
  // happens not to reach, and a body long enough to be cut still has to show something.
  const anchor = first?.start ?? 0;

  // A third of the window ahead of the match, so the reader gets the run-up as well as the
  // sentence the word is in. Ahead rather than centred because the match is the thing being
  // looked for, and text after it is more often the answer than text before it.
  let start = Math.max(0, anchor - Math.floor(width / 3));
  if (start > 0) {
    const space = text.lastIndexOf(' ', start);
    start = space === -1 ? 0 : space + 1;
  }

  let end = Math.min(text.length, start + width);
  if (end < text.length) {
    const space = text.indexOf(' ', end);
    end = space === -1 ? text.length : space;
  }

  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

/** What the screen knows about how much of the issue results it has. */
export interface IssueTally {
  /** Rows on screen. */
  readonly shown: number;
  /** Every match, before the limit — the server's `issueCount`. */
  readonly total: number;
  /** The `first` the current request asked for. */
  readonly limit: number;
}

/**
 * How the header says what is on screen.
 *
 * The case worth the words is the last one. Once the request is already asking for the
 * server's maximum there is genuinely no more to fetch, and the two dishonest options are
 * both worse than saying so: a "show more" that fetches nothing teaches people the button
 * is broken, and dropping the total silently loses the one fact that would tell somebody
 * their query is too broad to be useful.
 */
export function describeIssueCount({ shown, total, limit }: IssueTally): string {
  if (total === 0) return 'No issues';
  if (shown >= total) return total === 1 ? '1 issue' : `${total} issues`;
  if (limit >= SEARCH_MAX_RESULTS) {
    return `${shown} of ${total} issues — search returns at most ${SEARCH_MAX_RESULTS}`;
  }
  return `${shown} of ${total} issues`;
}

/** Whether raising `first` would actually bring anything back. Gates the "show more". */
export function canShowMore({ shown, total, limit }: IssueTally): boolean {
  return shown < total && limit < SEARCH_MAX_RESULTS;
}

/**
 * The same sentence for comments, which the server does not count.
 *
 * `SearchResults.issueCount` is issues only, so there is no "of 400" to say here and this
 * deliberately does not guess one from the page being full. A count that was really "at
 * least this many" printed as though it were exact is worse than no count.
 */
export function describeCommentCount(shown: number): string {
  if (shown === 0) return 'No comments';
  return shown === 1 ? '1 comment' : `${shown} comments`;
}
