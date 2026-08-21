/**
 * Search's client-side half: what the server matched, restated well enough to draw.
 *
 * The screen never re-runs the query. Postgres decides which rows come back; everything
 * here decides how to *show* the reader why each one did — which words to mark, and which
 * 160 characters of a long comment to show them. That makes every function in this file an
 * assertion about the server's behaviour, made in a different language, with no compiler
 * holding the two together. Two of those assertions are pinned here.
 *
 * The first is folding. `foldForSearch` is `search_fold` from migration 000017 restated in
 * TypeScript, and `~/store`'s `foldExact` is the *same* function restated a second time for
 * the filter evaluator. Two restatements of one SQL function is one more than anybody can
 * keep in their head, so the first test below simply runs both over a corpus and demands
 * they agree. If they ever diverge, one of the two is lying about what the database did.
 *
 * The second is offsets. Folding changes a string's length — "Ação" is four characters and
 * folds to five — so every highlight range is an index into one string derived from a
 * search through a different one. That arithmetic is where this kind of code goes wrong,
 * and it goes wrong silently: a mark drawn one character to the left still looks like a
 * mark. `highlightRuns` is therefore tested by an invariant rather than by examples —
 * concatenating the runs must reproduce the input exactly — which catches every off-by-one
 * at once, including the ones nobody thought to write a case for.
 */

import { describe, expect, it } from 'vitest';

import { foldExact } from '~/store/indexes';

import {
  SEARCH_MAX_RESULTS,
  SEARCH_MAX_TOKENS,
  canShowMore,
  describeCommentCount,
  describeIssueCount,
  excerptAround,
  foldForSearch,
  highlightRuns,
  matchRanges,
  searchTerms,
} from './search';

/**
 * Strings chosen for the ways folding can go wrong, not for coverage of a language.
 *
 * Precomposed against decomposed, a mark with no base, an emoji outside the BMP, the
 * Turkish dotted capital, and whitespace of several kinds — because whitespace is exactly
 * where the two folds in this codebase were allowed to differ, and one of them was wrong.
 */
const CORPUS = [
  '',
  'Fix the login redirect',
  'Ação de limpeza',
  'AÇÃO de limpeza',
  'Résumé',
  'RESUME',
  '́',
  'áb',
  'İstanbul',
  'ÅNGSTRÖM',
  'Ship it 🚀 today',
  'two  spaces',
  '\ttabbed\n',
  '  padded  ',
  'ⅷ Roman',
  'ß straße',
];

describe('folding, which is the database’s definition restated in TypeScript', () => {
  it('agrees character-for-character with the store’s restatement of the same function', () => {
    // Both are `lower(unaccent(x))`. There is no third place to look up which one is right,
    // so what this can prove is that they are the same wrong-or-right thing — which is what
    // stops a filter and a search highlight disagreeing about the row they are both on.
    for (const text of CORPUS) {
      expect(foldForSearch(text), `disagreed on ${JSON.stringify(text)}`).toBe(foldExact(text));
    }
  });

  it('does not collapse whitespace, because the server does not', () => {
    expect(foldForSearch('two  spaces')).toBe('two  spaces');
    expect(foldForSearch('  padded  ')).toBe('  padded  ');
  });

  it('folds a precomposed and a decomposed spelling to the same string', () => {
    expect(foldForSearch('Ação')).toBe(foldForSearch('AÇÃO'.normalize('NFC')));
  });

  it('leaves an astral character intact rather than splitting a surrogate pair', () => {
    expect(foldForSearch('Ship it 🚀 today')).toContain('🚀');
  });
});

describe('the terms a query is searched by', () => {
  it('splits on anything that is not a letter or a digit', () => {
    expect(searchTerms('log-in redirect: 404!')).toEqual(['log', 'redirect', '404']);
  });

  it('folds each term, so typing without accents finds the accented row', () => {
    expect(searchTerms('Ação')).toEqual([foldExact('Ação')]);
  });

  it('keeps at most the tokens the server keeps, and the first ones', () => {
    const many = Array.from({ length: SEARCH_MAX_TOKENS + 5 }, (_, i) => `w${i}`).join(' ');
    const terms = searchTerms(many);
    expect(terms).toHaveLength(SEARCH_MAX_TOKENS);
    expect(terms[0]).toBe('w0');
  });

  it('drops unquoted English glue so "the login" highlights login', () => {
    expect(searchTerms('the login')).toEqual(['login']);
    expect(searchTerms('the')).toEqual(['the']);
  });

  it('keeps the words inside quotes, including glue', () => {
    expect(searchTerms('"the login" redirect')).toEqual(['the', 'login', 'redirect']);
  });

  it('is empty for a query with no words in it at all', () => {
    expect(searchTerms('   ---   ')).toEqual([]);
  });
});

describe('where the matched words sit', () => {
  it('returns offsets into the original string, not into the folded one', () => {
    // "Ação" folds to five characters and is four. A range taken from the folded string
    // would slice "Açã" out of the original and draw the mark a character short.
    const text = 'Ação de limpeza';
    const [range] = matchRanges(text, searchTerms('acao'));
    expect(range).toBeDefined();
    expect(text.slice(range?.start, range?.end)).toBe('Ação');
  });

  it('anchors at a word boundary rather than marking the middle of an unrelated word', () => {
    // The index matches words and prefixes of words. "ao" inside "chaos" is neither, and a
    // mark there points at something that had nothing to do with why the row is on screen.
    expect(matchRanges('chaos theory', ['ao'])).toEqual([]);
  });

  it('marks a prefix, because the server makes the last term a prefix match', () => {
    const text = 'Fix the login redirect';
    const [range] = matchRanges(text, ['redir']);
    expect(text.slice(range?.start, range?.end)).toBe('redir');
  });

  it('merges two terms that overlap into one range instead of nesting marks', () => {
    // "ac" and "acao" both hit at the same place; two ranges would render as two mark
    // elements, one inside the other, with a visible seam through the word.
    const ranges = matchRanges('Ação', ['ac', 'acao']);
    expect(ranges).toHaveLength(1);
  });

  it('finds a second, overlapping occurrence rather than skipping past it', () => {
    expect(matchRanges('aaa bbb', ['aa'])).toHaveLength(1);
    expect(matchRanges('aa aa', ['aa'])).toHaveLength(2);
  });

  it('is empty when nothing was searched for, and when there is nothing to search', () => {
    expect(matchRanges('anything', [])).toEqual([]);
    expect(matchRanges('', ['anything'])).toEqual([]);
  });
});

describe('the runs a renderer walks', () => {
  it('reproduces the input exactly when concatenated, for every string in the corpus', () => {
    // The invariant that catches every offset bug at once. A mark drawn one character out
    // still looks like a mark, so examples do not find this class of defect; a run list
    // that does not reassemble into its input always has something wrong with it.
    const terms = ['a', 'the', 'resume', 'acao', '🚀', 'spaces'];
    for (const text of CORPUS) {
      const rebuilt = highlightRuns(text, terms)
        .map((run) => run.text)
        .join('');
      expect(rebuilt, `lost text in ${JSON.stringify(text)}`).toBe(text);
    }
  });

  it('splits into unmatched, matched, unmatched', () => {
    expect(highlightRuns('Fix the login', ['the'])).toEqual([
      { text: 'Fix ', match: false },
      { text: 'the', match: true },
      { text: ' login', match: false },
    ]);
  });

  it('is one unmatched run when nothing matched, rather than empty', () => {
    // The renderer draws whatever comes back. Returning nothing here would blank the title
    // of every row that is in the results because of a word in its description.
    expect(highlightRuns('Fix the login', ['nothing'])).toEqual([
      { text: 'Fix the login', match: false },
    ]);
  });

  it('is empty for the empty string, because there is nothing to draw', () => {
    expect(highlightRuns('', ['x'])).toEqual([]);
  });
});

describe('the excerpt around a match', () => {
  const body = `${'lorem ipsum '.repeat(30)}needle ${'dolor sit '.repeat(30)}`;

  it('returns a short body whole, with no ellipsis and no window', () => {
    expect(excerptAround('short enough', ['short'])).toBe('short enough');
  });

  it('collapses whitespace, because the caller highlights what this returns', () => {
    expect(excerptAround('a\n\nb   c', ['a'])).toBe('a b c');
  });

  it('contains the match, and marks both sides it cut', () => {
    const excerpt = excerptAround(body, ['needle']);
    expect(excerpt).toContain('needle');
    expect(excerpt.startsWith('…')).toBe(true);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  it('never cuts mid-word', () => {
    const excerpt = excerptAround(body, ['needle']);
    const stripped = excerpt.replace(/^…/, '').replace(/…$/, '');
    expect(body).toContain(stripped);
  });

  it('shows the head when nothing matched, rather than nothing', () => {
    // A comment can be in the results because of a term the window happens not to reach.
    const excerpt = excerptAround(body, ['absent']);
    expect(excerpt.startsWith('lorem')).toBe(true);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  it('honours a narrower window', () => {
    expect(excerptAround(body, ['needle'], 40).length).toBeLessThan(60);
  });
});

describe('what the header says', () => {
  it('counts, and says nothing rather than zero', () => {
    expect(describeIssueCount({ shown: 0, total: 0, limit: 25 })).toBe('No issues');
    expect(describeIssueCount({ shown: 1, total: 1, limit: 25 })).toBe('1 issue');
    expect(describeIssueCount({ shown: 25, total: 25, limit: 25 })).toBe('25 issues');
    expect(describeIssueCount({ shown: 25, total: 80, limit: 25 })).toBe('25 of 80 issues');
  });

  it('says the ceiling out loud once the request is already asking for it', () => {
    // The alternative is a "show more" that fetches nothing, which teaches people the
    // button is broken rather than that their query is too broad.
    const line = describeIssueCount({
      shown: SEARCH_MAX_RESULTS,
      total: 4000,
      limit: SEARCH_MAX_RESULTS,
    });
    expect(line).toContain(`at most ${SEARCH_MAX_RESULTS}`);
  });

  it('offers more only when raising the limit would actually bring some', () => {
    expect(canShowMore({ shown: 25, total: 80, limit: 25 })).toBe(true);
    expect(canShowMore({ shown: 80, total: 80, limit: 100 })).toBe(false);
    expect(canShowMore({ shown: SEARCH_MAX_RESULTS, total: 4000, limit: SEARCH_MAX_RESULTS })).toBe(
      false,
    );
  });

  it('does not guess a total for comments, which the server does not count', () => {
    expect(describeCommentCount(0)).toBe('No comments');
    expect(describeCommentCount(1)).toBe('1 comment');
    expect(describeCommentCount(9)).toBe('9 comments');
  });
});
