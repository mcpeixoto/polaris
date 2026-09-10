import { describe, expect, it } from 'vitest';

import { findMentionQuery, insertMention, isUserId, mentionToken } from './mentions';

const BOB = '11111111-1111-4111-8111-111111111111';

describe('mentionToken', () => {
  it('writes the wire form the notify package parses', () => {
    expect(mentionToken('Bob', BOB)).toBe(`@[Bob](user:${BOB})`);
  });
});

describe('isUserId', () => {
  it('accepts a uuid and refuses everything else', () => {
    expect(isUserId(BOB)).toBe(true);
    expect(isUserId('not-a-uuid')).toBe(false);
    expect(isUserId('user:' + BOB)).toBe(false);
  });
});

describe('findMentionQuery', () => {
  it('finds an open @query at a word boundary', () => {
    expect(findMentionQuery('hi @bo', 6)).toEqual({ start: 3, query: 'bo' });
    expect(findMentionQuery('@', 1)).toEqual({ start: 0, query: '' });
  });

  it('ignores @ inside a word, such as an email local-part', () => {
    expect(findMentionQuery('a@b', 2)).toBeNull();
    expect(findMentionQuery('mail@bo', 7)).toBeNull();
  });

  it('leaves a completed mention token alone', () => {
    const text = `@[Bob](user:${BOB})`;
    expect(findMentionQuery(text, text.length)).toBeNull();
  });
});

describe('insertMention', () => {
  it('replaces the @query with the token and a trailing space', () => {
    expect(insertMention({ text: 'hi @bo', caret: 6 }, 3, 'Bob', BOB)).toEqual({
      text: `hi @[Bob](user:${BOB}) `,
      caret: `hi @[Bob](user:${BOB}) `.length,
    });
  });
});
