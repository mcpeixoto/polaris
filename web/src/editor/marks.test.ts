import { describe, expect, it } from 'vitest';

import { hitTest, isInlineRoot, paint, placeAnchors, reanchor } from './marks';

describe('reanchor', () => {
  it('keeps a span whose quote still sits at the recorded offsets', () => {
    expect(reanchor('The auth path is wrong.', 4, 13, 'auth path')).toEqual({
      start: 4,
      end: 13,
    });
  });

  it('finds the quote again after an insertion before it', () => {
    expect(reanchor('Note: The auth path is wrong.', 4, 13, 'auth path')).toEqual({
      start: 10,
      end: 19,
    });
  });

  it('picks the occurrence closest to the original start when the quote is duplicated', () => {
    const text = 'auth path then later the auth path again';
    expect(reanchor(text, 25, 34, 'auth path')).toEqual({ start: 25, end: 34 });
  });

  it('returns null when the quote is gone', () => {
    expect(reanchor('rewritten entirely', 4, 13, 'auth path')).toBeNull();
  });
});

describe('paint', () => {
  it('leaves unmarked text as a single run', () => {
    expect(paint('hello', [])).toEqual([{ text: 'hello', commentIds: [], resolved: false }]);
  });

  it('splits around a mark and tags overlapping comments onto the shared run', () => {
    const segments = paint('The auth path is wrong.', [
      { id: 'a', start: 4, end: 13, quote: 'auth path', resolved: false },
      { id: 'b', start: 9, end: 13, quote: 'path', resolved: true },
    ]);
    expect(segments.map((segment) => ({ text: segment.text, ids: segment.commentIds }))).toEqual([
      { text: 'The ', ids: [] },
      { text: 'auth ', ids: ['a'] },
      { text: 'path', ids: ['a', 'b'] },
      { text: ' is wrong.', ids: [] },
    ]);
    expect(segments[2]?.resolved).toBe(false);
  });
});

describe('hitTest', () => {
  const anchors = placeAnchors('The auth path is wrong.', [
    { id: 'wide', start: 4, end: 13, quote: 'auth path', resolved: false },
    { id: 'narrow', start: 9, end: 13, quote: 'path', resolved: false },
  ]);

  it('prefers the shortest covering span', () => {
    expect(hitTest(10, anchors)).toBe('narrow');
    expect(hitTest(5, anchors)).toBe('wide');
  });

  it('misses unmarked offsets', () => {
    expect(hitTest(0, anchors)).toBeNull();
  });
});

describe('isInlineRoot', () => {
  it('is a root with a quote and no parent', () => {
    expect(isInlineRoot({ quote: 'auth path' })).toBe(true);
    expect(isInlineRoot({ quote: 'auth path', parentId: 'c1' })).toBe(false);
    expect(isInlineRoot({ body: 'hello' } as { quote?: string })).toBe(false);
  });
});

describe('placeAnchors', () => {
  it('drops a comment whose quote no longer exists', () => {
    expect(
      placeAnchors('gone', [{ id: 'a', start: 0, end: 4, quote: 'auth', resolved: false }]),
    ).toEqual([]);
  });
});
