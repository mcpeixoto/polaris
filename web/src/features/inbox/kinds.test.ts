import { describe, expect, it } from 'vitest';

import { GLYPH_TYPES } from './glyphs';
import { INBOX_KINDS, kindOf, matchesKinds, type InboxKind } from './kinds';

describe('inbox kinds', () => {
  it('gives every notification type this build knows exactly one kind', () => {
    for (const type of GLYPH_TYPES) {
      expect(INBOX_KINDS).toContain(kindOf(type));
    }
  });

  it('folds the things that were addressed to you apart from the things you follow', () => {
    expect(kindOf('issue_assigned')).toBe('assigned');
    expect(kindOf('mention')).toBe('mentioned');
    expect(kindOf('comment')).toBe('commented');
    expect(kindOf('issue_priority_raised')).toBe('status');
    expect(kindOf('project_update')).toBe('activity');
  });

  it('puts a type this build has never heard of somewhere reachable', () => {
    expect(kindOf('something_new' as Parameters<typeof kindOf>[0])).toBe('activity');
  });

  it('treats nothing chosen as everything', () => {
    const none: ReadonlySet<InboxKind> = new Set();
    expect(matchesKinds('comment', none)).toBe(true);
    expect(matchesKinds('comment', new Set<InboxKind>(['mentioned']))).toBe(false);
    expect(matchesKinds('mention', new Set<InboxKind>(['mentioned']))).toBe(true);
  });
});
